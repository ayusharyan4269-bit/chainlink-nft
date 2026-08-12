// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ChainLinkNFT.sol";
import "../src/MockV3Aggregator.sol";
import "../src/Marketplace.sol";

contract DemoChainLinkNFTTest is Test {
    MockV3Aggregator public mockFeed;
    ChainLinkNFT public demoContract;
    Marketplace public marketplace;

    address public alice = address(0x1);
    address public bob = address(0x2);

    function setUp() public {
        // Initial price: $1800 (Bearish)
        mockFeed = new MockV3Aggregator(8, 1800 * 1e8);
        demoContract = new ChainLinkNFT(address(mockFeed));
        marketplace = new Marketplace();

        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    function test_Demo_BearishClassification() public {
        mockFeed.updateAnswer(1500 * 1e8);

        vm.prank(alice);
        uint256 tokenId = demoContract.mint();

        assertEq(uint256(demoContract.tokenMarket(tokenId)), uint256(ChainLinkNFT.Market.Bearish));
        assertEq(demoContract.tokenMintPrice(tokenId), 1500 * 1e8);
    }

    function test_Demo_NeutralClassification() public {
        mockFeed.updateAnswer(3000 * 1e8);

        vm.prank(alice);
        uint256 tokenId = demoContract.mint();

        assertEq(uint256(demoContract.tokenMarket(tokenId)), uint256(ChainLinkNFT.Market.Neutral));
        assertEq(demoContract.tokenMintPrice(tokenId), 3000 * 1e8);
    }

    function test_Demo_BullishClassification() public {
        mockFeed.updateAnswer(5000 * 1e8);

        vm.prank(alice);
        uint256 tokenId = demoContract.mint();

        assertEq(uint256(demoContract.tokenMarket(tokenId)), uint256(ChainLinkNFT.Market.Bullish));
        assertEq(demoContract.tokenMintPrice(tokenId), 5000 * 1e8);
    }

    function test_Demo_MintImmutabilityAfterPriceChange() public {
        // Mint at $3000 (Neutral)
        mockFeed.updateAnswer(3000 * 1e8);
        vm.prank(alice);
        uint256 tokenId = demoContract.mint();

        assertEq(uint256(demoContract.tokenMarket(tokenId)), uint256(ChainLinkNFT.Market.Neutral));

        // Change mock oracle price to $5000 (Bullish)
        mockFeed.updateAnswer(5000 * 1e8);

        // Verify previously minted token market trait REMAINS Neutral
        assertEq(uint256(demoContract.tokenMarket(tokenId)), uint256(ChainLinkNFT.Market.Neutral));
    }

    function test_Demo_MarketplaceIntegration() public {
        mockFeed.updateAnswer(3000 * 1e8);
        vm.prank(alice);
        uint256 tokenId = demoContract.mint();

        vm.startPrank(alice);
        demoContract.approve(address(marketplace), tokenId);
        marketplace.listNFT(address(demoContract), tokenId, 0.1 ether);
        vm.stopPrank();

        vm.prank(bob);
        marketplace.buyNFT{value: 0.1 ether}(address(demoContract), tokenId);

        assertEq(demoContract.ownerOf(tokenId), bob);
        // Trait remains Neutral after marketplace sale
        assertEq(uint256(demoContract.tokenMarket(tokenId)), uint256(ChainLinkNFT.Market.Neutral));
    }
}
