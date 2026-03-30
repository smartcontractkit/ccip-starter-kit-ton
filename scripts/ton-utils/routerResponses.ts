/**
 * TON CCIP Router Response Parsing and Detection
 * 
 * This module handles parsing and correlating Router ACK/NACK responses with CCIP Send messages.
 * Since TON explorer shows transactions as successful even when CCIP messages fail (e.g., insufficient fees),
 * you must explicitly check the Router's response to validate CCIP message delivery.
 * 
 * CCIP Workflow:
 * 1. Send Router_CCIPSend message with queryID → Router validates
 * 2. Router responds to wallet with either ACK or NACK (same queryID)
 * 3. Use these utilities to find and match responses to your sends
 * 
 * Response Types:
 * - Router_CCIPSendACK (0x78d0f21e): Message accepted, includes messageId for cross-chain tracking
 * - Router_CCIPSendNACK (0x5a45d434): Message rejected, includes error code
 * 
 * Common NACK Error Codes:
 * - 1002 (0x3ea): Insufficient CCIP fee - increase feeWithBuffer in sendMessage script
 * - Other codes indicate router validation failures
 * 
 * Key Functions:
 * - isCCIPSendTx: Detect if a transaction sends Router_CCIPSend to the router
 * - getCCIPSendQueryIdFromTx: Extract the queryID from a CCIP_SEND message
 * - parseRouterResponseFromTx: Extract ACK/NACK response from a transaction
 * - findBestResponseForSendTx: Match a CCIP_SEND tx with its corresponding ACK/NACK response by queryID
 * 
 * Usage Example:
 *   const isSend = isCCIPSendTx(txFromWallet, routerAddress);
 *   if (isSend) {
 *     const queryID = getCCIPSendQueryIdFromTx(txFromWallet, routerAddress);
 *     const response = findBestResponseForSendTx(txFromWallet, queryID, allResponses);
 *     if (response?.type === 'ACK') console.log('✅ Success:', response.messageId);
 *     if (response?.type === 'NACK') console.error('❌ Failed:', response.error);
 *   }
 */

import { Address, Cell } from '@ton/core'
import { ethers } from 'ethers'

export const ROUTER_CCIP_SEND_OPCODE = 0x31768d95
export const ROUTER_CCIP_SEND_ACK_OPCODE = 0x78d0f21e
export const ROUTER_CCIP_SEND_NACK_OPCODE = 0x5a45d434

export type RouterACK = {
  queryID: bigint
  messageId: string
}

export type RouterNACK = {
  queryID: bigint
  error: bigint
}

export type RouterResponse =
  | { type: 'ACK'; data: RouterACK }
  | { type: 'NACK'; data: RouterNACK }

export type RouterResponseTx = {
  txHash: string
  txTime: number
  type: 'ACK' | 'NACK'
  queryID: bigint
  messageId?: string
  error?: bigint
}

export function parseRouterResponseFromCell(cell: Cell): RouterResponse | null {
  try {
    const slice = cell.beginParse()
    const opcode = slice.loadUint(32)

    if (opcode === ROUTER_CCIP_SEND_ACK_OPCODE) {
      return {
        type: 'ACK',
        data: {
          queryID: slice.loadUintBig(64),
          messageId: ethers.toBeHex(slice.loadUintBig(256), 32),
        },
      }
    }

    if (opcode === ROUTER_CCIP_SEND_NACK_OPCODE) {
      return {
        type: 'NACK',
        data: {
          queryID: slice.loadUintBig(64),
          error: slice.loadUintBig(256),
        },
      }
    }

    return null
  } catch {
    return null
  }
}

export function isCCIPSendTx(tx: any, routerAddress: Address): boolean {
  const outMessages = tx?.outMessages?.values?.() ?? []

  for (const msg of outMessages) {
    if (msg.info?.type !== 'internal') continue
    if (!(msg.info.dest instanceof Address) || !msg.info.dest.equals(routerAddress)) continue
    if (!msg.body) continue

    try {
      const opcode = msg.body.beginParse().loadUint(32)
      if (opcode === ROUTER_CCIP_SEND_OPCODE) {
        return true
      }
    } catch {
      continue
    }
  }

  return false
}

export function getCCIPSendQueryIdFromTx(tx: any, routerAddress: Address): bigint | null {
  const outMessages = tx?.outMessages?.values?.() ?? []

  for (const msg of outMessages) {
    if (msg.info?.type !== 'internal') continue
    if (!(msg.info.dest instanceof Address) || !msg.info.dest.equals(routerAddress)) continue
    if (!msg.body) continue

    try {
      const slice = msg.body.beginParse()
      const opcode = slice.loadUint(32)
      if (opcode !== ROUTER_CCIP_SEND_OPCODE) continue
      return slice.loadUintBig(64)
    } catch {
      continue
    }
  }

  return null
}

export function parseRouterResponseFromTx(tx: any, routerAddress: Address): RouterResponseTx | null {
  if (!tx?.inMessage || tx.inMessage.info?.type !== 'internal' || !tx.inMessage.body) {
    return null
  }

  const src = tx.inMessage.info.src
  if (!(src instanceof Address) || !src.equals(routerAddress)) {
    return null
  }

  const parsed = parseRouterResponseFromCell(tx.inMessage.body)
  if (!parsed) {
    return null
  }

  return {
    txHash: tx.hash().toString('hex'),
    txTime: tx.now,
    type: parsed.type,
    queryID: parsed.data.queryID,
    messageId: parsed.type === 'ACK' ? parsed.data.messageId : undefined,
    error: parsed.type === 'NACK' ? parsed.data.error : undefined,
  }
}

export function findBestResponseForSendTx(
  sendTx: any,
  queryID: bigint | null,
  responses: RouterResponseTx[],
): RouterResponseTx | null {
  if (queryID === null) return null

  const candidates = responses
    .filter((r) => r.queryID === queryID && r.txTime >= sendTx.now)
    .sort((a, b) => a.txTime - b.txTime)

  return candidates[0] ?? null
}