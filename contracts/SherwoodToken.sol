// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Plain fixed-supply ERC20. No transfer tax, blacklist, pause, owner or later mint.
contract SherwoodToken is ERC20 {
    constructor(string memory name_, string memory symbol_, uint256 supply, address recipient)
        ERC20(name_, symbol_)
    {
        require(recipient != address(0) && supply != 0, "Invalid issuance");
        _mint(recipient, supply);
    }
}
