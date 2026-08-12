require('dotenv').config();
const { ethers } = require('ethers');
const CONTRACT_ABI = require('./contractAbi');

const provider = new ethers.JsonRpcProvider(
  process.env.SEPOLIA_RPC_URL
);

const contract = new ethers.Contract(
  process.env.CONTRACT_ADDRESS,
  CONTRACT_ABI,
  provider
);

module.exports = {
  provider,
  contract,
};