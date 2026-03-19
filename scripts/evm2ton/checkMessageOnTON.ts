import { TonClient, Address } from '@ton/ton'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { networkConfig, supportedEvmChains, ccipExplorerUrl } from '../../helper-config'
import { checkTransactionMessageMatch, getCcipTraceTxHash, extractMessageIdFromReceiverTx } from '../ton-utils/ccipTxTrace'
import { getDifferentAddressFormats, getTonExplorerLinks, TonAddressFormats } from '../ton-utils/addressFormats'

/**
 * Verify that an EVM → TON message was delivered
 *
 * Usage:
 *   npm run utils:checkTON                                              # Check latest message
 *   npm run utils:checkTON -- --sourceChain sepolia                     # Select source EVM chain
 *   npm run utils:checkTON -- --msg "Hello TON"                        # Verify specific message content
 *   npm run utils:checkTON -- --sourceChain sepolia --verbose            # Show extra tx trace details
 */
const argv = yargs(hideBin(process.argv))
  .option('sourceChain', {
    type: 'string',
    description: 'Source EVM chain',
    choices: supportedEvmChains,
    demandOption: true,
  })
  .option('msg', {
    type: 'string',
    description: 'Expected message content to match against',
    default: 'Hello TON from EVM',
  })
  .option('tonReceiver', {
    type: 'string',
    description: 'TON receiver contract address',
    demandOption: true,
  })
  .option('verbose', {
    type: 'boolean',
    description: 'Show additional tx trace details',
    default: false,
  })
  .parseSync()

async function verifyTONReceiver() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  EVM → TON Message Verification')
  console.log('═══════════════════════════════════════════════════════════════\n')

  const client = new TonClient({ endpoint: networkConfig.tonTestnet.rpcUrl })
  const receiverAddr = Address.parse(argv.tonReceiver)
  const receiverFormats = getDifferentAddressFormats(receiverAddr)
  const receiverExplorerLinks = getTonExplorerLinks(networkConfig.tonTestnet.explorer, receiverAddr)
  const expectedMessage = argv.msg

  console.log('📍 Receiver Contract (bounceable testable):', receiverFormats.bounceableTestable)
  if (argv.verbose) {
    console.log('Also (non-testable):', receiverFormats.bounceableNonTestable)
  }
  console.log('🌐 Source Chain:', argv.sourceChain)
  console.log('🔍 Looking for message:', `"${expectedMessage}"`)
  console.log('🔍 Expected sender:', networkConfig.tonTestnet.router, '(CCIP Router)\n')

  // Get recent transactions
  console.log('📊 Fetching recent transactions...\n')
  
  const transactions = await client.getTransactions(receiverAddr, { limit: 20 })

  if (transactions.length === 0) {
    console.log('❌ No transactions found on receiver contract')
    console.log('⚠️  Receiver might not be deployed or no messages sent yet\n')
    printHelp(receiverFormats, receiverExplorerLinks)
    return
  }

  // Look for CCIP messages from OffRamp
  let ccipMessages: any[] = []
  const txMap = new Map<string, any>()
  
  for (const tx of transactions) {
    const hash = tx.hash().toString('hex')
    txMap.set(hash, tx)
    const inMsg = tx.inMessage
    if (inMsg && inMsg.info.type === 'internal') {
      const from = inMsg.info.src
      const value = inMsg.info.value.coins
      const time = new Date(tx.now * 1000)
      
      // Check if from Router (CCIP message)
      if (from?.toString() === networkConfig.tonTestnet.router) {
        ccipMessages.push({
          from: from.toString(),
          value: Number(value) / 1e9,
          time,
          lt: tx.lt,
          hash: hash
        })
      }
    }
  }

  if (ccipMessages.length === 0) {
    console.log('❌ No CCIP messages found yet')
    console.log('')
    console.log('⏳ If you just sent a message, it may still be in transit.')
    console.log('   CCIP delivery typically takes 5-15 minutes.\n')
    printHelp(receiverFormats, receiverExplorerLinks)
    return
  }

  let latest = ccipMessages[0]
  let matchedExactMessage = false
  let foundMessage: string | null = null

  for (const candidate of ccipMessages) {
    const result = await checkTransactionMessageMatch(candidate.hash, expectedMessage)

    if (!foundMessage && result.foundMessage) {
      foundMessage = result.foundMessage
    }

    if (result.matches) {
      latest = candidate
      matchedExactMessage = true
      foundMessage = result.foundMessage ?? expectedMessage
      break
    }
  }

  if (!matchedExactMessage) {
    console.log('❌ No exact message match found in recent CCIP deliveries')
    console.log(`   Expected exact message: "${expectedMessage}"`)
    console.log(`   Found message:          ${foundMessage ? `"${foundMessage}"` : '(unable to decode payload text)'}`)
    console.log('')
    console.log('💡 Tip: check the latest delivered message with --verbose and ensure text matches exactly (case-sensitive).')
    return
  }

  // Show the matched CCIP message
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  ✅ CCIP MESSAGE FOUND')
  console.log('═══════════════════════════════════════════════════════════════\n')

  const ccipTraceTxHash = await getCcipTraceTxHash(latest.hash)
  const destinationTxHash = ccipTraceTxHash ?? latest.hash
  
  // Extract message ID from transaction
  const fullTx = txMap.get(latest.hash)
  const messageId = fullTx ? extractMessageIdFromReceiverTx(fullTx) : null

  console.log('📨 Most Recent CCIP Message:')
  console.log('   From:               ', latest.from, '(CCIP Router ✓)')
  console.log('   Value:              ', latest.value, 'TON')
  console.log('   Time:               ', latest.time.toISOString())
  console.log('   Expected Message:   ', `"${expectedMessage}"`)
  console.log('   Found Message:      ', foundMessage ? `"${foundMessage}"` : '(unable to decode payload text)')
  if (messageId) {
    console.log('   Message ID:         ', messageId)
    console.log('   CCIP Explorer:      ', `${ccipExplorerUrl}/${messageId}`)
  }
  console.log('   Destination TX Hash:', destinationTxHash)
  if (argv.verbose) {
    console.log('   Receiver TX Hash:   ', latest.hash)
    if (!ccipTraceTxHash) {
      console.log('   Trace Lookup:       fallback to receiver tx hash')
    }
  }
  console.log('')

  // Calculate time ago
  const minutesAgo = Math.round((Date.now() - latest.time.getTime()) / 60000)
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

  if (minutesAgo < 30) {
    console.log('✅ Recent CCIP message delivered successfully!')
    console.log('')
    console.log('   If you sent a message in the last 30 minutes,')
    console.log('   this is likely your message.\n')
  } else {
    console.log('⚠️  Latest CCIP message is older than 30 minutes.')
    console.log('')
    console.log('   If you recently sent a message, it may still be in transit.')
    console.log('   Wait a few more minutes and check again.\n')
  }

  // Show all CCIP messages if multiple
  if (ccipMessages.length > 1) {
    console.log(`📊 Total CCIP messages found: ${ccipMessages.length}`)
    console.log('   (showing most recent above)\n')
  }

  console.log('🔗 View on explorer:')
  console.log(`   Bounceable (testable): ${receiverExplorerLinks.bounceableTestableUrl}`)
  if (argv.verbose) {
    console.log(`   Bounceable (non-testable): ${receiverExplorerLinks.bounceableNonTestableUrl}`)
  }
  console.log('')
  console.log(`   TX: ${networkConfig.tonTestnet.explorer}/transaction/${destinationTxHash}`)
}

