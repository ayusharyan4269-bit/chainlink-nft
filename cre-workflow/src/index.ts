import { cre, CronCapability, EVMClient } from '@chainlink/cre-sdk';
import type { Runtime } from '@chainlink/cre-sdk';
import { encodeFunctionData, decodeFunctionResult, toHex } from 'viem';
import { ChainLinkNFTAbi } from './abi.js';

const SEPOLIA_CHAIN_SELECTOR = 16015286601757825753n;
const TARGET_CONTRACT = '0xBAA134b625B181cA6A924A2aa569c87bde86Cc1D';

// Cron Trigger: Check contract every 5 minutes
const cronTrigger = new CronCapability().trigger({
  schedule: '0 */5 * * * *',
});

export default cre.handler(cronTrigger, async (runtime: Runtime<unknown>) => {
  const evm = new EVMClient(SEPOLIA_CHAIN_SELECTOR);

  // 1. Encode checkUpkeep call data
  const checkCallData = encodeFunctionData({
    abi: ChainLinkNFTAbi,
    functionName: 'checkUpkeep',
    args: ['0x'],
  });

  // 2. Call checkUpkeep on Sepolia off-chain
  const reply = await evm
    .callContract(runtime, {
      call: {
        to: TARGET_CONTRACT,
        data: checkCallData,
      },
    })
    .result();

  // 3. Decode checkUpkeep result
  const [upkeepNeeded, performData] = decodeFunctionResult({
    abi: ChainLinkNFTAbi,
    functionName: 'checkUpkeep',
    data: toHex(reply.data),
  }) as [boolean, `0x${string}`];

  // 4. Return result if no update required
  if (!upkeepNeeded) {
    return {
      status: 'NO_UPDATE_REQUIRED',
      targetContract: TARGET_CONTRACT,
      upkeepNeeded: false,
    };
  }

  // 5. Update required - Trigger performUpkeep on-chain
  const performCallData = encodeFunctionData({
    abi: ChainLinkNFTAbi,
    functionName: 'performUpkeep',
    args: [performData],
  });

  return {
    status: 'UPDATE_REQUIRED',
    targetContract: TARGET_CONTRACT,
    upkeepNeeded: true,
    performData,
    performCallData,
  };
});
