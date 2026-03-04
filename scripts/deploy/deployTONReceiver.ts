import { Address, toNano, beginCell, contractAddress } from '@ton/core';
import { compile } from '@ton/blueprint';
import { TonClient, WalletContractV4, internal } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import * as dotenv from 'dotenv';
import { TON_TESTNET } from '../../config/constants';

dotenv.config();

async function main() {
  console.log('🚀 Deploying MessageReceiver contract to TON Testnet...\n');

  // TON Router address - this is what sends CCIPReceive messages to the receiver
  const TON_ROUTER = TON_TESTNET.ROUTER;

  // Connect to TON (API key is automatically included if TON_API_KEY is set in .env)
  const endpoint = TON_TESTNET.RPC_URL;
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

  console.log('📤 Deploying from wallet:', wallet.address.toString());
  const balance = await walletContract.getBalance();
  console.log('💰 Wallet balance:', (Number(balance) / 1e9).toFixed(4), 'TON\n');

  // Compile contract
  console.log('⏳ Compiling MessageReceiver.tolk...');
  const code = await compile('MessageReceiver');
  
  // Build initial data (storage) for test receiver
  // Storage { id: uint32, ownable: Ownable2Step, authorizedCaller: address, behavior: uint8 }
  const routerAddress = Address.parse(TON_ROUTER);
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

  console.log('📍 Contract will be deployed at:', receiverAddress.toString());
  console.log('📍 Router address (authorizedCaller):', TON_ROUTER);

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
  console.log('📍 Contract address:', receiverAddress.toString());
  console.log('📝 Next steps:');
  console.log('1. Wait 1-2 minutes for the transaction to be confirmed');
  console.log('2. Add this address to your .env file as TON_RECEIVER_ADDRESS');
  console.log('3. Verify deployment on TON explorer:');
  console.log(`   https://testnet.tonviewer.com/${receiverAddress.toString()}`);
  console.log('\n💡 Check deployment status:');
  console.log(`   npm run utils:checkTON`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });

