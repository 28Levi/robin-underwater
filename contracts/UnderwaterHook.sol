// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

/// @notice Experimental native-ETH/SHER v4 hook. NOT Programmable's certified fee kernel.
/// @dev Fixed 2% project fee, ZERO LP fee. Platform's additional 0.20% not integrated yet.
/// Requires full fills; partial fills revert without charging a fee. No trader identification assumptions.
contract UnderwaterHook is IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using BalanceDeltaLibrary for BalanceDelta;
    using StateLibrary for IPoolManager;

    IPoolManager public immutable manager;
    address public immutable token;
    address payable public immutable distributor;
    int24 public immutable tickSpacing;
    // beforeInitialize | afterInitialize | beforeSwap | afterSwap | both swap return deltas
    uint160 public constant FLAGS = 0x30cc;
    uint256 public constant PROJECT_FEE_BPS = 200;

    event PriceObserved(bytes32 indexed poolId, uint160 sqrtPriceX96, int24 tick);
    // router is deliberately NOT called wallet/trader: ordinary routers aggregate user swaps.
    event TradeObserved(bytes32 indexed poolId, address indexed router, bool buy, uint256 tokens,
        uint256 grossNative, uint256 feeNative, uint160 sqrtPriceX96, int24 tick);
    event FeesHarvested(uint256 amount);

    constructor(IPoolManager manager_, address token_, address payable distributor_, int24 spacing_) {
        require(address(manager_) != address(0) && token_ != address(0) && distributor_ != address(0), "Zero dependency");
        require(spacing_ > 0, "Invalid spacing");
        require(uint160(address(this)) & 0x3fff == FLAGS, "Hook address bits");
        manager = manager_; token = token_; distributor = distributor_; tickSpacing = spacing_;
    }
    modifier onlyManager() { require(msg.sender == address(manager), "Only PoolManager"); _; }

    function _check(PoolKey calldata key) private view {
        require(Currency.unwrap(key.currency0) == address(0) && Currency.unwrap(key.currency1) == token
            && address(key.hooks) == address(this) && key.fee == 0 && key.tickSpacing == tickSpacing, "Wrong pool");
    }
    function beforeInitialize(address, PoolKey calldata key, uint160) external onlyManager returns (bytes4) {
        _check(key); return this.beforeInitialize.selector;
    }
    function afterInitialize(address, PoolKey calldata key, uint160 price, int24 tick) external onlyManager returns (bytes4) {
        _check(key); emit PriceObserved(PoolId.unwrap(key.toId()), price, tick); return this.afterInitialize.selector;
    }
    function feeOnGross(uint256 gross) public pure returns (uint256) { return gross / 50 + (gross % 50 == 0 ? 0 : 1); }
    function feeOnNet(uint256 net) public pure returns (uint256) { return net / 49 + (net % 49 == 0 ? 0 : 1); }
    function _i128(uint256 amount) private pure returns (int128) {
        require(amount <= uint256(uint128(type(int128).max)), "Amount too large"); return int128(uint128(amount));
    }
    function _abs(int256 amount) private pure returns (uint256) {
        require(amount != type(int256).min, "Invalid amount"); return uint256(amount < 0 ? -amount : amount);
    }

    function beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        external onlyManager returns (bytes4, BeforeSwapDelta, uint24)
    {
        _check(key);
        bool exactIn = params.amountSpecified < 0;
        bool nativeSpecified = params.zeroForOne == exactIn;
        uint256 fee;
        if (nativeSpecified) {
            uint256 amount = _abs(params.amountSpecified);
            fee = exactIn ? feeOnGross(amount) : feeOnNet(amount);
            if (exactIn) require(amount > fee, "Dust trade");
            manager.mint(address(this), 0, fee);
        }
        return (this.beforeSwap.selector, toBeforeSwapDelta(_i128(fee), 0), 0);
    }

    function afterSwap(address router, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata)
        external onlyManager returns (bytes4, int128)
    {
        _check(key);
        bool exactIn = params.amountSpecified < 0;
        bool nativeSpecified = params.zeroForOne == exactIn;
        uint256 nativeAmount = _abs(int256(delta.amount0()));
        uint256 tokenAmount = _abs(int256(delta.amount1()));
        uint256 requested = _abs(params.amountSpecified);
        uint256 fee;
        uint256 gross;
        if (nativeSpecified) {
            fee = exactIn ? feeOnGross(requested) : feeOnNet(requested);
            require(nativeAmount == (exactIn ? requested - fee : requested + fee), "Partial fill unsupported");
            gross = exactIn ? requested : nativeAmount;
        } else {
            require(tokenAmount == requested, "Partial fill unsupported");
            fee = params.zeroForOne ? feeOnNet(nativeAmount) : feeOnGross(nativeAmount);
            gross = params.zeroForOne ? nativeAmount + fee : nativeAmount;
            require(gross > fee, "Dust trade");
            manager.mint(address(this), 0, fee);
        }
        (uint160 price, int24 tick,,) = manager.getSlot0(key.toId());
        emit TradeObserved(PoolId.unwrap(key.toId()), router, params.zeroForOne, tokenAmount, gross, fee, price, tick);
        return (this.afterSwap.selector, nativeSpecified ? int128(0) : _i128(fee));
    }

    /// @notice No privileged harvester and no user claim action: anyone can fund the reward vault.
    function harvest() external { manager.unlock(""); }
    function unlockCallback(bytes calldata) external onlyManager returns (bytes memory) {
        uint256 amount = manager.balanceOf(address(this), 0);
        if (amount != 0) {
            manager.burn(address(this), 0, amount);
            manager.take(Currency.wrap(address(0)), distributor, amount);
            emit FeesHarvested(amount);
        }
        return "";
    }
}
