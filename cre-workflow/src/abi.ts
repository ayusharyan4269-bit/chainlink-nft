export const ChainLinkNFTAbi = [
  {
    type: 'function',
    name: 'checkUpkeep',
    inputs: [{ name: '', type: 'bytes', internalType: 'bytes' }],
    outputs: [
      { name: 'upkeepNeeded', type: 'bool', internalType: 'bool' },
      { name: 'performData', type: 'bytes', internalType: 'bytes' }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'performUpkeep',
    inputs: [{ name: 'performData', type: 'bytes', internalType: 'bytes' }],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'currentMarket',
    inputs: [],
    outputs: [{ name: '', type: 'uint8', internalType: 'enum ChainLinkNFT.Market' }],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'getCurrentMarketString',
    inputs: [],
    outputs: [{ name: '', type: 'string', internalType: 'string' }],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'getLatestPrice',
    inputs: [],
    outputs: [{ name: '', type: 'int256', internalType: 'int256' }],
    stateMutability: 'view'
  }
] as const;
