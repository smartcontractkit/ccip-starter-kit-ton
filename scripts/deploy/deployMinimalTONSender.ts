import { toNano, beginCell, contractAddress } from '@ton/core';
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
  console.log('🚀 Deploying MinimalSender contract to TON Testnet...\n');

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
  console.log('⏳ Compiling MinimalSender.tolk...');
  const code = await compile('MinimalSender');

  // MinimalSender has no persistent storage — it is a stateless relay contract.
  // The initial data cell is empty.
  const initialData = beginCell().endCell();

  // Calculate contract address
  const stateInit = { code, data: initialData };
  const senderAddress = contractAddress(0, stateInit);
  const senderFormats = getDifferentAddressFormats(senderAddress)
  const senderExplorerLinks = getTonExplorerLinks(networkConfig.tonTestnet.explorer, senderAddress)

  console.log('📍 Contract will be deployed at (bounceable testable):', senderFormats.bounceableTestable);
  if (argv.verbose) {
    console.log('Contract also (non-testable):', senderFormats.bounceableNonTestable)
  }

  // Deploy contract
  console.log('\n⏳ Sending deployment transaction...');
  await walletContract.sendTransfer({
    seqno: await walletContract.getSeqno(),
    secretKey: keyPair.secretKey,
    messages: [
      internal({
        to: senderAddress,
        value: toNano('0.1'),
        bounce: false,
        init: stateInit,
      }),
    ],
  });

  console.log('\n✅ MinimalSender deployment initiated!');
  console.log('📍 Contract address (bounceable testable):', senderFormats.bounceableTestable);
  console.log('📝 Next steps:');
  console.log('1. Wait 1-2 minutes for the transaction to be confirmed');
  console.log('2. Add this address to your .env file as TON_SENDER_ADDRESS');
  console.log('3. Verify deployment on TON explorer:');
  console.log(`   Bounceable (testable): ${senderExplorerLinks.bounceableTestableUrl}`);
  if (argv.verbose) {
    console.log(`   Bounceable (non-testable): ${senderExplorerLinks.bounceableNonTestableUrl}`);
  }
  console.log('4. Send a CCIP message via the deployed sender:');
  console.log(`   npm run ton2evm:send:via-sender -- --destChain <dest-chain> --evmReceiver <evm-receiver> --tonSender ${senderFormats.bounceableTestable} --msg "Hello EVM from TON"`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });
