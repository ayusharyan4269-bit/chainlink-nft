// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ChainLinkNFT.sol";

contract Deploy is Script {
    function run() external returns (ChainLinkNFT) {
        address priceFeed = vm.envAddress("SEPOLIA_ETH_USD_FEED");

        vm.startBroadcast();

        ChainLinkNFT nft = new ChainLinkNFT(priceFeed);

        vm.stopBroadcast();

        return nft;
    }
}