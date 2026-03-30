import { Address, toNano, fromNano, beginCell, contractAddress } from '@ton/core';
import { compile } from '@ton/blueprint';
import { TonClient, WalletContractV4, internal } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { networkConfig } from '../../helper-config';
import { getDifferentAddressFormats, getTonExplorerLinks } from '../ton-utils/addressFormats';

dotenv.config();

// Derive valid contract names from wrappers/*.compile.ts files matching "Receiver"
const __dirname = dirname(fileURLToPath(import.meta.url));
const receiverContracts = readdirSync(join(__dirname, '../../wrappers'))
  .filter((f) => /Receiver.*\.compile\.ts$/.test(f))
  .map((f) => f.replace('.compile.ts', ''));

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .option('contract', {
      type: 'string',
      demandOption: true,
      choices: receiverContracts,
      description: 'The receiver contract to deploy',
    })
    .parse();

  const contractName = argv.contract;
  console.log(`🚀 Deploying ${contractName} contract to TON Testnet...\n`);

  // Connect to TON (API key is automatically included if TON_CENTER_API_KEY is set in .env)
  const endpoint = networkConfig.tonTestnet.rpcUrl;
  const client = new TonClient({ endpoint });

  // Load wallet from mnemonic
  const mnemonic = process.env.TON_MNEMONIC;
  if (!mnemonic) {
    throw new Error('TON_MNEMONIC not found in .env');
  }

  const mnemonicArray = mnemonic.split(' ');
  const keyPair = await mnemonicToPrivateKey(mnemonicArray);
  const wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey });
  const walletContract = client.open(wallet);
  const walletFormats = getDifferentAddressFormats(wallet.address);
  const walletExplorerLinks = getTonExplorerLinks(networkConfig.tonTestnet.explorer, wallet.address);

  console.log('📤 Deploying from wallet:', walletFormats.bounceableNonTestable);
  console.log('Explorer:', walletExplorerLinks.bounceableNonTestableUrl);
  const balance = await walletContract.getBalance();
  console.log('💰 Wallet balance:', fromNano(balance), 'TON\n');

  // Compile contract
  console.log(`⏳ Compiling ${contractName}.tolk...`);
  const code = await compile(contractName);

  // Build initial storage
  const routerAddress = Address.parse(networkConfig.tonTestnet.router);
  let initialData;
  if (contractName === 'MessageReceiver') {
    // Storage { id: uint32, ownable: Ownable2Step, authorizedCaller: address, behavior: uint8 }
    initialData = beginCell()
      .storeUint(0, 32)             // id: 0
      .storeAddress(wallet.address) // ownable.owner (deployer)
      .storeBit(false)              // ownable.pendingOwner (null)
      .storeAddress(routerAddress)  // authorizedCaller (Router - sends CCIPReceive messages)
      .storeUint(0, 8)              // behavior: ReceiverBehavior.Accept (0)
      .endCell();
  } else {
    // MinimalReceiver / ReceiverWithValidateAndConfirm
    // Storage { router: address }
    initialData = beginCell()
      .storeAddress(routerAddress) // router: only the Router can send CCIPReceive messages
      .endCell();
  }

  // Calculate contract address
  const stateInit = { code, data: initialData };
  const receiverAddress = contractAddress(0, stateInit);
  const receiverFormats = getDifferentAddressFormats(receiverAddress);
  const receiverExplorerLinks = getTonExplorerLinks(networkConfig.tonTestnet.explorer, receiverAddress);

  console.log('📍 Contract will be deployed at:', receiverFormats.bounceableNonTestable);
  console.log('📍 Router address (authorized caller):', networkConfig.tonTestnet.router);

  // Deploy contract
  console.log('\n⏳ Sending deployment transaction...');
  await walletContract.sendTransfer({
    seqno: await walletContract.getSeqno(),
    secretKey: keyPair.secretKey,
    messages: [
      internal({
        to: receiverAddress,
        value: toNano('0.1'),
        bounce: false,
        init: stateInit,
      }),
    ],
  });

  console.log(`\n✅ ${contractName} deployment initiated!`);
  console.log('📍 Contract address:', receiverFormats.bounceableNonTestable);
  console.log('📝 Next steps:');
  console.log('1. Wait 1-2 minutes for the transaction to be confirmed');
  console.log('2. Copy the contract address above — pass it as --tonReceiver when sending messages');
  console.log('3. Verify deployment on TON explorer:');
  console.log(`   ${receiverExplorerLinks.bounceableNonTestableUrl}`);
  console.log('4. Send a test message to the deployed receiver:');
  console.log(`   npm run evm2ton:send -- --sourceChain <source-chain> --tonReceiver ${receiverFormats.bounceableNonTestable} --msg "Hello TON from EVM" --feeToken native`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });

