// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ChainLinkNFT.sol";

contract MockPriceFeed {
    int256 public price;
    uint256 public updatedAt;

    constructor(int256 _price) {
        price = _price;
        updatedAt = block.timestamp;
    }

    function setPrice(int256 _price) external {
        price = _price;
        updatedAt = block.timestamp;
    }

    function setUpdatedAt(uint256 _updatedAt) external {
        updatedAt = _updatedAt;
    }

    function latestRoundData()
        external
        view
        returns (
            uint80,
            int256,
            uint256,
            uint256,
            uint80
        )
    {
        return (0, price, 0, updatedAt, 0);
    }
}

contract ChainLinkNFTTest is Test {
    ChainLinkNFT nft;
    MockPriceFeed mockFeed;

    event MarketUpdated(
        ChainLinkNFT.Market indexed oldMarket,
        ChainLinkNFT.Market indexed newMarket,
        int256 price,
        uint256 timestamp
    );

    function setUp() public {
        vm.warp(100000); // Set block.timestamp to 100,000s to prevent underflow in time math
        mockFeed = new MockPriceFeed(3000 * 1e8); // Initial state: Neutral
        nft = new ChainLinkNFT(address(mockFeed));
    }

    function test_ContractDeploys() public view {
        assertEq(nft.name(), "ChainLinkNFT");
        assertEq(nft.getCurrentMarketString(), "Neutral");
    }

    function test_MintAssignsOwnership() public {
        vm.prank(address(1));
        uint256 tokenId = nft.mint();
        assertEq(nft.ownerOf(tokenId), address(1));
    }

    function test_PriceCanBeRead() public view {
        assertEq(nft.getLatestPrice(), 3000 * 1e8);
    }

    function test_BearishTrait() public {
        mockFeed.setPrice(2000 * 1e8);
        vm.prank(address(1));
        uint256 tokenId = nft.mint();
        assertEq(nft.getTokenMarket(tokenId), "Bearish");
    }

    function test_BullishTrait() public {
        mockFeed.setPrice(5000 * 1e8);
        vm.prank(address(1));
        uint256 tokenId = nft.mint();
        assertEq(nft.getTokenMarket(tokenId), "Bullish");
    }

    // ================= CHAINLINK AUTOMATION TESTS =================

    function test_CheckUpkeep_NoUpdateNeededWhenStateUnchanged() public view {
        (bool upkeepNeeded, ) = nft.checkUpkeep("");
        assertFalse(upkeepNeeded, "checkUpkeep should return false when state is unchanged");
    }

    function test_CheckUpkeep_UpdateNeededWhenStateChanges() public {
        mockFeed.setPrice(2000 * 1e8);

        (bool upkeepNeeded, bytes memory performData) = nft.checkUpkeep("");
        assertTrue(upkeepNeeded, "checkUpkeep should return true when state changes");

        (ChainLinkNFT.Market targetMarket, int256 price) = abi.decode(
            performData,
            (ChainLinkNFT.Market, int256)
        );
        assertEq(uint8(targetMarket), uint8(ChainLinkNFT.Market.Bearish));
        assertEq(price, 2000 * 1e8);
    }

    function test_PerformUpkeep_SuccessfulMarketTransition() public {
        mockFeed.setPrice(4500 * 1e8);

        (, bytes memory performData) = nft.checkUpkeep("");

        vm.expectEmit(true, true, false, true);
        emit MarketUpdated(
            ChainLinkNFT.Market.Neutral,
            ChainLinkNFT.Market.Bullish,
            4500 * 1e8,
            block.timestamp
        );

        nft.performUpkeep(performData);

        assertEq(nft.getCurrentMarketString(), "Bullish");
        assertEq(nft.lastAutomatedPrice(), 4500 * 1e8);
        assertEq(nft.lastAutomatedTimestamp(), block.timestamp);
    }

    function test_PerformUpkeep_RevertsWhenStateUnchanged() public {
        (, bytes memory performData) = nft.checkUpkeep("");

        vm.expectRevert("Market state unchanged");
        nft.performUpkeep(performData);
    }

    function test_CheckUpkeep_RevertsOnStalePrice() public {
        mockFeed.setUpdatedAt(block.timestamp - 4 hours);

        vm.expectRevert("Stale price");
        nft.checkUpkeep("");
    }

    function test_CheckUpkeep_RevertsOnInvalidPrice() public {
        mockFeed.setPrice(0);

        vm.expectRevert("Invalid price");
        nft.checkUpkeep("");
    }

    function test_MintMarketRemainsImmutableAfterAutomation() public {
        vm.prank(address(1));
        uint256 tokenId = nft.mint();
        assertEq(nft.getTokenMarket(tokenId), "Neutral");

        mockFeed.setPrice(5000 * 1e8);
        (, bytes memory performData) = nft.checkUpkeep("");
        nft.performUpkeep(performData);

        assertEq(nft.getCurrentMarketString(), "Bullish");
        assertEq(nft.getTokenMarket(tokenId), "Neutral");
    }
}