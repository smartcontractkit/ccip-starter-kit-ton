// Re-exports from the top-level helper-config for backward compatibility.
// Prefer importing from '../helper-config' directly.
export * from '../helper-config';

// Network Information
export const SEPOLIA = {
  RPC_URL: process.env.SEPOLIA_RPC_URL!,
  ROUTER: process.env.SEPOLIA_ROUTER!,
  CHAIN_SELECTOR: BigInt(process.env.SEPOLIA_CHAIN_SELECTOR!),
  ONRAMP: process.env.SEPOLIA_ONRAMP || '', // To be discovered
  LINK_TOKEN: process.env.SEPOLIA_LINK_TOKEN || '',
  EXPLORER: 'https://sepolia.etherscan.io',
};

// Arbitrum Sepolia
export const ARBITRUM_SEPOLIA = {
  RPC_URL: process.env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc',
  ROUTER: process.env.ARBITRUM_SEPOLIA_ROUTER || '', // To be discovered
  CHAIN_SELECTOR: BigInt('3478487238524512106'), 
  ONRAMP: '0x483139c08d6bdbaa15c6d78051bcf40971482f5f',
  LINK_TOKEN: process.env.ARBITRUM_SEPOLIA_LINK_TOKEN || '',
  EXPLORER: 'https://sepolia.arbiscan.io',
};

export const AVALANCHE_FUJI = {
  RPC_URL: process.env.AVALANCHE_FUJI_RPC_URL || 'https://',
  ROUTER: process.env.AVALANCHE_FUJI_ROUTER || '', // To be discovered
  CHAIN_SELECTOR: BigInt(0),
  ONRAMP: process.env.AVALANCHE_FUJI || '', // To be discovered
  LINK_TOKEN: process.env.AVALANCHE_FUJI_LINK_TOKEN || '',
  EXPLORER: 'https://testnet.snowtrace.io',
};

const TON_RPC_URL = (() => {
  let url = process.env.TON_RPC_URL || 'https://testnet.toncenter.com/api/v2/jsonRPC';
  const apiKey = process.env.TON_API_KEY;
  
  if (apiKey && !url.includes('api_key=')) {
    url += `${url.includes('?') ? '&' : '?'}api_key=${apiKey}`;
  }
  
  return url;
})();

export const TON_TESTNET = {
  RPC_URL: TON_RPC_URL,
  ROUTER: process.env.TON_ROUTER!,
  OFFRAMP: process.env.TON_OFFRAMP!,
  CHAIN_SELECTOR: BigInt(process.env.TON_CHAIN_SELECTOR!),
  EXPLORER: 'https://testnet.tonviewer.com',
};

// Wallet credentials
export const WALLET = {
  SEPOLIA_PRIVATE_KEY: process.env.SEPOLIA_PRIVATE_KEY!,
  TON_MNEMONIC: process.env.TON_MNEMONIC!,
};

// Deployed contracts (will be filled after deployment)
export const CONTRACTS = {
  TON_RECEIVER: process.env.TON_RECEIVER_ADDRESS || '',
  EVM_RECEIVER: process.env.EVM_RECEIVER_ADDRESS || '',
};

// CCIP gas limits
export const GAS_LIMITS = {
  // Max gas for message execution on TON (in nanoTON, 0.1 TON = 100_000_000)
  EVM_TO_TON: 100_000_000n,
  // Max gas for message execution on EVM (in gas units)
  TON_TO_EVM: 1_00_000,
};

export const SUPPORTED_EVM_CHAINS = ['sepolia'] as const;
export const SUPPORTED_EVM_CHAIN_CONFIGS = {
  sepolia: SEPOLIA,
} as const;

export const SUPPORTED_FEE_TOKENS = ['native'/* , 'link' */] as const;

const NATIVE_FEE_TOKEN_ADDRESS = ethers.ZeroAddress; // Placeholder for native token

export const SUPPORTED_EVM_FEE_TOKEN_ADDRESSES = {
  sepolia: {
    native: NATIVE_FEE_TOKEN_ADDRESS,
    // link: SEPOLIA.LINK_TOKEN,
  },
} as const;

const NATIVE_TON_FEE_TOKEN_ADDRESS = '0:0000000000000000000000000000000000000000000000000000000000000001';

export const SUPPORTED_TON_FEE_TOKENS = ['native'] as const;

export const SUPPORTED_TON_FEE_TOKEN_ADDRESSES = {
  native: NATIVE_TON_FEE_TOKEN_ADDRESS,
} as const;

