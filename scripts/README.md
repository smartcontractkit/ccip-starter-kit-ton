# CCIP EVM ↔ TON Encoding Reference

This document covers the **encoding**, **decoding**, and **execution parameters** for Cross-Chain Interoperability Protocol (CCIP) messages between EVM and TON.

Understanding these details is crucial because EVM (Ethereum Virtual Machine) and TVM (TON Virtual Machine) use fundamentally different data structures.

---

## Table of Contents
1. [EVM → TON Messaging](#1-evm--ton-messaging)
   - [Address Encoding (36-Byte Format)](#address-encoding-evm--ton)
   - [ExtraArgs & Execution Parameters](#extraargs--execution-parameters)
   - [Data Payload (Bytes to Cell)](#data-payload-evm--ton)
2. [TON → EVM Messaging](#2-ton--evm-messaging)
   - [Address Encoding (32-Byte Format)](#address-encoding-ton--evm)
   - [ExtraArgs (TL-B Encoding)](#extraargs-tlb-encoding)
   - [Data Payload (Cell to Bytes)](#data-payload-ton--evm)
3. [Byte-Level Encoding Details](#deep-dive-byte-level-encoding)

---

## 1. EVM → TON Messaging
*Script:* `evm2ton/sendMessage.ts`

### Address Encoding (EVM → TON)
**The Challenge:** The EVM Router expects a `bytes` receiver address. However, you cannot just send a string like `"EQB..."`. The TON OffRamp contract needs the raw components to reconstruct the address.

**The Solution:** We encode the TON address into a standardized **36-byte** format.

```typescript
// 1. Parse Friendly Address
const tonAddr = Address.parse("EQB..."); 

// 2. Extract Components
const workchain = tonAddr.workChain; // 0 or -1
const hash = tonAddr.hash;           // 32-byte unique ID

// 3. Pack into 36 Bytes (Big-Endian)
// [ 4 bytes workchain (int32) ] + [ 32 bytes hash ]
const workchainBytes = new Uint8Array(4)
new DataView(workchainBytes.buffer).setInt32(0, workchain, false) // big-endian
const receiverBytes = ethers.concat([workchainBytes, hash])
// e.g. workchain 0  → 0x00000000 + 32-byte hash
// e.g. workchain -1 → 0xffffffff + 32-byte hash
```

### ExtraArgs & Execution Parameters
**The Challenge:** Configuring how the message is executed on the destination chain.

**Key Parameter:** `allowOutOfOrderExecution`
*   **Must be:** `true`
*   **Why?** TON is an **asynchronous blockchain**. Messages travel through different shards and validators. Message #2 might arrive before Message #1. If we enforced strict ordering (like EVM nonces), the CCIP lane would stall if a message arrived "too early."

**Encoding:** Standard ABI encoding with a version tag.
```typescript
const extraArgs = abiCoder.encode(
  ['uint256', 'bool'],
  [
    100_000_000, // gasLimit in nanoTON (0.1 TON = 100,000,000 nanoTON)
    true     // allowOutOfOrderExecution: MUST BE TRUE for TON
  ]
);
// Prepend Version Tag: 0x181dcf10
const finalArgs = ethers.concat(['0x181dcf10', extraArgs]);
```

**Important:** For EVM → TON, the `gasLimit` represents the amount of **TON (in nanoTON)** allocated for executing the message on TON. This is different from EVM gas semantics. The scripts use `100_000_000n` (0.1 TON) as the default.

### Data Payload (EVM → TON)
*   **Input:** `bytes` (EVM side)
*   **Output:** `Cell` (TON side)
*   **Process:** The CCIP bridge wraps your raw bytes into a TON `Cell` automatically. Your TON receiver contract will access this via `body.loadRef()`.

---

## 2. TON → EVM Messaging
*Script:* `ton2evm/sendMessage.ts`

### Address Encoding (TON → EVM)
**The Challenge:** The TON Router uses a `CrossChainAddress` type that encodes addresses as a length-prefixed byte string. For EVM addresses (20 bytes), the value must be left-padded to **32 bytes**.

**The Solution:** **Left-Pad** with zeros, then pass the 32-byte buffer — the `CrossChainAddress` encoding writes a 1-byte length prefix (`0x20`) on the wire automatically.

```typescript
const evmAddr = "0x1234..."; // 20 bytes

// 1. Create 12 bytes of zeros
const padding = Buffer.alloc(12, 0);

// 2. Get raw 20 bytes from address
const addrBytes = Buffer.from(evmAddr.slice(2), 'hex');

// 3. Concatenate: [ 00...00 ] + [ 20-byte address ] = 32 bytes
const receiverBytes = Buffer.concat([padding, addrBytes]);
// On the wire: uint8(32) + these 32 bytes (length-prefixed by CrossChainAddress encoding)
```

### ExtraArgs (TL-B Encoding)
This section covers a common source of errors (such as `Exit Code 9`). The encoding uses **TL-B** (Typed Lambda Binary), specifically `GenericExtraArgsV2`.

**The Logic:**
In TL-B, the `gasLimit` field is optional (`Maybe uint256`).
*   In binary, a "Maybe" type is prefixed by a **1-bit flag**:
    *   `0` = Field is null.
    *   `1` = Field is present.

**Why "Maybe"?**
The `gasLimit` is optional to allow future flexibility and efficiency. If omitted (bit is `0`), the system uses a standard default, saving space and simplifying configuration for standard messages.

**The Code:**
This bit must be explicitly stored. Otherwise, the FeeQuoter will interpret part of the gas limit number as the flag.

```typescript
const extraArgs = beginCell()
  .storeUint(0x181dcf10, 32) // 1. Version Tag
  .storeBit(true)            // 2. Presence bit (gasLimit is present)
  .storeUint(1000000, 256)   // 3. The Gas Limit Value
  .storeBit(true)            // 4. allowOutOfOrderExecution
  .endCell();
```

**Important:** For TON → EVM, the `gasLimit` is in **EVM gas units** (not nanoTON). The scripts use `100_000` EVM gas units as the default.

### Data Payload (TON → EVM)
*   **Input:** `Cell` (TON side)
*   **Output:** `bytes` (EVM side)
*   **Process:** You construct a cell using `beginCell()`.
    ```typescript
    const messageData = beginCell()
      .storeStringTail('Hello EVM')
      .endCell();
    ```
    The CCIP bridge unwraps this cell and delivers the raw content as `bytes` to your EVM contract.

---

## Byte-Level Encoding Details

### 1. The 36-Byte Address (EVM → TON)
The workchain is encoded as a signed 32-bit big-endian integer:
*   Workchain `0`  → `0x00000000` + 32-byte hash
*   Workchain `-1` → `0xffffffff` + 32-byte hash

### 2. The ExtraArgs Bitmask (TON → EVM)
If you send `gasLimit: 1000000`, the binary stream looks like this:

| Field | Size | Value | Binary / Hex |
| :--- | :--- | :--- | :--- |
| **Tag** | 32 bits | `0x181dcf10` | `0001 1000 ...` |
| **gasLimit present?** | 1 bit | `true` | `1` |
| **gasLimit** | 256 bits | `100000` | `00...0186A0` |
| **allowOutOfOrderExecution** | 1 bit | `true` | `1` |

**Without the presence bit:**
The parser interprets the first bit of `1000000` (which is `0`) as the presence flag. It determines that the gas limit is not present and skips reading the value. The next bit is then read as `allowOutOfOrderExecution`, resulting in incorrect data. This causes the transaction to fail with Exit Code 9.

---

## Quick Reference

| Feature | EVM → TON | TON → EVM |
| :--- | :--- | :--- |
| **Address Format** | 36 Bytes (4B workchain int32 + 32B hash) | 32 Bytes zero-padded (12B zeros + 20B address), length-prefixed by `CrossChainAddress` |
| **Ordering** | `allowOutOfOrder = true` (Mandatory) | `allowOutOfOrder = true` (Recommended) |
| **ExtraArgs Fmt** | ABI Encoded (`bytes`) | TL-B Encoded (`Cell`) |
| **gasLimit units** | nanoTON (e.g. `100_000_000n` = 0.1 TON) | EVM gas units (e.g. `100_000`) |
| **Data Format** | `bytes` → Wrapped in `Cell` | `Cell` → Unwrapped to `bytes` |
