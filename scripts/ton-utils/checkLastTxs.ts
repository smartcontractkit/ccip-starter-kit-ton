import { TonClient, WalletContractV4 } from '@ton/ton';
import { Address } from '@ton/core';
import { mnemonicToPrivateKey } from '@ton/crypto';
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { ccipExplorerUrl, networkConfig } from '../../helper-config';
import { getDifferentAddressFormats, getTonExplorerLinks } from './addressFormats';
import {
  findBestResponseForSendTx,
  getCCIPSendQueryIdFromTx,
  isCCIPSendTx,
  parseRouterResponseFromTx,
  type RouterResponseTx,
} from './routerResponses';

const ANSI_GREEN = '\x1b[32m';
const ANSI_RED = '\x1b[31m';
const ANSI_RESET = '\x1b[0m';

const argv = yargs(hideBin(process.argv))
  .option('address', {
    type: 'string',
    description: 'TON address to check (bounceable or non-bounceable). Defaults to your wallet derived from TON_MNEMONIC.',
    default: '',
  })
  .option('ccipSendOnly', {
    type: 'boolean',
    description: 'Show only transactions that send Router_CCIPSend to the configured router',
    default: false,
  })
  .option('queryId', {
    type: 'string',
    description: 'Filter to a specific CCIPSend by queryID (implies --ccipSendOnly)',
    default: '',
  })
  .option('limit', {
    type: 'number',
    description: 'Number of recent wallet transactions to scan',
    default: 20,
  })
  .parseSync()

