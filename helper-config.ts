import * as dotenv from 'dotenv';
dotenv.config();

export const ccipExplorerUrl = 'https://ccip.chain.link/#/side-drawer/msg';

// ============================================================
// Supported EVM Chains
// ============================================================

// Add new supported EVM source chains here.
// Each entry must have a corresponding config object in networkConfig below.
// See https://docs.chain.link/ccip/directory/testnet/chain/ton-testnet for supported TON testnet <-> EVM testnet lanes.
export const supportedEvmChains = [
  'sepolia',
  'arbitrumSepolia',
] as const;

// ============================================================
// Network Configuration
// ============================================================

const tonRpcUrl = (() => {
  let url = process.env.TON_RPC_URL || 'https://ton-testnet.api.onfinality.io/public';
  const apiKey = process.env.TON_CENTER_API_KEY;
  if (url.includes('toncenter.com')) {
    if (!apiKey) throw new Error('TON_CENTER_API_KEY is required when using a toncenter RPC URL. Add TON_CENTER_API_KEY=<your_api_key> to your .env file. Get an API key at https://docs.ton.org/ecosystem/api/toncenter/get-api-key');
    if (!url.includes('api_key=')) {
      url += `${url.includes('?') ? '&' : '?'}api_key=${apiKey}`;
    }
  }
  return url;
})();

export const networkConfig = {
  tonTestnet: {
    rpcUrl: tonRpcUrl,
    chainSelector: '1399300952838017768',
    router: 'EQB9QIw22sgwNKMfqsMKGepkhnjXYJmXlzCgcBSAlaiF9VCj',
    explorer: 'https://testnet.tonviewer.com',
    feeTokenNameNative: 'native',
    feeTokenNameLink: 'link',
    nativeTokenAddress: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAd99',
    destChains: Object.fromEntries(supportedEvmChains.map((c) => [c, c])) as Record<(typeof supportedEvmChains)[number], string>,
  },
  sepolia: {
    chainId: 11155111,
    networkIdentifier: 'ETHEREUM_SEPOLIA',
    chainSelector: '16015286601757825753',
    router: '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59',
    linkTokenAddress: '0x779877A7B0D9E8603169DdbD7836e478b4624789',
    explorer: 'https://sepolia.etherscan.io',
    nativeCurrencySymbol: 'ETH',
  },
  arbitrumSepolia: {
    chainId: 421614,
    networkIdentifier: 'ARBITRUM_SEPOLIA',
    chainSelector: '3478487238524512106',
    router: '0x2a9C5afB0d0e4BAb2BCdaE109EC4b0c4Be15a165',
    linkTokenAddress: '0xb1D4538B4571d411F07960EF2838Ce337FE1E80E',
    explorer: 'https://sepolia.arbiscan.io',
    nativeCurrencySymbol: 'ETH',
  },
};
