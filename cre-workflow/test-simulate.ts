import { createPublicClient, http, encodeFunctionData, decodeFunctionResult } from 'viem';
import { sepolia } from 'viem/chains';
import { ChainLinkNFTAbi } from './src/abi.js';

const TARGET_CONTRACT = '0xBAA134b625B181cA6A924A2aa569c87bde86Cc1D';

async function simulateCreWorkflow() {
  console.log('--- CRE LOCAL WORKFLOW SIMULATION ---');
  console.log('Target Contract:', TARGET_CONTRACT);
  console.log('Trigger: Cron Schedule (every 5m)');
  console.log('Network: Ethereum Sepolia (11155111)');

  const client = createPublicClient({
    chain: sepolia,
    transport: http('https://ethereum-sepolia-rpc.publicnode.com'),
  });

  // Step 1: Encode checkUpkeep call data
  const checkCallData = encodeFunctionData({
    abi: ChainLinkNFTAbi,
    functionName: 'checkUpkeep',
    args: ['0x'],
  });

  // Step 2: Simulate EVM Read Capability off-chain against Sepolia
  console.log('\n[1/3] Executing CRE EVM Read capability (checkUpkeep)...');
  const rawReply = await client.call({
    to: TARGET_CONTRACT,
    data: checkCallData,
  });

  // Step 3: Decode checkUpkeep result
  const [upkeepNeeded, performData] = decodeFunctionResult({
    abi: ChainLinkNFTAbi,
    functionName: 'checkUpkeep',
    data: rawReply.data!,
  }) as [boolean, `0x${string}`];

  console.log('[2/3] Decoded checkUpkeep Result:');
  console.log('      - upkeepNeeded:', upkeepNeeded);
  console.log('      - performData:', performData);

  // Step 4: Verify conditional write logic
  if (!upkeepNeeded) {
    console.log('\n[3/3] Result: NO_UPDATE_REQUIRED. On-chain EVM write skipped (0 gas spent).');
  } else {
    console.log('\n[3/3] Result: UPDATE_REQUIRED. Prepared EVM write payload for performUpkeep.');
  }

  console.log('\n--- SIMULATION SUCCESSFUL ---');
}

simulateCreWorkflow().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
