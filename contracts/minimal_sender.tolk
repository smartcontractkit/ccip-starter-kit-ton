// SPDX-License-Identifier: MIT
// Minimal CCIP Sender example for TON
//
// This contract acts as a reusable on-chain relay for CCIP sends.
// Instead of sending CCIPSend messages directly from a wallet, you deploy
// this contract once and trigger sends by sending it a RelayCCIPSend message.
//
// The contract:
//   1. Receives a RelayCCIPSend message containing the pre-built CCIPSend message
//      and the TON value to forward to the Router.
//   2. Forwards the Router_CCIPSend to the CCIP Router with the specified value.
//   3. Handles Router ACK/NACK responses — replace the handlers with your product logic.
//
// This pattern is useful when your application logic lives on-chain and needs to
// initiate cross-chain sends from within a smart contract.

import "../chainlink-ton/contracts/contracts/ccip/router/messages"  // Router_CCIPSend, Router_CCIPSendACK, Router_CCIPSendNACK

// ── Messages ──────────────────────────────────────────────────────────────────

/// Sent to this contract to trigger a CCIP send.
///
/// routerAddress: the CCIP Router to forward the message to.
/// valueToAttach: the TON amount to attach when forwarding to the Router.
///               Must cover the CCIP fee — query getCCIPFee off-chain before sending.
///               The total value sent to this contract must be valueToAttach plus
///               enough extra to cover this contract's own execution costs (~0.1 TON).
///               Any TON surplus above compute costs is returned via ACK (message accepted)
///               or NACK (message rejected — both fee and surplus are returned).
/// message: the pre-built Router_CCIPSend message cell.
struct (0x00000001) CCIPSender_RelayCCIPSend {
    routerAddress: address;
    valueToAttach: coins;
    message: Cell<Router_CCIPSend>;
}

// ── Entry point ───────────────────────────────────────────────────────────────

type MinimalSender_InMessage =
    | CCIPSender_RelayCCIPSend
    | Router_CCIPSendACK
    | Router_CCIPSendNACK;

fun onInternalMessage(in: InMessage) {
    val msg = lazy MinimalSender_InMessage.fromSlice(in.body);
    match (msg) {
        CCIPSender_RelayCCIPSend => {
            onRelayCCIPSend(msg);
        }
        Router_CCIPSendACK => {
            // ★ CCIP message was accepted by the Router.
            //   msg.messageId contains the unique CCIP message ID.
            //   Any TON surplus above compute costs is returned here; the fee is not refunded.
            //   Add your on-chain success handling here (e.g. update state, emit event).
            return;
        }
        Router_CCIPSendNACK => {
            // ★ CCIP send was rejected by the Router.
            //   Both the fee and any TON surplus are returned here since the message was not accepted.
            //   msg.error contains the Router exit code indicating the rejection reason.
            //   Add your on-chain failure handling here (e.g. refund, retry logic).
            throw msg.error;
        }
        else => {
            // Ignore plain TON transfers; reject unknown opcodes.
            assert(in.body.isEmpty()) throw 0xFFFF;
        }
    }
}

// ── Relay logic ───────────────────────────────────────────────────────────────

fun onRelayCCIPSend(msg: CCIPSender_RelayCCIPSend) {
    val message = createMessage({
        bounce: true,
        value: msg.valueToAttach,
        dest: msg.routerAddress,
        body: msg.message,
    });
    message.send(SEND_MODE_REGULAR);
}
