# Chainlink CCIP TON Starter Kit

A starter kit for working with Chainlink CCIP cross-chain messaging between TON and EVM chains.

## Prerequisites

Before you begin, ensure you have:

- **Node.js 18+** and npm installed
- **TON wallet** with testnet funds and **24-word mnemonic** (see [TON Wallet Setup](#ton-wallet-setup) and [Getting Test Funds](#getting-test-funds))
- **EVM wallet** with Sepolia ETH (see [Getting Test Funds](#getting-test-funds))
- Basic understanding of CCIP messaging concepts

## TON Wallet Setup

To interact with TON testnet, you need a wallet and its 24-word recovery phrase (mnemonic).

1. Download [TON Keeper](https://tonkeeper.com/) on iOS or Android
2. On the first run, you'll have to create a new wallet
3. Copy the 24-word recovery phrase by selecting the Gear icon then Backup
4. Select "Back Up Manually" and Continue to save the recovery phrase to a safe location. This is your `TON_MNEMONIC`
5. Go back to the main Wallet screen, select the wallet drop-down, and choose "Add Wallet"
6. Scroll to the bottom and select "Testnet Account"
7. Type in the 24-word recovery phrase you saved earlier and select "Continue"
8. Name the wallet "Testnet Wallet" and select Continue
9. Select the Gear icon and select V4R2 as the wallet version (this starter kit uses V4R2)
10. Save the `TON_MNEMONIC` to your `.env` file in quotes (e.g. `TON_MNEMONIC="..."`)

> **Why V4R2?** V4R2 and W5 are different wallet contract versions on TON. The same mnemonic generates different addresses for each version. CCIP TON infrastructure is built for V4R2. You can add additional versions later via Settings > Active Address.

### Get TON Center API Key

If you switch `TON_RPC_URL` to a toncenter endpoint (e.g. `https://testnet.toncenter.com/api/v2/jsonRPC`), you will need a free API key to avoid rate limits:

1. Visit the TON Center API Bot: [@tonapibot](https://t.me/tonapibot) on Telegram
2. Send `/start` to the bot
3. Follow the instructions to get your free testnet API key
4. Add it to your `.env` file: `TON_CENTER_API_KEY="your_api_key_here"`

The default RPC (`https://ton-testnet.api.onfinality.io/public`) does not require a key.

### Getting Test Funds

#### EVM Sepolia Faucets
- [Chainlink Sepolia Faucet](https://faucets.chain.link/sepolia)
- [Alchemy Sepolia Faucet](https://www.alchemy.com/faucets/ethereum-sepolia)
- [Google Cloud Sepolia Faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia)

#### TON Testnet Faucets
- **Telegram Bot**: [@testgiver_ton_bot](https://t.me/testgiver_ton_bot) - Primary faucet for TON testnet
- [Chainstack TON Faucet](https://faucet.chainstack.com/ton-testnet-faucet)

## Setup

### Clone and Install

```bash
git clone https://github.com/smartcontractkit/ton-starter-kit.git
cd ton-starter-kit
git submodule update --init --recursive
npm install
```

### Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and fill in the required values:
- `EVM_PRIVATE_KEY` - Your EVM wallet private key
- `TON_MNEMONIC` - Your 24-word TON wallet mnemonic

All scripts load `.env` automatically — no need to source it.

## Contracts

### TON Receiver Contracts

This starter kit includes three receiver contracts for EVM → TON messaging:

| Contract | Script | When to use |
|---|---|---|
| `chainlink-ton/.../ccip/test/receiver/contract.tolk` | `deploy:ton:receiver` | Full-featured Chainlink test receiver — includes ownership, upgradeability, and configurable behavior (accept/reject/ignore). Good for testing the CCIP lane end-to-end |
| `contracts/minimal_receiver.tolk` | `deploy:ton:receiver:minimal` | Recommended starting point for your own receiver — protocol steps are written inline so each check is visible and easy to modify |
| `contracts/receiver_with_validateAndConfirm.tolk` | `deploy:ton:receiver:validate-and-confirm` | Uses the Receiver library helper to handle all three protocol steps in a single call |

The three mandatory steps every TON CCIP receiver must implement:
1. Accept `CCIPReceive` messages **only from the authorized CCIP Router**
2. Verify the attached value (gas limit) is **sufficient** — the Router needs at least 0.02 TON to process the confirmation, so `MIN_VALUE` should be set above that and account for your own execution costs
3. Send `Router_CCIPReceiveConfirm` back to the Router so the protocol marks the message as delivered

> **Note:** `receiver_with_validateAndConfirm.tolk` uses the Receiver library helper which is still in early development. For complex receivers, prefer `minimal_receiver.tolk` and implement the steps inline.

### TON Sender Contract

`contracts/minimal_sender.tolk` is a reusable on-chain relay for TON → EVM messaging. Deploy it once, then trigger CCIP sends by sending it a `CCIPSender_RelayCCIPSend` message. This pattern is useful when your application logic lives on-chain and needs to initiate cross-chain sends from within a smart contract rather than directly from a wallet.

## Tutorial

This tutorial will guide you through deploying receiver contracts and sending cross-chain messages in both directions.

### Deploy Receiver Contracts

Before sending messages, you need to deploy receiver contracts on both chains.

#### Deploy EVM Receiver (Sepolia)

```bash
npm run deploy:evm:receiver -- --evmChain sepolia
```

After deployment, copy the printed contract address — you'll pass it as `--evmReceiver` when sending messages.

#### Deploy TON Receiver

Choose one of the receiver contracts described in [TON Receiver Contracts](#ton-receiver-contracts):

```bash
# Full-featured Chainlink test receiver (ownership, upgradeability, configurable behavior)
npm run deploy:ton:receiver

# Minimal receiver (inline protocol steps — recommended starting point for custom receivers)
npm run deploy:ton:receiver:minimal

# Receiver using the validateAndConfirm library helper
npm run deploy:ton:receiver:validate-and-confirm
```

> **Rate limited?** Follow the instructions for [Get TON Center API Key](#get-ton-center-api-key)

After deployment, copy the printed contract address — you'll pass it as `--tonReceiver` when sending messages.

**Verify on TON Explorer**

```
https://testnet.tonviewer.com/<TON_RECEIVER_ADDRESS>
```

### Send Message from EVM to TON

```bash
npm run evm2ton:send -- --sourceChain sepolia --tonReceiver <TON_RECEIVER_ADDRESS> --msg "Hello TON from EVM" --feeToken native
```

#### Track on CCIP Explorer
   
Use the **source EVM transaction hash** to track delivery on CCIP Explorer:

```
https://ccip.chain.link/
```

> **NOTE**: It may take up to 15 minutes for the message to be finalized.

#### Check the message on TON

```bash
npm run utils:checkTON -- --sourceChain sepolia --tonReceiver <TON_RECEIVER_ADDRESS> --msg "<message>"
```

**Output includes:**
- Message ID (in 0x-prefixed hex format)
- CCIP Explorer link for tracking the cross-chain message
- Verification status and timestamp

### Send Message from TON to EVM

#### Option A: Direct from wallet

```bash
npm run ton2evm:send -- --destChain sepolia --evmReceiver <EVM_RECEIVER_ADDRESS> --msg "Hello EVM from TON" --feeToken native
```

#### Option B: Via on-chain sender contract

Deploy the sender contract once:

```bash
npm run deploy:ton:sender
```

Then send through it:

```bash
npm run ton2evm:send -- --destChain sepolia --evmReceiver <EVM_RECEIVER_ADDRESS> --tonSender <TON_SENDER_ADDRESS> --msg "Hello EVM from TON" --feeToken native
```

The sender contract receives a `CCIPSender_RelayCCIPSend` message, forwards the pre-built `Router_CCIPSend` cell to the Router, and handles the ACK/NACK response. This is the pattern to use when your application logic lives on-chain.

#### Track on CCIP Explorer
   
Use the **destination EVM transaction hash** to track delivery on CCIP Explorer:

```
https://ccip.chain.link/
```

> **NOTE**: It may take up to 15 minutes for the message to be finalized.

#### Check the message on EVM

```bash
npm run utils:checkEVM -- --destChain sepolia --evmReceiver <EVM_RECEIVER_ADDRESS> --msg "<message>"
```

**Output includes:**
- Message ID (in 0x-prefixed hex format)
- CCIP Explorer link for tracking the cross-chain message
- Event details including source chain verification

### Verify TON to EVM Router Response ⚠️ **IMPORTANT**

**Why this matters:** Unlike other chains, TON explorer shows transactions as successful even when CCIP messages fail due to insufficient fees. You must check the Router's response to know if your message actually succeeded.

When you send a message from TON → EVM, the Router responds with either:
- **ACK** (`0x78d0f21e`) - Message successfully processed
- **NACK** (`0x5a45d434`) - Message failed (e.g., insufficient fee)

**Common NACK reasons:**
- `error: 1002 (0x3ea)` - Insufficient CCIP fee. Increase fee amount in `sendMessage.ts`
- Other error codes indicate different router validation failures

For detailed information and error code meanings, see the documentation in [scripts/ton-utils/routerResponses.ts](./scripts/ton-utils/routerResponses.ts) header comments.

### Monitor CCIP Sends with checkLastTxs

View recent CCIP send transactions with filtering and status indicators:

```bash
# Show last 20 transactions for your wallet
npm run utils:checkLastTxs

# Show only CCIP_SEND transactions
npm run utils:checkLastTxs -- --ccipSendOnly true

# Check transactions for a specific address (e.g. a sender contract)
npm run utils:checkLastTxs -- --address <TON_ADDRESS> --ccipSendOnly true

# Filter by a specific queryID
npm run utils:checkLastTxs -- --address <TON_ADDRESS> --queryId <QUERY_ID>

# Show last 50 transactions
npm run utils:checkLastTxs -- --limit 50
```

**Features:**
- Scan any TON address via `--address` (defaults to your wallet)
- Filter by CCIP send transactions only
- Shows queryID, message ID, and Router response status
- Color-coded status (🟢 ACK for success, 🔴 NACK for failure)
- Displays CCIP Explorer URL for successful messages
- Options: `--address`, `--ccipSendOnly`, `--queryId`, `--limit`

