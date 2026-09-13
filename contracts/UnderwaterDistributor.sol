// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice The immutable operator is trusted to calculate fair allocations.
/// The contract checks funding/replay, NOT whether recipients really are underwater.
contract UnderwaterDistributor is ReentrancyGuard {
    address public immutable operator;
    uint256 public constant MAX_BATCH = 100;
    uint256 public reserved;
    mapping(bytes32 => bool) public processed;
    mapping(address => uint256) public pending;

    event Funded(address indexed from, uint256 amount);
    event BatchRecorded(bytes32 indexed batchId, bytes32 indexed auditHash, uint256 total);
    event RewardPaid(address indexed recipient, uint256 amount);
    event RewardDeferred(address indexed recipient, uint256 amount);
    event RewardAllocated(bytes32 indexed batchId, address indexed recipient, uint256 amount);
    event RewardSkipped(bytes32 indexed batchId, address indexed recipient);

    constructor(address operator_) {
        require(operator_ != address(0), "Zero operator");
        operator = operator_;
    }
    receive() external payable { emit Funded(msg.sender, msg.value); }

    function available() public view returns (uint256) { return address(this).balance - reserved; }

    function distribute(bytes32 batchId, bytes32 auditHash, address[] calldata recipients, uint256[] calldata amounts)
        external nonReentrant
    {
        _distribute(batchId, auditHash, recipients, amounts);
    }

    /// @notice Keeper payments expire and require recipients to retain the measured balances.
    /// This does not prove loss eligibility or detect transfers out and back to the same balance.
    function distributeGuarded(bytes32 batchId, bytes32 auditHash, address token, uint256 deadline,
        address[] calldata recipients, uint256[] calldata amounts, uint256[] calldata expectedBalances)
        external nonReentrant
    {
        require(msg.sender == operator, "Only operator");
        require(block.timestamp <= deadline, "Expired payout");
        require(token.code.length > 0 && recipients.length == expectedBalances.length, "Invalid balance guard");
        for (uint256 i; i < recipients.length; ++i) {
            require(expectedBalances[i] > 0 && IERC20(token).balanceOf(recipients[i]) == expectedBalances[i], "Holder balance changed");
        }
        _distribute(batchId, auditHash, recipients, amounts);
    }

    function _distribute(bytes32 batchId, bytes32 auditHash, address[] calldata recipients, uint256[] calldata amounts)
        private
    {
        _validate(batchId, auditHash, recipients, amounts);
        _allocate(batchId, auditHash, recipients, amounts);
    }

    /// @notice Incoming dust cannot block payments. A reduced balance skips only that recipient.
    /// Eligibility is computed offchain; equal-balance round trips are not detected by this guard.
    function distributeEligible(bytes32 batchId, bytes32 auditHash, address token, uint256 deadline,
        address[] calldata recipients, uint256[] calldata amounts, uint256[] calldata minimumBalances)
        external nonReentrant
    {
        _validate(batchId, auditHash, recipients, amounts);
        require(block.timestamp <= deadline, "Expired payout");
        require(token.code.length > 0 && recipients.length == minimumBalances.length, "Invalid balance guard");
        bool[] memory eligible = new bool[](recipients.length);
        uint256 count;
        for (uint256 i; i < recipients.length; ++i) {
            require(minimumBalances[i] > 0, "Invalid minimum balance");
            eligible[i] = IERC20(token).balanceOf(recipients[i]) >= minimumBalances[i];
            if (eligible[i]) ++count;
            else emit RewardSkipped(batchId, recipients[i]);
        }
        address[] memory accepted = new address[](count);
        uint256[] memory acceptedAmounts = new uint256[](count);
        uint256 index;
        for (uint256 i; i < recipients.length; ++i) {
            if (eligible[i]) { accepted[index] = recipients[i]; acceptedAmounts[index++] = amounts[i]; }
        }
        _allocate(batchId, auditHash, accepted, acceptedAmounts);
    }

    function _validate(bytes32 batchId, bytes32 auditHash, address[] calldata recipients, uint256[] calldata amounts)
        private view
    {
        require(msg.sender == operator, "Only operator");
        require(!processed[batchId], "Already processed");
        require(auditHash != bytes32(0), "Missing audit commitment");
        require(recipients.length > 0 && recipients.length <= MAX_BATCH && recipients.length == amounts.length, "Invalid batch");
        for (uint256 i; i < amounts.length; ++i) {
            require(recipients[i] != address(0) && recipients[i] != address(this) && amounts[i] > 0, "Invalid reward");
            // Sorted unique recipients make accidental duplicate entries impossible.
            if (i > 0) require(uint160(recipients[i]) > uint160(recipients[i-1]), "Recipients not sorted");
        }
    }

    function _allocate(bytes32 batchId, bytes32 auditHash, address[] memory recipients, uint256[] memory amounts)
        private
    {
        uint256 total;
        for (uint256 i; i < amounts.length; ++i) total += amounts[i];
        require(total <= available(), "Insufficient funding");
        processed[batchId] = true;
        reserved += total;
        emit BatchRecorded(batchId, auditHash, total);
        for (uint256 i; i < amounts.length; ++i) {
            pending[recipients[i]] += amounts[i];
            emit RewardAllocated(batchId, recipients[i], amounts[i]);
        }
        for (uint256 i; i < amounts.length; ++i) _pay(recipients[i]);
    }

    /// @notice Anyone (including the keeper) may retry; money always goes to its recipient.
    function pay(address recipient) external nonReentrant { _pay(recipient); }

    function _pay(address recipient) private {
        uint256 amount = pending[recipient];
        if (amount == 0) return;
        pending[recipient] = 0;
        reserved -= amount;
        (bool ok,) = payable(recipient).call{value: amount, gas: 50_000}("");
        if (!ok) {
            pending[recipient] = amount;
            reserved += amount;
            emit RewardDeferred(recipient, amount);
        } else emit RewardPaid(recipient, amount);
    }
}
