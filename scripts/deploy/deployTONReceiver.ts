import { Address, toNano, fromNano, beginCell, contractAddress } from '@ton/core';
import { compile } from '@ton/blueprint';
import { TonClient, WalletContractV4, internal } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import * as dotenv from 'dotenv';
import { networkConfig } from '../../helper-config';
import { getDifferentAddressFormats, getTonExplorerLinks } from '../ton-utils/addressFormats';

dotenv.config();

async function main() {
  console.log('🚀 Deploying MessageReceiver contract to TON Testnet...\n');

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
  console.log('⏳ Compiling MessageReceiver.tolk...');
  const code = await compile('MessageReceiver');
  
  // Build initial data (storage) for test receiver
  // Storage { id: uint32, ownable: Ownable2Step, authorizedCaller: address, behavior: uint8 }
  const routerAddress = Address.parse(networkConfig.tonTestnet.router);
  const ownerAddress = wallet.address;  // Make deployer the owner
  
  const initialData = beginCell()
    .storeUint(0, 32)                // id: 0
    .storeAddress(ownerAddress)      // ownable.owner
    .storeBit(false)                 // ownable.pendingOwner (null)
    .storeAddress(routerAddress)     // authorizedCaller (Router - sends CCIPReceive messages)
    .storeUint(0, 8)                 // behavior: ReceiverBehavior.Accept (0)
    .endCell();

  // Calculate contract address
  const stateInit = { code, data: initialData };
  const receiverAddress = contractAddress(0, stateInit);
  const receiverFormats = getDifferentAddressFormats(receiverAddress)
  const receiverExplorerLinks = getTonExplorerLinks(networkConfig.tonTestnet.explorer, receiverAddress)

  console.log('📍 Contract will be deployed at:', receiverFormats.bounceableNonTestable);
  console.log('📍 Router address (authorized caller):', networkConfig.tonTestnet.router)

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

  console.log('\n✅ MessageReceiver deployment initiated!');
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