async function checkTONTxs() {
  const client = new TonClient({ endpoint: networkConfig.tonTestnet.rpcUrl });

  let targetAddress: Address;
  let isCustomAddress = false;

  if (argv.address) {
    targetAddress = Address.parse(argv.address);
    isCustomAddress = true;
  } else {
    const mnemonic = process.env.TON_MNEMONIC;
    if (!mnemonic) throw new Error('TON_MNEMONIC is not set in .env (or pass --address <addr>)');
    const keyPair = await mnemonicToPrivateKey(mnemonic.split(' '));
    const wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey });
    targetAddress = wallet.address;
  }

  const routerAddress = Address.parse(networkConfig.tonTestnet.router);
  const addrFormats = getDifferentAddressFormats(targetAddress);
  const addrExplorerLinks = getTonExplorerLinks(networkConfig.tonTestnet.explorer, targetAddress);

  const label = isCustomAddress ? '📋 Recent transactions for address' : '📋 Recent TON wallet transactions';
  console.log(label);
  console.log('  Address:', addrFormats.bounceableNonTestable);
  console.log('  Explorer:', addrExplorerLinks.bounceableNonTestableUrl);
  console.log('');

  const transactions = await client.getTransactions(targetAddress, { limit: argv.limit });
  const routerResponses = transactions
    .map((tx) => parseRouterResponseFromTx(tx, routerAddress))
    .filter((r): r is RouterResponseTx => r !== null);

  const filterCcipOnly = argv.ccipSendOnly || !!argv.queryId;
  const filterQueryId = argv.queryId ? BigInt(argv.queryId) : null;

  const ccipSendTxs = transactions.filter((tx) => isCCIPSendTx(tx, routerAddress));
  let filteredTransactions = filterCcipOnly ? ccipSendTxs : transactions;

  if (filterQueryId !== null) {
    filteredTransactions = filteredTransactions.filter((tx) => {
      const qid = getCCIPSendQueryIdFromTx(tx, routerAddress);
      return qid !== null && qid === filterQueryId;
    });
  }

  if (filteredTransactions.length === 0) {
    if (filterQueryId !== null) {
      console.log(`No CCIPSend transaction found with queryID ${argv.queryId}.`);
    } else if (filterCcipOnly) {
      console.log('No recent Router_CCIPSend transactions found.');
    } else {
      console.log('No transactions found.');
    }
    return;
  }

  if (filterCcipOnly) {
    const label = filterQueryId !== null
      ? `queryID ${argv.queryId}`
      : 'Router_CCIPSend only';
    console.log(`Applied filter: ${label} (showing ${filteredTransactions.length} of ${transactions.length} scanned txs)`);
    console.log('');
  }

  for (let i = 0; i < filteredTransactions.length; i++) {
    const tx = filteredTransactions[i];
    const fullHash = tx.hash().toString('hex');
    const isCcipSend = isCCIPSendTx(tx, routerAddress);
    const queryID = isCcipSend ? getCCIPSendQueryIdFromTx(tx, routerAddress) : null;
    const matchedResponse = isCcipSend ? findBestResponseForSendTx(tx, queryID, routerResponses) : null;
    const hasAck = matchedResponse?.type === 'ACK';

    console.log(`Transaction ${i + 1}:`);
    console.log('  Hash:', fullHash);
    console.log('  Time:', new Date(tx.now * 1000).toISOString());
    console.log('  Explorer:', `${networkConfig.tonTestnet.explorer}/transaction/${fullHash}`);
    if (isCcipSend) {
      if (queryID !== null) {
        console.log('  queryID:', queryID.toString());
      }
      if (hasAck) {
        console.log(`${ANSI_GREEN}  CCIP_SEND found${ANSI_RESET}`);
        console.log(`${ANSI_GREEN}  Router Response: ACK${ANSI_RESET}`);
        if (matchedResponse.messageId !== undefined) {
          console.log('  CCIP Message ID:', matchedResponse.messageId);
          console.log('  CCIP Explorer:', `${ccipExplorerUrl}/${matchedResponse.messageId}`);
        }
      } else if (matchedResponse?.type === 'NACK') {
        console.log(`${ANSI_RED}  CCIP_SEND found${ANSI_RESET}`);
        console.log(`${ANSI_RED}  Router Response: NACK${ANSI_RESET}`);
      } else if (!matchedResponse) {
        console.log('  Router Response: pending/not found in current scan window');
      }
    }

    if (tx.description.type === 'generic' && tx.description.computePhase?.type === 'vm') {
      const computeSuccess = tx.description.computePhase.success;
      const exitCode = tx.description.computePhase.exitCode;
      const actionSuccess = tx.description.actionPhase?.success;

      console.log('  Compute Success:', computeSuccess);
      console.log('  Exit Code:', exitCode);
      console.log('  Action Success:', actionSuccess);
    }

    if (tx.inMessage && tx.inMessage.info.type === 'internal') {
      const inMsg = tx.inMessage;
      const bounced = 'bounced' in inMsg.info ? inMsg.info.bounced : false;
      console.log('  Inbound From:', inMsg.info.src?.toString() ?? '(unknown)');
      console.log('  Inbound Bounced:', bounced ? 'yes' : 'no');
    }

    console.log('  Out Messages:', tx.outMessagesCount);
    console.log('');
  }

  if (filterCcipOnly) {
    const ackCount = filteredTransactions.filter((tx) => {
      const qid = getCCIPSendQueryIdFromTx(tx, routerAddress);
      return findBestResponseForSendTx(tx, qid, routerResponses)?.type === 'ACK';
    }).length;
    const nackCount = filteredTransactions.filter((tx) => {
      const qid = getCCIPSendQueryIdFromTx(tx, routerAddress);
      return findBestResponseForSendTx(tx, qid, routerResponses)?.type === 'NACK';
    }).length;
    const pendingCount = filteredTransactions.length - ackCount - nackCount;
    console.log(`📊 Summary: ${filteredTransactions.length} CCIPSend(s) — ${ANSI_GREEN}${ackCount} ACK${ANSI_RESET}, ${ANSI_RED}${nackCount} NACK${ANSI_RESET}, ${pendingCount} pending`);
  }
}

checkTONTxs().catch((error) => {
  console.error('Error checking TON transactions:', error);
  process.exit(1);
});
