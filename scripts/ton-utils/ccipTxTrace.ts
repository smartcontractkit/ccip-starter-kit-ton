/**
 * CCIP Transaction Tracing and Inspection Utilities
 * 
 * This module provides utilities for analyzing and inspecting CCIP (Cross-Chain Interoperability Protocol)
 * transactions on TON blockchain using the TonAPI.
 * 
 * Key Functions:
 * - getCcipTraceTxHash: Examines the transaction trace tree of a destination tx to find intermediate
 *   CCIP routing transactions by looking for the CCIP_TRACE_OPCODE.
 * 
 * - checkTransactionMessageMatch: Verifies if a transaction contains an expected message by decoding
 *   its raw message body and performing UTF-8 text extraction and comparison.
 * 
 * - extractMessageIdFromReceiverTx: Extracts the CCIP messageId (256-bit uint) from a receiver contract
 *   transaction's inMessage body by parsing the CCIPReceive message structure (opcode + execId + Any2TVMMessage).
 * 
 * Usage Examples:
 *   const traceHash = await getCcipTraceTxHash(destinationTxHash)
 *   const result = await checkTransactionMessageMatch(txHash, expectedMessage)
 *   const messageId = extractMessageIdFromReceiverTx(receiverTransaction)
 */

const TONAPI_TESTNET_BASE_URL = 'https://testnet.tonapi.io/v2'
const CCIP_TRACE_OPCODE = '0x59e56170'

import { ethers } from 'ethers'

type TonApiTraceNode = {
  transaction?: {
    hash?: string
    lt?: number
    in_msg?: {
      op_code?: string
    }
  }
  children?: TonApiTraceNode[]
}

type TonApiTransaction = {
  in_msg?: {
    raw_body?: string
  }
}

export type MessageMatchResult = {
  matches: boolean
  foundMessage: string | null
}

function decodeRawBodyBytes(rawBody: string): Buffer | null {
  const trimmed = rawBody.trim()
  const hexBody = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed

  if (/^[0-9a-fA-F]+$/.test(hexBody) && hexBody.length % 2 === 0) {
    return Buffer.from(hexBody, 'hex')
  }

  if (/^[A-Za-z0-9+/=]+$/.test(trimmed)) {
    try {
      return Buffer.from(trimmed, 'base64')
    } catch {
      return null
    }
  }

  return null
}

function flattenTraceTransactions(
  node: TonApiTraceNode,
  out: NonNullable<TonApiTraceNode['transaction']>[] = [],
) {
  if (node.transaction) {
    out.push(node.transaction)
  }

  for (const child of node.children ?? []) {
    flattenTraceTransactions(child, out)
  }

  return out
}

export async function getCcipTraceTxHash(receiverTxHash: string): Promise<string | null> {
  try {
    const response = await fetch(`${TONAPI_TESTNET_BASE_URL}/traces/${receiverTxHash}`)
    if (!response.ok) {
      return null
    }

    const trace = (await response.json()) as TonApiTraceNode
    const traceTxs = flattenTraceTransactions(trace)

    const targetTx = traceTxs
      .filter((tx) => tx.hash && tx.in_msg?.op_code === CCIP_TRACE_OPCODE)
      .sort((a, b) => (b.lt ?? 0) - (a.lt ?? 0))[0]

    return targetTx?.hash ?? null
  } catch {
    return null
  }
}

export async function transactionContainsExpectedMessage(
  txHash: string,
  expectedMessage: string,
): Promise<boolean> {
  const result = await checkTransactionMessageMatch(txHash, expectedMessage)
  return result.matches
}

function extractLikelyUtf8Message(rawBodyHex: string): string | null {
  const bytes = decodeRawBodyBytes(rawBodyHex)
  if (!bytes || bytes.length === 0) {
    return null
  }

  let best = ''
  let current: number[] = []

  const flush = () => {
    if (current.length < 4) {
      current = []
      return
    }

    const candidate = Buffer.from(current).toString('utf8').trim()
    const looksLikeMessage = /[a-zA-Z]/.test(candidate)

    if (looksLikeMessage && candidate.length > best.length) {
      best = candidate
    }

    current = []
  }

  for (const byte of bytes) {
    const isPrintableAscii = byte >= 32 && byte <= 126
    if (isPrintableAscii) {
      current.push(byte)
    } else {
      flush()
    }
  }

  flush()

  if (!best) {
    return null
  }

  // Strip common framing chars that can appear when parsing raw TON message payloads.
  const cleaned = best.replace(/^[^a-zA-Z0-9]+/, '')
  return cleaned || best
}

export async function checkTransactionMessageMatch(
  txHash: string,
  expectedMessage: string,
): Promise<MessageMatchResult> {
  try {
    const response = await fetch(`${TONAPI_TESTNET_BASE_URL}/blockchain/transactions/${txHash}`)
    if (!response.ok) {
      return { matches: false, foundMessage: null }
    }

    const tx = (await response.json()) as TonApiTransaction
    const rawBody = tx.in_msg?.raw_body
    if (!rawBody) {
      return { matches: false, foundMessage: null }
    }

    const bodyBytes = decodeRawBodyBytes(rawBody)
    if (!bodyBytes) {
      return { matches: false, foundMessage: null }
    }

    const rawBodyHex = bodyBytes.toString('hex')
    const expectedHex = Buffer.from(expectedMessage, 'utf8').toString('hex')
    const matches = rawBodyHex.toLowerCase().includes(expectedHex.toLowerCase())

    if (matches) {
      return { matches: true, foundMessage: expectedMessage }
    }

    const foundMessage = extractLikelyUtf8Message(rawBody)

    return {
      matches: false,
      foundMessage,
    }
  } catch {
    return { matches: false, foundMessage: null }
  }
}

export function extractMessageIdFromReceiverTx(tx: any): string | null {
  try {
    if (!tx?.inMessage?.body) return null
    const slice = tx.inMessage.body.beginParse()
    
    // Skip opcode (32 bits)
    slice.skip(32)
    
    // Skip execId (192 bits)
    slice.skip(192)
    
    // Extract messageId as uint256
    const messageId = slice.loadUintBig(256)
    return ethers.toBeHex(messageId, 32)
  } catch {
    return null
  }
}

export function extractSourceChainSelectorFromReceiverTx(tx: any): bigint | null {
  try {
    if (!tx?.inMessage?.body) return null
    const slice = tx.inMessage.body.beginParse()
    
    // Skip opcode (32 bits)
    slice.skip(32)
    
    // Skip execId (192 bits)
    slice.skip(192)
    
    // Skip messageId (256 bits)
    slice.loadUintBig(256)
    
    // Extract sourceChainSelector (uint64)
    return slice.loadUintBig(64)
  } catch {
    return null
  }
}
