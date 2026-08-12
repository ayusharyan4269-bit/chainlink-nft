require('dotenv').config();
const { ethers } = require('ethers');
const CONTRACT_ABI = require('./contractAbi');

const contractAddress =
  process.env.CONTRACT_ADDRESS ||
  process.env.PRODUCTION_CONTRACT_ADDRESS ||
  '0xBAA134b625B181cA6A924A2aa569c87bde86Cc1D';

const rpcUrl =
  process.env.SEPOLIA_RPC_URL ||
  'https://ethereum-sepolia-rpc.publicnode.com';

const provider = new ethers.JsonRpcProvider(rpcUrl);

const contract = new ethers.Contract(
  contractAddress,
  CONTRACT_ABI,
  provider
);

module.exports = {
  provider,
  contract,
};