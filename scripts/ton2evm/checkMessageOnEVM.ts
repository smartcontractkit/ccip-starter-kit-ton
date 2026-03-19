import { ethers } from 'ethers'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { supportedEvmChains, networkConfig, ccipExplorerUrl } from '../../helper-config'
import { getEvmChainConfig, getRpcUrlForEvmChain } from '../utils/utils'

/**
 * Verify that a TON → EVM message was delivered
 *
 * Usage:
 *   npm run utils:checkEVM                                           # Check latest message
 *   npm run utils:checkEVM -- --destChain sepolia                    # Select destination EVM chain
 *   npm run utils:checkEVM -- --msg "Hello EVM"                     # Verify specific message content
 */
const argv = yargs(hideBin(process.argv))
  .option('destChain', {
    type: 'string',
    description: 'Destination EVM chain',
    choices: supportedEvmChains,
    demandOption: true,
  })
  .option('msg', {
    type: 'string',
    description: 'Expected message content to match against',
    default: 'Hello EVM from TON',
  })
  .option('evmReceiver', {
    type: 'string',
    description: 'EVM receiver contract address',
    demandOption: true,
  })
  .option('verbose', {
    type: 'boolean',
    description: 'Show additional address format details',
    default: false,
  })
  .parseSync()

async function verifyEVMReceiver() {
  const destChain = getEvmChainConfig(argv.destChain)

  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  TON → EVM Message Verification')
  console.log('═══════════════════════════════════════════════════════════════\n')

  const provider = new ethers.JsonRpcProvider(getRpcUrlForEvmChain(destChain))
  const expectedMessageId = process.env.MESSAGE_ID
  const expectedMessage = argv.msg
  
  const receiverABI = [
    "event MessageFromTON(bytes32 indexed messageId, uint64 indexed sourceChainSelector, bytes sender, bytes data)",
    "function getLastMessage() external view returns (bytes32, bytes)"
  ]

  const receiver = new ethers.Contract(
    argv.evmReceiver,
    receiverABI,
    provider
  )

  console.log('📍 Receiver Contract:', argv.evmReceiver)
  console.log('🌐 Destination Chain:', argv.destChain)
  console.log('🔍 Looking for message:', `"${expectedMessage}"`)
  console.log('🔍 Expected source:', networkConfig.tonTestnet.chainSelector, '(TON Testnet)\n')

  if (expectedMessageId) {
    console.log('🎯 Searching for specific Message ID:', expectedMessageId, '\n')
  }

  // Check contract state for latest message
  console.log('📊 Checking contract state...\n')
  
  let lastMessageId: string = ethers.ZeroHash
  let lastMessageData: string = ''
  
  try {
    const [messageId, data] = await receiver.getLastMessage()
    lastMessageId = messageId
    lastMessageData = data

    console.log('📨 Latest message in contract state:')
    console.log('   Message ID:  ', lastMessageId)
    console.log('   Message:     ', `"${ethers.toUtf8String(lastMessageData)}"`)
  } catch (error: any) {
    console.log('⚠️  Could not read contract state (contract may not have getLastMessage)')
  }

  // Query events for more details
  const currentBlock = await provider.getBlockNumber()
  const fromBlock = currentBlock - 5000 // ~17 hours of blocks
  
  console.log('📊 Scanning blocks', fromBlock, 'to', currentBlock, '...\n')

  const filter = receiver.filters.MessageFromTON()
  const events = await receiver.queryFilter(filter, fromBlock, currentBlock)

  if (events.length === 0) {
    console.log('❌ No MessageFromTON events found in recent blocks\n')
    console.log('⏳ If you just sent a message from TON, it may still be in transit.')
    console.log('   CCIP delivery typically takes 5-15 minutes.\n')
    printHelp()
    return
  }

  // Get the most recent event
  const latestEvent = events[events.length - 1] as any
  const block = await provider.getBlock(latestEvent.blockNumber)
  const timestamp = block ? new Date(block.timestamp * 1000) : new Date()
  
  // Decode the message
  let decodedMessage = ''
  try {
    decodedMessage = ethers.toUtf8String(latestEvent.args?.data || '0x')
  } catch {
    decodedMessage = '[Binary data]'
  }

  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  ✅ CCIP MESSAGE FOUND')
  console.log('═══════════════════════════════════════════════════════════════\n')

  console.log('📨 Most Recent Message:')
  console.log('   Message ID:  ', latestEvent.args?.messageId)
  console.log('   CCIP Explorer:', `${ccipExplorerUrl}/${latestEvent.args?.messageId}`)
  console.log('   Source Chain:', latestEvent.args?.sourceChainSelector?.toString(), '(TON Testnet ✓)')
  console.log('   Message:     ', `"${decodedMessage}"`)
  console.log('   Block:       ', latestEvent.blockNumber)
  console.log('   Time:        ', timestamp.toISOString())
  console.log('   TX Hash:     ', latestEvent.transactionHash)
  console.log('')

  // Calculate time ago
  const minutesAgo = Math.round((Date.now() - timestamp.getTime()) / 60000)
  if (minutesAgo < 60) {
    console.log(`   📍 Received ${minutesAgo} minute(s) ago`)
  } else {
    console.log(`   📍 Received ${Math.round(minutesAgo / 60)} hour(s) ago`)
  }
  console.log('')

  // Verification result
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  VERIFICATION RESULT')
  console.log('═══════════════════════════════════════════════════════════════\n')

  // Check if message matches expected
  const messageMatches = decodedMessage === expectedMessage
  const sourceMatches = latestEvent.args?.sourceChainSelector?.toString() === networkConfig.tonTestnet.chainSelector
  const idMatches = !expectedMessageId || latestEvent.args?.messageId === expectedMessageId

  if (messageMatches && sourceMatches) {
    console.log('✅ Message verified successfully!')
    console.log('')
    console.log('   ✓ Message content matches:', `"${expectedMessage}"`)
    console.log('   ✓ Source chain is TON Testnet')
    if (expectedMessageId && idMatches) {
      console.log('   ✓ Message ID matches')
    }
    console.log('')
  } else if (sourceMatches && minutesAgo < 30) {
    console.log('✅ Recent TON → EVM message delivered!')
    console.log('')
    if (!messageMatches) {
      console.log(`   ⚠️  Message content differs:`)
      console.log(`      Expected: "${expectedMessage}"`)
      console.log(`      Received: "${decodedMessage}"`)
      console.log('')
      console.log('   This is normal if you sent a different message.')
    }
  } else {
    console.log('⚠️  Latest message is older than 30 minutes.')
    console.log('')
    console.log('   If you recently sent a message from TON,')
    console.log('   it may still be in transit. Wait and check again.\n')
  }

  // Show transaction link
  console.log('🔗 View transaction:')
  console.log(`   ${destChain.explorer}/tx/${latestEvent.transactionHash}\n`)

  // Show all messages if multiple
  if (events.length > 1) {
    console.log(`📊 Total messages found: ${events.length}`)
    console.log('   (showing most recent above)\n')
    
    console.log('Recent messages:')
    const recentEvents = events.slice(-5).reverse()
    for (let i = 0; i < recentEvents.length; i++) {
      const evt = recentEvents[i] as any
      let msg = ''
      try {
        msg = ethers.toUtf8String(evt.args?.data || '0x')
      } catch {
        msg = '[Binary]'
      }
      console.log(`   ${i + 1}. Block ${evt.blockNumber}: "${msg.slice(0, 30)}${msg.length > 30 ? '...' : ''}"`)
    }
    console.log('')
  }
}

function printHelp() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  TROUBLESHOOTING')
  console.log('═══════════════════════════════════════════════════════════════\n')
  console.log('1. Confirm your TON send transaction was accepted (not bounced):')
  console.log(`   ${networkConfig.tonTestnet.explorer}/<your-TON-sender-address>\n`)
  console.log('2. Wait 5-15 minutes for CCIP to process\n')
  console.log('3. If still not working after 20 minutes, check:')
  console.log('   - Is EVM_RECEIVER_ADDRESS correct in .env?')
  console.log('   - Did the TON transaction succeed (no bounce)?')
}

verifyEVMReceiver().catch((error) => {
  console.error('❌ Error:', error.message)
  process.exit(1)
})