function printHelp(receiverFormats: TonAddressFormats, receiverExplorerLinks: { bounceableTestableUrl: string; bounceableNonTestableUrl: string }) {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  TROUBLESHOOTING')
  console.log('═══════════════════════════════════════════════════════════════\n')
  console.log('1. Verify you sent the EVM → TON message:')
  console.log(`   npm run evm2ton:send -- --sourceChain ${argv.sourceChain} --tonReceiver ${argv.tonReceiver} --msg "${argv.msg}"\n`)
  console.log('2. Wait 5-15 minutes for CCIP to process\n')
  console.log('3. Check source-chain TX and TON receiver activity:')
  console.log(`   Source explorer: ${networkConfig[argv.sourceChain as keyof typeof networkConfig].explorer}`)
  console.log(`   TON receiver (bounceable testable): ${receiverExplorerLinks.bounceableTestableUrl}`)
  if (argv.verbose) {
    console.log(`   TON receiver (bounceable non-testable): ${receiverExplorerLinks.bounceableNonTestableUrl}`)
    console.log(`   TON address (bounceable testable): ${receiverFormats.bounceableTestable}`)
    console.log(`   TON address (bounceable non-testable): ${receiverFormats.bounceableNonTestable}`)
  }
  console.log('')
  console.log('4. If still not working after 20 minutes, check:')
  console.log('   - Is TON_RECEIVER_ADDRESS correct in .env?')
  console.log('   - Did the EVM transaction succeed?')
}

verifyTONReceiver().catch((error) => {
  console.error('❌ Error:', error.message)
  process.exit(1)
})
