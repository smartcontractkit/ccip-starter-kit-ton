import { ethers } from 'ethers'
import { Address, beginCell, Cell } from '@ton/core'
import { TonClient } from '@ton/ton'
import OnRampArtifact from '../../artifacts/@chainlink/contracts-ccip/contracts/onRamp/OnRamp.sol/OnRamp.json'
import { networkConfig, supportedEvmChains } from '../../helper-config'

const onRampInterface = new ethers.Interface(OnRampArtifact.abi)

const GENERIC_EXTRA_ARGS_V2_TAG = '0x181dcf10'
const CCIP_SEND_OPCODE = 0x31768d95

/**
 * [EVM → TON] Encodes a TON address into the 36-byte format expected by the EVM CCIP Router.
 * Format: 4-byte workchain (int32, big-endian) + 32-byte address hash.
 * Source: chainlink-ton/pkg/ccip/codec/addresscodec.go
 */
export function encodeTONAddress(addr: Address): Uint8Array {
  const workchainBytes = new Uint8Array(4)
  new DataView(workchainBytes.buffer).setInt32(0, addr.workChain, false)
  return ethers.getBytes(ethers.concat([workchainBytes, addr.hash]))
}

/**
 * [TON → EVM] Encodes an EVM address into the 44-byte format expected by the TON CCIP Router.
 * Format: 12 zero-bytes (left-pad) + 20-byte EVM address.
 */
export function encodeEVMAddress(evmAddr: string): Buffer {
  const addrBytes = Buffer.from(evmAddr.slice(2), 'hex')
  return Buffer.concat([Buffer.alloc(12, 0), addrBytes])
}

/**
 * [EVM → TON] Encodes GenericExtraArgsV2 as ABI bytes for the EVM CCIP Router.
 * gasLimit is in nanoTON (e.g. 100_000_000n = 0.1 TON).
 */
export function buildExtraArgsForTON(gasLimitNanoTON: bigint | number, allowOutOfOrderExecution: boolean): Uint8Array {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'bool'],
    [gasLimitNanoTON, allowOutOfOrderExecution]
  )
  return ethers.getBytes(ethers.concat([GENERIC_EXTRA_ARGS_V2_TAG, encoded]))
}

/**
 * [TON → EVM] Builds a GenericExtraArgsV2 TL-B Cell for the TON CCIP Router.
 * gasLimit is in EVM gas units (e.g. 1_000_000).
 */
export function buildExtraArgsForEVM(gasLimitEVMUnits: number, allowOutOfOrderExecution: boolean): Cell {
  return beginCell()
    .storeUint(0x181dcf10, 32)          // GenericExtraArgsV2 tag
    .storeBit(true)                      // gasLimit IS present
    .storeUint(gasLimitEVMUnits, 256)   // gasLimit value
    .storeBit(allowOutOfOrderExecution) // allowOutOfOrderExecution
    .endCell()
}

/**
 * [TON → EVM] Builds the CCIPSend message Cell for the TON CCIP Router.
 */
export function buildCCIPMessageForEVM(
  queryID: bigint | number,
  destChainSelector: bigint | number,
  receiverBytes: Buffer,
  data: Cell,
  feeToken: Address,
  extraArgs: Cell
): Cell {
  return beginCell()
    .storeUint(CCIP_SEND_OPCODE, 32)
    .storeUint(queryID, 64)                  // queryID
    .storeUint(destChainSelector, 64)       // destChainSelector
    .storeUint(receiverBytes.length, 8)     // receiver length
    .storeBuffer(receiverBytes)             // receiver bytes
    .storeRef(data)                         // data
    .storeRef(Cell.EMPTY)                   // tokenAmounts (empty)
    .storeAddress(feeToken)                 // feeToken
    .storeRef(extraArgs)                    // extraArgs
    .endCell()
}

/**
 * [EVM → TON] Builds the CCIP message struct for the EVM CCIP Router.
 */
