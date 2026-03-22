import { ethers } from "ethers";
import * as dotenv from "dotenv";
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { supportedEvmChains } from '../../helper-config';
import { getEvmChainConfig, getRpcUrlForEvmChain } from '../utils/utils';
import MessageReceiverArtifact from '../../artifacts/contracts/MessageReceiver.sol/MessageReceiver.json' assert { type: 'json' };

dotenv.config();

const argv = yargs(hideBin(process.argv))
  .option('evmChain', {
    type: 'string',
    description: 'EVM chain to deploy receiver on',
    choices: supportedEvmChains,
    demandOption: true,
  })
  .parseSync()

async function main() {
  const evmChain = getEvmChainConfig(argv.evmChain)

  console.log(`🚀 Deploying MessageReceiver contract to ${argv.evmChain}...\n`);

  // Router address comes from selected chain config
  const routerAddress = evmChain.router;

  // Create provider and wallet
  const provider = new ethers.JsonRpcProvider(getRpcUrlForEvmChain(evmChain));

  const privateKey = process.env.EVM_PRIVATE_KEY;
  if (!privateKey) throw new Error('EVM_PRIVATE_KEY is not set in .env');
  const wallet = new ethers.Wallet(privateKey, provider);
  
  console.log("📤 Deploying from account:", wallet.address);
  
  const balance = await provider.getBalance(wallet.address);
  console.log("💰 Account balance:", ethers.formatEther(balance), "ETH\n");

  // Deploy contract
  console.log("⏳ Deploying MessageReceiver with router:", routerAddress);
  const factory = new ethers.ContractFactory(
    MessageReceiverArtifact.abi,
    MessageReceiverArtifact.bytecode,
    wallet
  );
  const receiver = await factory.deploy(routerAddress);

  await receiver.waitForDeployment();
  const receiverAddress = await receiver.getAddress();

  console.log("\n✅ MessageReceiver deployed successfully!");
  console.log("📍 Contract address:", receiverAddress);
  console.log("📍 Router address:", routerAddress);
  
  console.log("\n📝 Next steps:");
  console.log("1. Wait 1-2 minutes for Etherscan to index the contract");
  console.log("2. Verify the contract (optional):");
  console.log(`   npx hardhat verify ${receiverAddress} ${routerAddress} --network ${argv.evmChain}`);
  console.log("3. Send a test message to the deployed receiver:");
  console.log(`   npm run ton2evm:send -- --destChain ${argv.evmChain} --evmReceiver ${receiverAddress} --msg "Hello EVM from TON" --feeToken native`);
  console.log("\n🔍 View on explorer:");
  console.log(`   ${evmChain.explorer}/address/${receiverAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });

