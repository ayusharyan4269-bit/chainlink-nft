const CONTRACT_ABI = [
  "event NFTMinted(address indexed to, uint256 tokenId, uint8 market, int256 price)",
  "function getTokenMarket(uint256 tokenId) view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)"
];

module.exports = CONTRACT_ABI;