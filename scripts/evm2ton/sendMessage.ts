import { ethers } from 'ethers'
import { Address } from '@ton/core'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { supportedEvmChains, networkConfig, ccipExplorerUrl } from '../../helper-config'
import IRouterClientArtifact from '../../artifacts/@chainlink/contracts-ccip/contracts/interfaces/IRouterClient.sol/IRouterClient.json'
import { buildCCIPMessageForTON, extractCCIPMessageIdForTON, getCCIPFeeForTON, getEvmChainConfig, getRpcUrlForEvmChain } from '../utils/utils'
import { getTonExplorerLinks } from '../ton-utils/addressFormats'

const erc20Abi = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)'
]

const argv = yargs(hideBin(process.argv))
  .option('sourceChain', {
    type: 'string',
    description: 'Source EVM chain',
    choices: supportedEvmChains,
    demandOption: true,
  })
  .option('msg', {
    type: 'string',
    description: 'Message string to send to the TON receiver',
    default: 'Hello TON from EVM',
  })
  .option('feeToken', {
    type: 'string',
    description: 'Fee token for CCIP fee payment on source EVM chain',
    choices: [networkConfig.tonTestnet.feeTokenNameNative , networkConfig.tonTestnet.feeTokenNameLink],
    default: networkConfig.tonTestnet.feeTokenNameNative,
  })
  .option('tonReceiver', {
    type: 'string',
    description: 'TON receiver contract address',
    demandOption: true,
  })
  .parseSync()

async function sendEVMToTON() {
  const sourceChain = getEvmChainConfig(argv.sourceChain)
  const feeTokenChoice = argv.feeToken
  const selectedFeeToken = feeTokenChoice === networkConfig.tonTestnet.feeTokenNameNative ? ethers.ZeroAddress : sourceChain.linkTokenAddress

  const privateKey = process.env.EVM_PRIVATE_KEY;
  if (!privateKey) throw new Error('EVM_PRIVATE_KEY is not set in .env');

  if (feeTokenChoice === networkConfig.tonTestnet.feeTokenNameLink && !selectedFeeToken) {
    throw new Error(`LINK fee token is not configured for ${argv.sourceChain}. Set ${sourceChain.networkIdentifier}_LINK_TOKEN in .env`)
  }

  console.log('🧪 Testing EVM → TON Messaging\n')
  console.log('🌐 Source Chain:', argv.sourceChain)
  console.log('💸 Fee Token:', argv.feeToken)

  // Source EVM chain connection
  const endpoint = getRpcUrlForEvmChain(sourceChain)
  const provider = new ethers.JsonRpcProvider(endpoint)
  
  const blockNumber = await provider.getBlockNumber()
  console.log('✅ Connected to EVM, Block:', blockNumber)

  const wallet = new ethers.Wallet(privateKey, provider)
  console.log('📤 Sending from:', wallet.address)

  // Check balance
  const balance = await provider.getBalance(wallet.address)
  console.log('💰 Balance:', ethers.formatEther(balance), sourceChain.nativeCurrencySymbol)

  if (feeTokenChoice === networkConfig.tonTestnet.feeTokenNameLink && selectedFeeToken) {
    const linkToken = new ethers.Contract(selectedFeeToken, erc20Abi, provider)
    const linkBalance: bigint = await linkToken.balanceOf(wallet.address)
    console.log('💰 LINK Balance:', ethers.formatUnits(linkBalance, 18), 'LINK')
  }
  console.log('')

  if (balance < ethers.parseEther('0.01')) {
    console.error(`❌ Insufficient balance. Need at least 0.01 ${sourceChain.nativeCurrencySymbol}`)
    console.log(`Get testnet funds for ${argv.sourceChain} from the relevant faucet`) 
    return
  }

  // Verify receiver address is set
  const tonReceiverAddr = argv.tonReceiver
  const tonAddr = Address.parse(tonReceiverAddr)
  const tonReceiverExplorerLinks = getTonExplorerLinks(networkConfig.tonTestnet.explorer, tonAddr)
  const receiverBytes = new Uint8Array(Buffer.from(tonReceiverAddr, 'base64'))
  const messageData = ethers.toUtf8Bytes(argv.msg)
  const router = new ethers.Contract(sourceChain.router, IRouterClientArtifact.abi, wallet)
  const destChainSelector = BigInt(networkConfig.tonTestnet.chainSelector)
  const message = buildCCIPMessageForTON(receiverBytes, messageData, 100_000_000n, true, selectedFeeToken) // 0.1 TON gas limit

  const fee = await getCCIPFeeForTON(router, destChainSelector, message)
  // Add a 10% buffer 
  const feeWithBuffer = (fee * 110n) / 100n
  let tx

  if (feeTokenChoice === networkConfig.tonTestnet.feeTokenNameNative) {
    tx = await router.ccipSend(destChainSelector, message, {
      value: feeWithBuffer
    })
  } else {
    const linkToken = new ethers.Contract(selectedFeeToken, erc20Abi, wallet)
    const linkBalance: bigint = await linkToken.balanceOf(wallet.address)

    if (linkBalance < feeWithBuffer) {
      throw new Error(`Insufficient LINK balance for fee. Need ${feeWithBuffer.toString()} units, have ${linkBalance.toString()}`)
    }

    const currentAllowance: bigint = await linkToken.allowance(wallet.address, sourceChain.router)
    if (currentAllowance < feeWithBuffer) {
      const approveTx = await linkToken.approve(sourceChain.router, feeWithBuffer)
      await approveTx.wait()
    }

    tx = await router.ccipSend(destChainSelector, message)
  }

  console.log('✅ Transaction submitted!')
  console.log('   Hash:', tx.hash)
  console.log('\n⏳ Waiting for confirmation...')
  
  const receipt = await tx.wait()
  console.log('✅ Transaction confirmed in block:', receipt.blockNumber)
  
  const messageId = extractCCIPMessageIdForTON(receipt)
  if (messageId) {
    console.log('📋 Message ID:', messageId)
    console.log(`🔍 Track on CCIP Explorer: ${ccipExplorerUrl}/${messageId}\n`)
  } else {
    console.warn('⚠️  Could not extract CCIP Message ID from receipt logs')
  }

  console.log('\n⏳ Message is being processed by CCIP network...')
  console.log('⏳ Expected delivery: 5-15 minutes (staging environment)\n')
  console.log('🔍 Monitor your transaction:')
  console.log(`   ${sourceChain.explorer}/tx/${tx.hash}\n`)
  console.log('🔍 Monitor delivery on TON:')
  console.log(`   ${tonReceiverExplorerLinks.bounceableNonTestableUrl}`)
  console.log('')
  console.log('💡 Run verification script after 10-15 minutes:')
  console.log(`   npm run utils:checkTON -- --sourceChain ${argv.sourceChain} --tonReceiver ${argv.tonReceiver} --msg "${argv.msg}"`)
}

sendEVMToTON().catch((error) => {
  console.error('❌ Error:', error.message)
  process.exit(1)
})

