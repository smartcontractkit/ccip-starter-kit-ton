import * as dotenv from 'dotenv';
dotenv.config();

export const ccipExplorerUrl = 'https://ccip.chain.link/#/side-drawer/msg';

// ============================================================
// Supported EVM Chains
// ============================================================

// Add new supported EVM source chains here.
// Each entry must have a corresponding config object in networkConfig below.
export const supportedEvmChains = [
  'sepolia',
  // 'arbitrumSepolia',
  // 'avalancheFuji',
] as const;

// ============================================================
// Network Configuration
// ============================================================

const tonRpcUrl = (() => {
  let url = process.env.TON_RPC_URL || 'https://testnet.toncenter.com/api/v2/jsonRPC';
  const apiKey = process.env.TON_API_KEY;
  if (apiKey && !url.includes('api_key=')) {
    url += `${url.includes('?') ? '&' : '?'}api_key=${apiKey}`;
  }
  return url;
})();

export const networkConfig = {
  tonTestnet: {
    rpcUrl: tonRpcUrl,
    router: process.env.TON_ROUTER!,
    chainSelector: process.env.TON_CHAIN_SELECTOR!,
    explorer: 'https://testnet.tonviewer.com',
    feeTokenNameNative: 'native',
    feeTokenNameLink: 'link',
    destChains: Object.fromEntries(supportedEvmChains.map((c) => [c, c])) as Record<(typeof supportedEvmChains)[number], string>,
  },
  sepolia: {
    chainId: 11155111,
    networkIdentifier: 'ETHEREUM_SEPOLIA',
    chainSelector: process.env.ETHEREUM_SEPOLIA_CHAIN_SELECTOR!,
    router: process.env.ETHEREUM_SEPOLIA_ROUTER!,
    linkTokenAddress: process.env.ETHEREUM_SEPOLIA_LINK_TOKEN!,
    explorer: 'https://sepolia.etherscan.io',
    nativeCurrencySymbol: 'ETH',
  },
  arbitrumSepolia: {
    chainId: 421614,
    networkIdentifier: 'ARBITRUM_SEPOLIA',
    chainSelector: process.env.ARBITRUM_SEPOLIA_CHAIN_SELECTOR!,
    router: process.env.ARBITRUM_SEPOLIA_ROUTER!,
    linkTokenAddress: process.env.ARBITRUM_SEPOLIA_LINK_TOKEN!,
    explorer: 'https://sepolia.arbiscan.io',
    nativeCurrencySymbol: 'ETH',
  },
  avalancheFuji: {
    chainId: 43113,
    networkIdentifier: 'AVALANCHE_FUJI',
    chainSelector: process.env.AVALANCHE_FUJI_CHAIN_SELECTOR!,
    router: process.env.AVALANCHE_FUJI_ROUTER!,
    linkTokenAddress: process.env.AVALANCHE_FUJI_LINK_TOKEN!,
    explorer: 'https://testnet.snowtrace.io',
    nativeCurrencySymbol: 'AVAX',
  },
};
