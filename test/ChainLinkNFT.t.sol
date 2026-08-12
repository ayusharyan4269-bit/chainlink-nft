// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ChainLinkNFT.sol";

contract MockPriceFeed {
    int256 public price;

    constructor(int256 _price) {
        price = _price;
    }

    function setPrice(int256 _price) external {
        price = _price;
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
        return (0, price, 0, block.timestamp, 0);
    }
}

contract ChainLinkNFTTest is Test {
    ChainLinkNFT nft;
    MockPriceFeed mockFeed;

    function setUp() public {
        mockFeed = new MockPriceFeed(3000 * 1e8);
        nft = new ChainLinkNFT(address(mockFeed));
    }

    function test_ContractDeploys() public view {
        assertEq(nft.name(), "ChainLinkNFT");
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
}