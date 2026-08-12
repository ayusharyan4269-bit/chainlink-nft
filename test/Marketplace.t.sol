// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ChainLinkNFT.sol";
import "../src/Marketplace.sol";

contract MockPriceFeedMarketplace {
    int256 public price;
    uint256 public updatedAt;

    constructor(int256 _price) {
        price = _price;
        updatedAt = block.timestamp;
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

contract MockReentrantBuyer {
    Marketplace public marketplace;
    address public nftContract;
    uint256 public tokenId;

    constructor(address _marketplace, address _nftContract, uint256 _tokenId) {
        marketplace = Marketplace(_marketplace);
        nftContract = _nftContract;
        tokenId = _tokenId;
    }

    function attack() external payable {
        marketplace.buyNFT{value: msg.value}(nftContract, tokenId);
    }

    receive() external payable {
        try marketplace.buyNFT{value: msg.value}(nftContract, tokenId) {
            // Reentrancy attack attempt
        } catch {
            // Intercepted by nonReentrant
        }
    }

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}

contract MarketplaceTest is Test {
    ChainLinkNFT nft;
    MockPriceFeedMarketplace mockFeed;
    Marketplace marketplace;

    address seller = address(0x10);
    address buyer = address(0x20);

    event NFTListed(
        address indexed nftContract,
        uint256 indexed tokenId,
        address indexed seller,
        uint256 price
    );

    event ListingCancelled(
        address indexed nftContract,
        uint256 indexed tokenId,
        address indexed seller
    );

    event NFTSold(
        address indexed nftContract,
        uint256 indexed tokenId,
        address indexed seller,
        address buyer,
        uint256 price
    );

    function setUp() public {
        vm.warp(100000);
        mockFeed = new MockPriceFeedMarketplace(3000 * 1e8);
        nft = new ChainLinkNFT(address(mockFeed));
        marketplace = new Marketplace();

        vm.deal(seller, 10 ether);
        vm.deal(buyer, 10 ether);
    }

    function test_ListNFT_Success() public {
        vm.prank(seller);
        uint256 tokenId = nft.mint();

        vm.startPrank(seller);
        nft.approve(address(marketplace), tokenId);

        vm.expectEmit(true, true, true, true);
        emit NFTListed(address(nft), tokenId, seller, 0.1 ether);

        marketplace.listNFT(address(nft), tokenId, 0.1 ether);
        vm.stopPrank();

        (address listedSeller, uint256 price, bool active) = marketplace.getListing(
            address(nft),
            tokenId
        );

        assertEq(listedSeller, seller);
        assertEq(price, 0.1 ether);
        assertTrue(active);
    }

    function test_ListNFT_RevertsIfZeroPrice() public {
        vm.prank(seller);
        uint256 tokenId = nft.mint();

        vm.startPrank(seller);
        nft.approve(address(marketplace), tokenId);

        vm.expectRevert("Price must be greater than zero");
        marketplace.listNFT(address(nft), tokenId, 0);
        vm.stopPrank();
    }

    function test_ListNFT_RevertsIfNotOwner() public {
        vm.prank(seller);
        uint256 tokenId = nft.mint();

        vm.startPrank(buyer);
        vm.expectRevert("Not the NFT owner");
        marketplace.listNFT(address(nft), tokenId, 0.1 ether);
        vm.stopPrank();
    }

    function test_ListNFT_RevertsIfNotApproved() public {
        vm.prank(seller);
        uint256 tokenId = nft.mint();

        vm.startPrank(seller);
        vm.expectRevert("Marketplace not approved");
        marketplace.listNFT(address(nft), tokenId, 0.1 ether);
        vm.stopPrank();
    }

    function test_CancelListing_Success() public {
        vm.prank(seller);
        uint256 tokenId = nft.mint();

        vm.startPrank(seller);
        nft.approve(address(marketplace), tokenId);
        marketplace.listNFT(address(nft), tokenId, 0.1 ether);

        vm.expectEmit(true, true, true, false);
        emit ListingCancelled(address(nft), tokenId, seller);

        marketplace.cancelListing(address(nft), tokenId);
        vm.stopPrank();

        (, , bool active) = marketplace.getListing(address(nft), tokenId);
        assertFalse(active);
    }

    function test_BuyNFT_Success() public {
        vm.prank(seller);
        uint256 tokenId = nft.mint();

        vm.startPrank(seller);
        nft.approve(address(marketplace), tokenId);
        marketplace.listNFT(address(nft), tokenId, 0.1 ether);
        vm.stopPrank();

        uint256 sellerBalanceBefore = seller.balance;

        vm.startPrank(buyer);
        vm.expectEmit(true, true, true, true);
        emit NFTSold(address(nft), tokenId, seller, buyer, 0.1 ether);

        marketplace.buyNFT{value: 0.1 ether}(address(nft), tokenId);
        vm.stopPrank();

        assertEq(nft.ownerOf(tokenId), buyer);
        assertEq(seller.balance, sellerBalanceBefore + 0.1 ether);

        (, , bool active) = marketplace.getListing(address(nft), tokenId);
        assertFalse(active);
    }

    function test_BuyNFT_RevertsIfInsufficientETH() public {
        vm.prank(seller);
        uint256 tokenId = nft.mint();

        vm.startPrank(seller);
        nft.approve(address(marketplace), tokenId);
        marketplace.listNFT(address(nft), tokenId, 0.1 ether);
        vm.stopPrank();

        vm.startPrank(buyer);
        vm.expectRevert("Insufficient ETH sent");
        marketplace.buyNFT{value: 0.05 ether}(address(nft), tokenId);
        vm.stopPrank();
    }

    function test_BuyNFT_RevertsIfDoublePurchase() public {
        vm.prank(seller);
        uint256 tokenId = nft.mint();

        vm.startPrank(seller);
        nft.approve(address(marketplace), tokenId);
        marketplace.listNFT(address(nft), tokenId, 0.1 ether);
        vm.stopPrank();

        vm.prank(buyer);
        marketplace.buyNFT{value: 0.1 ether}(address(nft), tokenId);

        vm.prank(buyer);
        vm.expectRevert("Listing not active");
        marketplace.buyNFT{value: 0.1 ether}(address(nft), tokenId);
    }

    function test_BuyNFT_RevertsIfSellerTransferredNFT() public {
        vm.prank(seller);
        uint256 tokenId = nft.mint();

        vm.startPrank(seller);
        nft.approve(address(marketplace), tokenId);
        marketplace.listNFT(address(nft), tokenId, 0.1 ether);
        nft.transferFrom(seller, address(0x30), tokenId);
        vm.stopPrank();

        vm.prank(buyer);
        vm.expectRevert("Seller no longer owns NFT");
        marketplace.buyNFT{value: 0.1 ether}(address(nft), tokenId);
    }

    function test_BuyNFT_ReentrancyProtection() public {
        vm.prank(seller);
        uint256 tokenId = nft.mint();

        vm.startPrank(seller);
        nft.approve(address(marketplace), tokenId);
        marketplace.listNFT(address(nft), tokenId, 0.1 ether);
        vm.stopPrank();

        MockReentrantBuyer attacker = new MockReentrantBuyer(
            address(marketplace),
            address(nft),
            tokenId
        );
        vm.deal(address(attacker), 1 ether);

        attacker.attack{value: 0.1 ether}();
        assertEq(nft.ownerOf(tokenId), address(attacker));
    }
}
