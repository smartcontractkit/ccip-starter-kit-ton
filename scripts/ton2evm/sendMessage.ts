import { Address, beginCell, fromNano, internal as createInternal, toNano } from '@ton/core'
import { TonClient, WalletContractV4 } from '@ton/ton'
import { mnemonicToPrivateKey } from '@ton/crypto'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { supportedEvmChains, networkConfig } from '../../helper-config'
import { encodeEVMAddress, buildExtraArgsForEVM, buildCCIPMessageForEVM, getCCIPFeeForEVM } from '../utils/utils'
import { getDifferentAddressFormats, getTonExplorerLinks } from '../ton-utils/addressFormats'

const argv = yargs(hideBin(process.argv))
  .option('destChain', {
    type: 'string',
    description: 'Destination EVM chain',
    choices: supportedEvmChains,
    demandOption: true,
  })
  .option('msg', {
    type: 'string',
    description: 'Message string to send to the EVM receiver',
    default: 'Hello EVM from TON',
  })
  .option('feeToken', {
    type: 'string',
    description: 'Fee token for CCIP fee payment on TON',
    choices: [networkConfig.tonTestnet.feeTokenNameNative],
    default: networkConfig.tonTestnet.feeTokenNameNative,
  })
  .option('evmReceiver', {
    type: 'string',
    description: 'EVM receiver contract address',
    demandOption: true,
  })
  .parseSync()

async function sendTONToEVM() {
  const destChain = networkConfig[argv.destChain as keyof typeof networkConfig]
  const feeTokenChoice = argv.feeToken
  const tonNativeFeeToken = networkConfig.tonTestnet.nativeTokenAddress
  const selectedFeeToken = feeTokenChoice === 'native' ? tonNativeFeeToken : tonNativeFeeToken

  const mnemonic = process.env.TON_MNEMONIC;
  if (!mnemonic) throw new Error('TON_MNEMONIC is not set in .env');

  console.log('🧪 Testing TON → EVM Messaging\n')
  console.log('🌐 Destination Chain:', argv.destChain)
  console.log('💸 Fee Token:', argv.feeToken)

  const endpoint = networkConfig.tonTestnet.rpcUrl
  const client = new TonClient({ endpoint })

  const master = await client.getMasterchainInfo()
  console.log('✅ Connected to TON, Block:', master.latestSeqno)

  // Setup wallet
  const keyPair = await mnemonicToPrivateKey(mnemonic.split(' '))
  const wallet = WalletContractV4.create({
    workchain: 0,
    publicKey: keyPair.publicKey
  })
  const walletFormats = getDifferentAddressFormats(wallet.address)
  const walletExplorerLinks = getTonExplorerLinks(networkConfig.tonTestnet.explorer, wallet.address)
  const walletContract = client.open(wallet)

  console.log('📤 Sending from:', walletFormats.bounceableNonTestable)

  // Check balance
  const balance = await client.getBalance(wallet.address)
  console.log('💰 Balance:', fromNano(balance), 'TON\n')

  if (balance < toNano('0.1')) {
    console.error('❌ Insufficient balance. Need at least 0.1 TON')
    console.log('Get testnet TON from @testgiver_ton_bot on Telegram')
    return
  }

  // Verify receiver address is set
  const evmReceiverAddr = argv.evmReceiver
  const routerAddress = Address.parse(networkConfig.tonTestnet.router)
  const destChainSelector = BigInt(destChain.chainSelector)
  const feeToken = Address.parse(selectedFeeToken)

  const data = beginCell()
    .storeStringTail(argv.msg)
    .endCell()

  const extraArgs = buildExtraArgsForEVM(100_000, true) // 100k gas limit
  const seqno = await walletContract.getSeqno()
  console.log('🔑 QueryID (seqno):', seqno)

  const ccipSendMessage = {
    queryID: BigInt(seqno),
    destChainSelector,
    receiver: encodeEVMAddress(evmReceiverAddr),
    data,
    tokenAmounts: [],
    feeToken,
    extraArgs,
  }

  const fee = await getCCIPFeeForEVM(client, routerAddress, destChainSelector, ccipSendMessage)
  // Add a 10% buffer
  const feeWithBuffer = (fee * 110n) / 100n
  // Fixed gas execution cost at the source (covers wallet-level gas and source execution)
  const gasReserve = 500_000_000n // 0.5 TON

  console.log(`💸 Estimated CCIP fee: ${fee.toString()} nanoTON (${fromNano(fee)} TON)`)
  console.log(`💸 Fee with 10% buffer: ${feeWithBuffer.toString()} nanoTON (${fromNano(feeWithBuffer)} TON)`)
  console.log(`💸 Gas reserve: ${fromNano(gasReserve)} TON`)

  if (balance < feeWithBuffer + gasReserve) {
    console.error(
      `❌ Insufficient balance for quoted fee. Required at least ${fromNano(feeWithBuffer + gasReserve)} TON (fee + gas reserve), have ${fromNano(balance)} TON.`
    )
    console.log('Try funding the wallet or lowering gas limit for cheaper execution.')
    return
  }

  const ccipSend = buildCCIPMessageForEVM(
    ccipSendMessage.queryID, // seqno is used as queryID: unique per wallet, monotonically increasing, collision-free
    destChainSelector,
    ccipSendMessage.receiver,
    data,
    feeToken,
    extraArgs
  )

  
  await walletContract.sendTransfer({
    seqno,
    secretKey: keyPair.secretKey,
    messages: [
      createInternal({
        to: routerAddress,            // Router address 
        value: feeWithBuffer + gasReserve,
        body: ccipSend,               // Direct CCIPSend message
      })
    ]
  })

  console.log('✅ Transaction sent!\n')
  console.log('🔍 Monitor your transaction:')
  console.log(`   ${walletExplorerLinks.bounceableNonTestableUrl}`)
  console.log('')
  console.log(`🔍 Monitor delivery on ${argv.destChain}:`)
  console.log(`   ${destChain.explorer}/address/${evmReceiverAddr}\n`)
  console.log('💡 Run verification scripts after a few minutes:\n')
  console.log('1. Check router ACK/NACK status:')
  console.log('   All recent CCIP sends:')
  console.log('     npm run utils:checkLastTxs -- --ccipSendOnly true')
  console.log(`   This specific send (queryID: ${seqno}):`)
  console.log(`     npm run utils:checkLastTxs -- --queryId ${seqno}\n`)
  console.log('2. Once ACK is confirmed, verify delivery on EVM:')
  console.log(`     npm run utils:checkEVM -- --destChain ${argv.destChain} --evmReceiver ${evmReceiverAddr} --msg "${argv.msg}"`)
}

sendTONToEVM().catch((error) => {
  console.error('❌ Error:', error.message)
  process.exit(1)
})