export function buildCCIPMessageForTON(
  receiver: Uint8Array,
  data: Uint8Array,
  gasLimitNanoTON: bigint | number,
  allowOutOfOrderExecution: boolean,
  feeToken: string = ethers.ZeroAddress
) {
  return {
    receiver,
    data,
    tokenAmounts: [],
    feeToken,
    extraArgs: buildExtraArgsForTON(gasLimitNanoTON, allowOutOfOrderExecution)
  }
}

export type TonCCIPSendMessage = {
  queryID: bigint
  destChainSelector: bigint
  receiver: Buffer
  data: Cell
  tokenAmounts: unknown[]
  feeToken: Address
  extraArgs: Cell
}

/**
 * [EVM → TON] Extracts the CCIP messageId from an EVM transaction receipt
 * by parsing the CCIPMessageSent event emitted by the OnRamp.
 */
export function extractCCIPMessageIdForTON(receipt: ethers.TransactionReceipt): string | null {
  for (const log of receipt.logs) {
    try {
      const parsed = onRampInterface.parseLog(log)
      if (parsed?.name === 'CCIPMessageSent') {
        return parsed.args.message.header.messageId as string
      }
    } catch {
      continue
    }
  }
  return null
}

/**
 * [EVM → TON] Gets CCIP fee quote from EVM Router.
 */
export async function getCCIPFeeForTON(
  router: ethers.Contract,
  destChainSelector: bigint | number,
  message: ReturnType<typeof buildCCIPMessageForTON>,
): Promise<bigint> {
  return (await router.getFee(destChainSelector, message)) as bigint
}

/**
 * [TON → EVM] Gets validated CCIP fee quote from TON FeeQuoter via Router -> OnRamp.
 * queryID is forwarded as-is; the FeeQuoter ignores it during fee calculation.
 */
export async function getCCIPFeeForEVM(
  client: TonClient,
  routerAddress: Address,
  destChainSelector: bigint,
  ccipSendMessage: TonCCIPSendMessage,
): Promise<bigint> {
  if (ccipSendMessage.destChainSelector !== destChainSelector) {
    throw new Error('destChainSelector mismatch between function arg and ccipSendMessage')
  }

  if (ccipSendMessage.tokenAmounts.length !== 0) {
    throw new Error('Token transfers are not supported by direct fee-cell builder')
  }

  const onRampRes = await client.runMethod(routerAddress, 'onRamp', [{ type: 'int', value: destChainSelector }])
  const onRampAddr = onRampRes.stack.readAddress()

  const feeQuoterRes = await client.runMethod(onRampAddr, 'feeQuoter', [{ type: 'int', value: destChainSelector }])
  const feeQuoterAddr = feeQuoterRes.stack.readAddress()

  const ccipSendCell = buildCCIPMessageForEVM(
    ccipSendMessage.queryID,
    ccipSendMessage.destChainSelector,
    ccipSendMessage.receiver,
    ccipSendMessage.data,
    ccipSendMessage.feeToken,
    ccipSendMessage.extraArgs,
  )

  const feeRes = await client.runMethod(feeQuoterAddr, 'validatedFeeCell', [{ type: 'cell', cell: ccipSendCell }])
  return feeRes.stack.readBigNumber()
}

export type EvmChainConfig = (typeof networkConfig)[(typeof supportedEvmChains)[number]]

export function getRpcUrlForEvmChain(config: EvmChainConfig): string {
  const rpcUrlEnv = `${config.networkIdentifier}_RPC_URL`
  const rpcUrl = process.env[rpcUrlEnv]
  if (!rpcUrl) {
    throw new Error(`Missing required env var ${rpcUrlEnv} for RPC URL`)
  }
  return rpcUrl
}

/**
 * Retrieves the EVM chain configuration for the given chain name.
 * @throws if the chain is not found in networkConfig.
 */
export function getEvmChainConfig(chain: string): EvmChainConfig {
  const config = networkConfig[chain as (typeof supportedEvmChains)[number]];
  if (!config) {
    throw new Error(
      `Unsupported EVM chain: "${chain}". Supported chains: ${supportedEvmChains.join(', ')}.`
    );
  }
  return config;
}
