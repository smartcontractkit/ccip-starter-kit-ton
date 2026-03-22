import { Address, beginCell, fromNano, internal as createInternal, toNano } from '@ton/core'
import { TonClient, WalletContractV4 } from '@ton/ton'
import { mnemonicToPrivateKey } from '@ton/crypto'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { supportedEvmChains, networkConfig } from '../../helper-config'
import { encodeEVMAddress, buildExtraArgsForEVM, buildCCIPMessageForEVM, getCCIPFeeForEVM } from '../utils/utils'
import { getDifferentAddressFormats, getTonExplorerLinks } from '../ton-utils/addressFormats'

// Opcode for CCIPSender_RelayCCIPSend
const CCIP_SENDER_RELAY_OPCODE = 0x00000001;

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
  .option('tonSender', {
    type: 'string',
    description: 'Deployed MinimalSender contract address on TON',
    demandOption: true,
  })
  .parseSync()

async function sendTONToEVMViaSender() {
  const destChain = networkConfig[argv.destChain as keyof typeof networkConfig]
  const feeTokenChoice = argv.feeToken
  const tonNativeFeeToken = '0:0000000000000000000000000000000000000000000000000000000000000001'
  const selectedFeeToken = feeTokenChoice === 'native' ? tonNativeFeeToken : tonNativeFeeToken

  const mnemonic = process.env.TON_MNEMONIC;
  if (!mnemonic) throw new Error('TON_MNEMONIC is not set in .env');

  console.log('🧪 Testing TON → EVM Messaging via MinimalSender\n')
  console.log('🌐 Destination Chain:', argv.destChain)
  console.log('💸 Fee Token:', argv.feeToken)

  const endpoint = networkConfig.tonTestnet.rpcUrl
  const client = new TonClient({ endpoint })

  const master = await client.getMasterchainInfo()
  console.log('✅ Connected to TON, Block:', master.latestSeqno)

  // Setup wallet
  const keyPair = await mnemonicToPrivateKey(mnemonic.split(' '))
  const wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey })
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

  const senderAddress = Address.parse(argv.tonSender)
  const senderFormats = getDifferentAddressFormats(senderAddress)
  const routerAddress = Address.parse(networkConfig.tonTestnet.router)
  const destChainSelector = BigInt(destChain.chainSelector)
  const feeToken = Address.parse(selectedFeeToken)

  const data = beginCell()
    .storeStringTail(argv.msg)
    .endCell()

  const extraArgs = buildExtraArgsForEVM(100_000, true) // 100k gas limit
  const seqno = await walletContract.getSeqno()
  console.log('🔑 QueryID (seqno):', seqno)
  console.log('📨 Sender contract:', senderFormats.bounceableNonTestable)

  const ccipSendMessage = {
    queryID: BigInt(seqno),
    destChainSelector,
    receiver: encodeEVMAddress(argv.evmReceiver),
    data,
    tokenAmounts: [],
    feeToken,
    extraArgs,
  }

  const fee = await getCCIPFeeForEVM(client, routerAddress, destChainSelector, ccipSendMessage)
  // Add a 10% buffer
  const feeWithBuffer = (fee * 110n) / 100n
  // Fixed gas execution cost at the source — the Router needs this to fund the downstream
  // routing chain (OffRamp, ReceiveExecutor, etc.). Must be forwarded on top of the CCIP fee.
  const gasReserve = 500_000_000n // 0.5 TON
  // Total value to attach when forwarding to the Router
  const valueToAttach = feeWithBuffer + gasReserve
  // Overhead to cover the sender contract's own execution costs
  const senderOverhead = toNano('0.1')

  console.log(`\n💸 Estimated CCIP fee: ${fee.toString()} nanoTON (${fromNano(fee)} TON)`)
  console.log(`💸 Fee with 10% buffer: ${feeWithBuffer.toString()} nanoTON (${fromNano(feeWithBuffer)} TON)`)
  console.log(`💸 Gas reserve (for Router routing chain): ${fromNano(gasReserve)} TON`)
  console.log(`💸 Value to attach to Router: ${fromNano(valueToAttach)} TON`)
  console.log(`💸 Sender overhead: ${fromNano(senderOverhead)} TON`)
  console.log(`💸 Total to send: ${fromNano(valueToAttach + senderOverhead)} TON`)

  if (balance < valueToAttach + senderOverhead) {
    console.error(
      `❌ Insufficient balance. Required at least ${fromNano(valueToAttach + senderOverhead)} TON (fee + gas reserve + sender overhead), have ${fromNano(balance)} TON.`
    )
    return
  }

  // Build the Router_CCIPSend cell
  const ccipSendCell = buildCCIPMessageForEVM(
    ccipSendMessage.queryID,
    destChainSelector,
    ccipSendMessage.receiver,
    data,
    feeToken,
    extraArgs
  )

  // Build CCIPSender_RelayCCIPSend message:
  //   opcode (uint32) | routerAddress | valueToAttach (coins) | message (Cell<Router_CCIPSend>)
  const relayMsg = beginCell()
    .storeUint(CCIP_SENDER_RELAY_OPCODE, 32)
    .storeAddress(routerAddress)      // routerAddress: forwarded to the CCIP Router
    .storeCoins(valueToAttach)         // valueToAttach: CCIP fee + gas reserve for routing chain
    .storeRef(ccipSendCell)           // message: Cell<Router_CCIPSend>
    .endCell()

  await walletContract.sendTransfer({
    seqno,
    secretKey: keyPair.secretKey,
    messages: [
      createInternal({
        to: senderAddress,
        value: valueToAttach + senderOverhead, // covers valueToAttach (fee + gas reserve) + sender gas costs
        body: relayMsg,
      })
    ]
  })

  console.log('\n✅ Transaction sent!\n')
  console.log('🔍 Monitor your transaction:')
  console.log(`   ${walletExplorerLinks.bounceableNonTestableUrl}`)
  console.log('')
  console.log(`🔍 Monitor delivery on ${argv.destChain}:`)
  console.log(`   ${destChain.explorer}/address/${argv.evmReceiver}\n`)
  console.log('💡 Run verification scripts after a few minutes:\n')
  console.log('1. Check router ACK/NACK status:')
  console.log('   All recent CCIP sends:')
  console.log(`     npm run utils:checkLastTxs -- --address ${argv.tonSender} --ccipSendOnly true`)
  console.log(`   This specific send (queryID: ${seqno}):`)
  console.log(`     npm run utils:checkLastTxs -- --address ${argv.tonSender} --queryId ${seqno}\n`)
  console.log('2. Once ACK is confirmed, verify delivery on EVM:')
  console.log(`     npm run utils:checkEVM -- --destChain ${argv.destChain} --evmReceiver ${argv.evmReceiver} --msg "${argv.msg}"`)
}

sendTONToEVMViaSender().catch((error) => {
  console.error('❌ Error:', error.message)
  process.exit(1)
})
