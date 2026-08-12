// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/Marketplace.sol";

contract DeployMarketplace is Script {
    function run() external returns (Marketplace) {
        vm.startBroadcast();

        Marketplace marketplace = new Marketplace();

        vm.stopBroadcast();

        return marketplace;
    }
}
