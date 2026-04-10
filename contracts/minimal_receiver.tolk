// SPDX-License-Identifier: MIT
// Minimal CCIP Receiver example for TON
//
// This contract documents the critical steps every CCIP receiver on TON must implement:
//
//   1. Accept CCIPReceive messages ONLY from the authorized CCIP Router.
//   2. Verify the attached value (gas limit) is sufficient.
//      The Router needs at least 0.02 TON to process the confirmation message,
//      so MIN_VALUE should be set above that and account for your own execution costs.
//   3. Send Router_CCIPReceiveConfirm back to the Router so the protocol can mark
//      the message as successfully delivered.
//
// The Receiver library (lib/receiver/) exposes a validateAndConfirm helper that
// encapsulates these same checks and is suitable for simple receivers. However it
// may not fit more complex use cases, and is still in early development. Users are
// responsible for correctly attaching to the protocol as message receivers.
//
// Always benchmark your receiver and set MIN_VALUE based on your actual execution costs.

import "../chainlink-ton/contracts/contracts/lib/utils"             // emit
import "../chainlink-ton/contracts/contracts/lib/receiver/types"    // Any2TVMMessage
import "../chainlink-ton/contracts/contracts/lib/receiver/errors"   // Receiver_Error
import "../chainlink-ton/contracts/contracts/lib/receiver/messages" // Receiver_CCIPReceive
import "../chainlink-ton/contracts/contracts/ccip/router/messages"  // Router_CCIPReceiveConfirm

// ── Storage ──────────────────────────────────────────────────────────────────

struct Storage {
    /// The CCIP Router address. Only the Router is allowed to send CCIPReceive messages.
    router: address;
}

fun Storage.load(): Storage {
    return Storage.fromCell(contract.getData());
}

fun Storage.store(self) {
    return contract.setData(self.toCell());
}

// ── Constants ─────────────────────────────────────────────────────────────────

/// Minimum value (gas limit) the sender must attach to a CCIPReceive message.
///
/// The Router needs at least 0.02 TON to forward the confirmation back through the
/// protocol chain. Use 0.03 TON as a baseline and increase it to cover your own
/// execution costs. Benchmark your contract logic and set this accordingly.
const MIN_VALUE: coins = ton("0.03");

// ── Error codes ───────────────────────────────────────────────────────────────
//
// Uses Receiver_Error from lib/receiver/errors.tolk (imported transitively via
// lib/receiver/messages). Unauthorized = 5400, LowValue = 5401.

// ── Events ────────────────────────────────────────────────────────────────────

const RECEIVED_MESSAGE_TOPIC = 0xc5a40ab3; // crc32("Receiver_CCIPMessageReceived")

struct CCIPMessageReceived {
    message: Any2TVMMessage;
}

// ── Entry point ───────────────────────────────────────────────────────────────

type MinimalReceiver_InMessage = Receiver_CCIPReceive;

fun onInternalMessage(in: InMessage) {
    val msg = lazy MinimalReceiver_InMessage.fromSlice(in.body);
    match (msg) {
        Receiver_CCIPReceive => {
            val st = lazy Storage.load();

            // 1. Accept messages only from the authorized CCIP Router.
            assert(in.senderAddress == st.router) throw (Receiver_Error.Unauthorized as int);

            // 2. Verify enough value is attached to cover gas costs.
            //    The Router needs at least 0.02 TON for the confirmation message.
            //    Increase MIN_VALUE to account for your contract's execution costs.
            assert(in.valueCoins >= MIN_VALUE) throw (Receiver_Error.LowValue as int);

            // 3. Send CCIPReceiveConfirm back to the Router.
            //    SEND_MODE_CARRY_ALL_REMAINING_MESSAGE_VALUE forwards all remaining TON
            //    (gas limit minus fees so far) to pay for the confirmation transaction.
            val receiveConfirm = createMessage({
                bounce: true,
                value: 0,
                dest: in.senderAddress,
                body: Router_CCIPReceiveConfirm {
                    execId: msg.execId,
                }
            });
            receiveConfirm.send(SEND_MODE_CARRY_ALL_REMAINING_MESSAGE_VALUE);

            // 4. Handle the received CCIP message.
            // ★ YOUR LOGIC STARTS HERE — call your application function(s) with msg.message.
            processMessage(msg.message);
            // ★ YOUR LOGIC ENDS HERE
        }
        else => {
            // Ignore plain TON transfers; reject unknown opcodes.
            assert(in.body.isEmpty()) throw 0xFFFF;
        }
    }
}

// ── Application logic ─────────────────────────────────────────────────────────

// ★ REPLACE THIS FUNCTION with your own message handling logic.
//   `message.data` contains the payload sent from the source chain.
//   `message.sourceChainSelector` identifies the originating chain.
//   `message.sender` is the cross-chain address of the sender.
fun processMessage(message: Any2TVMMessage) {
    emit(RECEIVED_MESSAGE_TOPIC, CCIPMessageReceived {
        message: message,
    });
}
