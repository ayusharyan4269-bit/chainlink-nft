// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

contract MockV3Aggregator is AggregatorV3Interface {
    uint8 public override decimals;
    string public override description;
    uint256 public override version;

    uint80 public latestRound;
    int256 public latestAnswer;
    uint256 public latestTimestamp;

    mapping(uint80 => int256) public getAnswer;
    mapping(uint80 => uint256) public getTimestamp;
    mapping(uint80 => uint256) public getStartedAt;

    event AnswerUpdated(int256 indexed current, uint80 indexed roundId, uint256 timestamp);

    constructor(uint8 _decimals, int256 _initialAnswer) {
        decimals = _decimals;
        description = "MockV3Aggregator ETH/USD";
        version = 4;
        updateAnswer(_initialAnswer);
    }

    function updateAnswer(int256 _answer) public {
        latestRound++;
        latestAnswer = _answer;
        latestTimestamp = block.timestamp;
        getAnswer[latestRound] = _answer;
        getTimestamp[latestRound] = block.timestamp;
        getStartedAt[latestRound] = block.timestamp;
        emit AnswerUpdated(_answer, latestRound, block.timestamp);
    }

    function getRoundData(uint80 _roundId) external view override returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        return (_roundId, getAnswer[_roundId], getStartedAt[_roundId], getTimestamp[_roundId], _roundId);
    }

    function latestRoundData() external view override returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        return (latestRound, latestAnswer, latestTimestamp, latestTimestamp, latestRound);
    }
}
