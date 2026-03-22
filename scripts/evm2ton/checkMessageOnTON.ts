import { TonClient, Address, fromNano } from '@ton/ton'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { networkConfig, supportedEvmChains, ccipExplorerUrl } from '../../helper-config'
import { checkTransactionMessageMatch, getCcipTraceTxHash, extractMessageIdFromReceiverTx, extractSourceChainSelectorFromReceiverTx } from '../ton-utils/ccipTxTrace'
import { getDifferentAddressFormats, getTonExplorerLinks } from '../ton-utils/addressFormats'

/**
 * Verify that an EVM → TON message was delivered
 *
 * Usage:
 *   npm run utils:checkTON                                              # Check latest message
 *   npm run utils:checkTON -- --sourceChain sepolia                     # Select source EVM chain
 *   npm run utils:checkTON -- --msg "Hello TON"                        # Verify specific message content
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

  console.log('📍 Receiver Contract:', receiverFormats.bounceableNonTestable)
  console.log('🌐 Source Chain:', argv.sourceChain)
  console.log('🔍 Looking for message:', `"${expectedMessage}"`)
  console.log('🔍 Expected sender:', networkConfig.tonTestnet.router, '(CCIP Router)\n')

  // Get recent transactions
  console.log('📊 Fetching recent transactions...\n')
  
  const transactions = await client.getTransactions(receiverAddr, { limit: 20 })

  if (transactions.length === 0) {
    console.log('❌ No transactions found on receiver contract')
    console.log('⚠️  Receiver might not be deployed or no messages sent yet\n')
    printHelp(receiverExplorerLinks)
    return
  }

  // Look for CCIP messages from the Router, filtered to the expected source chain
  const expectedSourceChainSelector = BigInt(
    (networkConfig[argv.sourceChain as keyof typeof networkConfig] as { chainSelector: string }).chainSelector
  )
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
      
      // Check if from Router (CCIP message) and from the expected source chain
      if (from?.toString() === networkConfig.tonTestnet.router) {
        const sourceChainSelector = extractSourceChainSelectorFromReceiverTx(tx)
        if (sourceChainSelector !== null && sourceChainSelector !== expectedSourceChainSelector) {
          continue
        }
        ccipMessages.push({
          from: from.toString(),
          value: fromNano(value),
          time,
          lt: tx.lt,
          hash: hash
        })
      }
    }
  }

  if (ccipMessages.length === 0) {
    console.log('❌ No CCIP messages found yet\n')
    console.log('⏳ If you just sent a message, it may still be in transit.')
    console.log('   CCIP delivery typically takes 5-15 minutes.\n')
    printHelp(receiverExplorerLinks)
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

  // Show conditional header (exact match or most recent fallback)
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(matchedExactMessage ? '  ✅ CCIP MESSAGE FOUND' : '  📨 MOST RECENT CCIP MESSAGE (no exact match)')
  console.log('═══════════════════════════════════════════════════════════════\n')

  const ccipTraceTxHash = await getCcipTraceTxHash(latest.hash)
  const destinationTxHash = ccipTraceTxHash ?? latest.hash

  // Extract message ID from transaction
  const fullTx = txMap.get(latest.hash)
  const messageId = fullTx ? extractMessageIdFromReceiverTx(fullTx) : null

  console.log('📨 Most Recent CCIP Message:')
  console.log('   From:               ', latest.from, '(CCIP Router ✓)')
  if (messageId) {
    console.log('   Message ID:         ', messageId)
    console.log('   CCIP Explorer:      ', `${ccipExplorerUrl}/${messageId}`)
  }
  console.log('   Value:              ', latest.value, 'TON')
  console.log('   Message:            ', foundMessage ? `"${foundMessage}"` : '(unable to decode)')
  console.log('   Time:               ', latest.time.toISOString())
  console.log('   TX Hash:            ', destinationTxHash)
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

  if (matchedExactMessage) {
    console.log('✅ Message verified successfully!')
    console.log('')
    console.log('   ✓ Message content matches:', `"${expectedMessage}"`)
    console.log('   ✓ From CCIP Router')
    console.log('')
  } else {
    console.log('❌ No exact message match found in recent CCIP deliveries')
    console.log(`   Expected exact message: "${expectedMessage}"`)
    console.log(`   Found message:          ${foundMessage ? `"${foundMessage}"` : '(unable to decode payload text)'}`)
    console.log('')
    console.log('💡 Tip: ensure the --msg value matches exactly (case-sensitive).')
    console.log('')
  }

  // Show all CCIP messages if multiple
  if (ccipMessages.length > 1) {
    console.log(`📊 Total CCIP messages found: ${ccipMessages.length}`)
    console.log('   (showing most recent above)\n')
  }

  console.log('🔗 View on explorer:')
  console.log(`   ${networkConfig.tonTestnet.explorer}/transaction/${destinationTxHash}`)
  console.log(`   Receiver: ${receiverExplorerLinks.bounceableNonTestableUrl}\n`)
}

function printHelp(receiverExplorerLinks: { bounceableNonTestableUrl: string }) {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  TROUBLESHOOTING')
  console.log('═══════════════════════════════════════════════════════════════\n')
  console.log('1. Verify you sent the EVM → TON message:')
  console.log(`   npm run evm2ton:send -- --sourceChain ${argv.sourceChain} --tonReceiver ${argv.tonReceiver} --msg "${argv.msg}"\n`)
  console.log('2. Wait 5-15 minutes for CCIP to process\n')
  console.log('3. Check source-chain TX and TON receiver activity:')
  console.log(`   Source explorer: ${networkConfig[argv.sourceChain as keyof typeof networkConfig].explorer}`)
  console.log(`   TON receiver: ${receiverExplorerLinks.bounceableNonTestableUrl}`)
  console.log('')
  console.log('4. If still not working after 20 minutes, check:')
  console.log('   - Is the --tonReceiver address correct (no typos)?')
  console.log('   - Did the EVM transaction succeed?')
}

verifyTONReceiver().catch((error) => {
  console.error('❌ Error:', error.message)
  process.exit(1)
})
