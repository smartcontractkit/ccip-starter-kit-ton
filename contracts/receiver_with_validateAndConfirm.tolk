// SPDX-License-Identifier: MIT
// CCIP Receiver example using the Receiver library for TON
//
// This contract demonstrates using the validateAndConfirm helper from the
// Chainlink Receiver library (lib/receiver/messages) to handle the three
// mandatory protocol steps in a single call:
//
//   1. Accept CCIPReceive messages ONLY from the authorized CCIP Router.
//   2. Verify the attached value (gas limit) is sufficient.
//   3. Send Router_CCIPReceiveConfirm back to the Router.
//
// When to use this approach vs. inline checks (minimal_receiver.tolk):
//   - Use the library for simple receivers where the default behaviour fits.
//   - Use inline checks (see minimal_receiver.tolk) for more complex receivers
//     or when you need precise control over each protocol step.
//
// IMPORTANT: The Receiver library is still in early development. Always
// benchmark your contract and set MIN_VALUE to cover your actual execution
// costs. The Router needs at least 0.02 TON to process the confirmation
// message — use 0.03 TON as a safe baseline and increase from there.

import "../chainlink-ton/contracts/contracts/lib/utils"             // emit
import "../chainlink-ton/contracts/contracts/lib/receiver/types"    // Any2TVMMessage
import "../chainlink-ton/contracts/contracts/lib/receiver/messages" // Receiver_CCIPReceive, validateAndConfirm

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

// ── Events ────────────────────────────────────────────────────────────────────

const RECEIVED_MESSAGE_TOPIC = 0xc5a40ab3; // crc32("Receiver_CCIPMessageReceived")

struct CCIPMessageReceived {
    message: Any2TVMMessage;
}

// ── Entry point ───────────────────────────────────────────────────────────────

type ReceiverWithLib_InMessage = Receiver_CCIPReceive;

fun onInternalMessage(in: InMessage) {
    val msg = lazy ReceiverWithLib_InMessage.fromSlice(in.body);
    match (msg) {
        Receiver_CCIPReceive => {
            val st = lazy Storage.load();

            // Performs all three mandatory protocol steps in one call:
            //   1. Verifies the sender is the authorized CCIP Router.
            //   2. Verifies the attached value meets MIN_VALUE.
            //   3. Sends CCIPReceiveConfirm back to the Router, forwarding
            //      all remaining TON via SEND_MODE_CARRY_ALL_REMAINING_MESSAGE_VALUE.
            msg.validateAndConfirm({
                router: st.router,
                minValue: MIN_VALUE,
                inMsg: {
                    senderAddress: in.senderAddress,
                    valueCoins: in.valueCoins,
                },
                confirmationMsg: {
                    sendMode: SEND_MODE_CARRY_ALL_REMAINING_MESSAGE_VALUE,
                }
            });

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
