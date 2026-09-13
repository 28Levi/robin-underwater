// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

contract Create2Deployer {
    function deploy(bytes32 salt, bytes memory code) external returns (address deployed) {
        assembly ("memory-safe") { deployed := create2(0, add(code, 32), mload(code), salt) }
        require(deployed != address(0), "Deploy failed");
    }
}
contract RejectEther { receive() external payable { revert("No ETH"); } }
