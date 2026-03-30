import { HardhatUserConfig } from "hardhat/config";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import * as dotenv from "dotenv";
import { networkConfig, supportedEvmChains } from "./helper-config";

dotenv.config();

const networks = Object.fromEntries(
  supportedEvmChains
    .filter((chain) => {
      const cfg = networkConfig[chain];
      return !!process.env[`${cfg.networkIdentifier}_RPC_URL`];
    })
    .map((chain) => {
      const cfg = networkConfig[chain];
      const rpcUrl = process.env[`${cfg.networkIdentifier}_RPC_URL`]!;
      return [
        chain,
        {
          type: "http" as const,
          url: rpcUrl,
          chainId: cfg.chainId,
          accounts: process.env.EVM_PRIVATE_KEY ? [process.env.EVM_PRIVATE_KEY] : [],
        },
      ];
    })
);

const config: HardhatUserConfig = {
  plugins: [hardhatVerify],
  solidity: {
    npmFilesToBuild: [
      "@chainlink/contracts-ccip/contracts/onRamp/OnRamp.sol",
      "@chainlink/contracts-ccip/contracts/interfaces/IRouterClient.sol",
    ],
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  verify: {
    etherscan: {
      apiKey: process.env.ETHERSCAN_API_KEY || "UNSET",
      enabled: true,
    },
    blockscout: {
      enabled: false,
    },
    sourcify: {
      enabled: false,
    },
  },
  networks,
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;