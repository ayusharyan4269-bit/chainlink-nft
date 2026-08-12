// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import "@chainlink/contracts/src/v0.8/automation/interfaces/AutomationCompatibleInterface.sol";

contract ChainLinkNFT is ERC721, AutomationCompatibleInterface {
    AggregatorV3Interface public immutable priceFeed;

    uint256 public nextTokenId;

    enum Market {
        Bearish,
        Neutral,
        Bullish
    }

    mapping(uint256 => Market) public tokenMarket;
    mapping(uint256 => int256) public tokenMintPrice;

    // Chainlink Automation Market State
    Market public currentMarket;
    int256 public lastAutomatedPrice;
    uint256 public lastAutomatedTimestamp;

    event NFTMinted(
        address indexed to,
        uint256 tokenId,
        Market market,
        int256 price
    );

    event MarketUpdated(
        Market indexed oldMarket,
        Market indexed newMarket,
        int256 price,
        uint256 timestamp
    );

    constructor(address _priceFeed) ERC721("ChainLinkNFT", "CLNFT") {
        priceFeed = AggregatorV3Interface(_priceFeed);

        try priceFeed.latestRoundData() returns (
            uint80,
            int256 price,
            uint256,
            uint256 updatedAt,
            uint80
        ) {
            if (price > 0 && block.timestamp - updatedAt < 3 hours) {
                currentMarket = _determineMarket(price);
                lastAutomatedPrice = price;
                lastAutomatedTimestamp = block.timestamp;
            }
        } catch {
            // Deferred
        }
    }

    function getLatestPrice() public view returns (int256) {
        (, int256 price, , uint256 updatedAt, ) = priceFeed.latestRoundData();

        require(price > 0, "Invalid price");
        require(block.timestamp - updatedAt < 3 hours, "Stale price");

        return price;
    }

    function _determineMarket(
        int256 price
    ) internal pure returns (Market) {
        if (price < 2500 * 1e8) {
            return Market.Bearish;
        }

        if (price <= 4000 * 1e8) {
            return Market.Neutral;
        }

        return Market.Bullish;
    }

    function mint() external returns (uint256) {
        int256 price = getLatestPrice();
        Market market = _determineMarket(price);

        uint256 tokenId = nextTokenId++;

        _safeMint(msg.sender, tokenId);

        tokenMarket[tokenId] = market;
        tokenMintPrice[tokenId] = price;

        emit NFTMinted(msg.sender, tokenId, market, price);

        return tokenId;
    }

    function getTokenMarket(
        uint256 tokenId
    ) public view returns (string memory) {
        _requireOwned(tokenId);

        Market m = tokenMarket[tokenId];

        if (m == Market.Bearish) {
            return "Bearish";
        }

        if (m == Market.Neutral) {
            return "Neutral";
        }

        return "Bullish";
    }

    function getCurrentMarketString() public view returns (string memory) {
        if (currentMarket == Market.Bearish) {
            return "Bearish";
        }
        if (currentMarket == Market.Neutral) {
            return "Neutral";
        }
        return "Bullish";
    }

    // Chainlink Automation - checkUpkeep
    function checkUpkeep(
        bytes calldata /* checkData */
    ) external view override returns (bool upkeepNeeded, bytes memory performData) {
        int256 price = getLatestPrice();
        Market targetMarket = _determineMarket(price);

        if (targetMarket != currentMarket || lastAutomatedTimestamp == 0) {
            upkeepNeeded = true;
            performData = abi.encode(targetMarket, price);
        } else {
            upkeepNeeded = false;
            performData = "";
        }
    }

    // Chainlink Automation - performUpkeep
    function performUpkeep(
        bytes calldata /* performData */
    ) external override {
        int256 price = getLatestPrice();
        Market newMarket = _determineMarket(price);

        require(
            newMarket != currentMarket || lastAutomatedTimestamp == 0,
            "Market state unchanged"
        );

        Market oldMarket = currentMarket;
        currentMarket = newMarket;
        lastAutomatedPrice = price;
        lastAutomatedTimestamp = block.timestamp;

        emit MarketUpdated(oldMarket, newMarket, price, block.timestamp);
    }

    function tokenURI(
        uint256 tokenId
    ) public view override returns (string memory) {
        _requireOwned(tokenId);

        string memory market = getTokenMarket(tokenId);

        return string(
            abi.encodePacked(
                "data:application/json;utf8,",
                '{"name":"ChainLinkNFT #',
                _toString(tokenId),
                '","description":"Market trait set by Chainlink ETH/USD price at mint.",',
                '"attributes":[{"trait_type":"Market","value":"',
                market,
                '"}]}'
            )
        );
    }

    function _toString(
        uint256 value
    ) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }

        uint256 temp = value;
        uint256 digits;

        while (temp != 0) {
            digits++;
            temp /= 10;
        }

        bytes memory buffer = new bytes(digits);

        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(
                uint8(48 + value % 10)
            );
            value /= 10;
        }

        return string(buffer);
    }
}