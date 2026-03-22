import { toNano, fromNano, beginCell, contractAddress } from '@ton/core';
import { compile } from '@ton/blueprint';
import { TonClient, WalletContractV4, internal } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import * as dotenv from 'dotenv';
import { networkConfig } from '../../helper-config';
import { getDifferentAddressFormats, getTonExplorerLinks } from '../ton-utils/addressFormats';

dotenv.config();

async function main() {
  console.log('🚀 Deploying MinimalSender contract to TON Testnet...\n');

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
  const walletFormats = getDifferentAddressFormats(wallet.address)
  const walletExplorerLinks = getTonExplorerLinks(networkConfig.tonTestnet.explorer, wallet.address)

  console.log('📤 Deploying from wallet:', walletFormats.bounceableNonTestable);
  console.log('Explorer:', walletExplorerLinks.bounceableNonTestableUrl)
  const balance = await walletContract.getBalance();
  console.log('💰 Wallet balance:', fromNano(balance), 'TON\n');

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

  console.log('📍 Contract will be deployed at:', senderFormats.bounceableNonTestable);

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
  console.log('📍 Contract address:', senderFormats.bounceableNonTestable);
  console.log('📝 Next steps:');
  console.log('1. Wait 1-2 minutes for the transaction to be confirmed');
  console.log('2. Copy the contract address above — pass it as --tonSender when sending messages via the sender contract');
  console.log('3. Verify deployment on TON explorer:');
  console.log(`   ${senderExplorerLinks.bounceableNonTestableUrl}`);
  console.log('4. Send a CCIP message via the deployed sender:');
  console.log(`   npm run ton2evm:send:via-sender -- --destChain <dest-chain> --evmReceiver <evm-receiver> --tonSender ${senderFormats.bounceableNonTestable} --msg "Hello EVM from TON" --feeToken native`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });
