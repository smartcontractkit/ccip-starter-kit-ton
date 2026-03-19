import { Address, toNano, beginCell, contractAddress } from '@ton/core';
import { compile } from '@ton/blueprint';
import { TonClient, WalletContractV4, internal } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import * as dotenv from 'dotenv';
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { networkConfig } from '../../helper-config';
import { getDifferentAddressFormats, getTonExplorerLinks } from '../ton-utils/addressFormats';

dotenv.config();

const argv = yargs(hideBin(process.argv))
  .option('verbose', {
    type: 'boolean',
    description: 'Show additional address format details',
    default: false,
  })
  .parseSync()

async function main() {
  console.log('🚀 Deploying MinimalReceiver contract to TON Testnet...\n');

  // TON Router address - this is what sends CCIPReceive messages to the receiver
  const TON_ROUTER = networkConfig.tonTestnet.router;

  // Connect to TON (API key is automatically included if TON_API_KEY is set in .env)
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
  const walletFormats = getDifferentAddressFormats(wallet.address)
  const walletExplorerLinks = getTonExplorerLinks(networkConfig.tonTestnet.explorer, wallet.address)

  console.log('📤 Deploying from wallet (bounceable testable):', walletFormats.bounceableTestable);
  console.log('Explorer:', walletExplorerLinks.bounceableTestableUrl)
  if (argv.verbose) {
    console.log('Also (non-testable):', walletFormats.bounceableNonTestable)
    console.log('Explorer (non-testable):', walletExplorerLinks.bounceableNonTestableUrl)
  }
  const balance = await walletContract.getBalance();
  console.log('💰 Wallet balance:', (Number(balance) / 1e9).toFixed(4), 'TON\n');

  // Compile contract
  console.log('⏳ Compiling MinimalReceiver.tolk...');
  const code = await compile('MinimalReceiver');

  // Build initial storage: Storage { router: address }
  // Only the Router address is stored — the router is the sole authorized caller.
  const routerAddress = Address.parse(TON_ROUTER);
  const routerFormats = getDifferentAddressFormats(routerAddress)
  const routerExplorerLinks = getTonExplorerLinks(networkConfig.tonTestnet.explorer, routerAddress)

  const initialData = beginCell()
    .storeAddress(routerAddress) // router: only the Router can send CCIPReceive messages
    .endCell();

  // Calculate contract address
  const stateInit = { code, data: initialData };
  const receiverAddress = contractAddress(0, stateInit);
  const receiverFormats = getDifferentAddressFormats(receiverAddress)
  const receiverExplorerLinks = getTonExplorerLinks(networkConfig.tonTestnet.explorer, receiverAddress)

  console.log('📍 Contract will be deployed at (bounceable testable):', receiverFormats.bounceableTestable);
  console.log('📍 Router address (authorized caller, bounceable testable):', routerFormats.bounceableTestable)
  if (argv.verbose) {
    console.log('Contract also (non-testable):', receiverFormats.bounceableNonTestable)
    console.log('Router also (non-testable):', routerFormats.bounceableNonTestable)
    console.log('Router explorer (testable):', routerExplorerLinks.bounceableTestableUrl)
    console.log('Router explorer (non-testable):', routerExplorerLinks.bounceableNonTestableUrl)
  }

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

  console.log('\n✅ MinimalReceiver deployment initiated!');
  console.log('📍 Contract address (bounceable testable):', receiverFormats.bounceableTestable);
  console.log('📝 Next steps:');
  console.log('1. Wait 1-2 minutes for the transaction to be confirmed');
  console.log('2. Add this address to your .env file as TON_RECEIVER_ADDRESS');
  console.log('3. Verify deployment on TON explorer:');
  console.log(`   Bounceable (testable): ${receiverExplorerLinks.bounceableTestableUrl}`);
  if (argv.verbose) {
    console.log(`   Bounceable (non-testable): ${receiverExplorerLinks.bounceableNonTestableUrl}`);
  }
  console.log('4. Send a test message to the deployed receiver:');
  console.log(`   npm run evm2ton:send -- --sourceChain <source-chain> --tonReceiver ${receiverFormats.bounceableTestable} --msg "Hello TON from EVM" --feeToken native`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });
