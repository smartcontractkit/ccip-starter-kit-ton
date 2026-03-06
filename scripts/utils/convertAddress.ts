import { Address } from "@ton/core";

const address = process.argv[2];

if (!address) {
  console.error("Usage: npm run utils:convertAddress <address>");
  process.exit(1);
}

try {
  const addr = Address.parse(address);
  
  console.log("\n📍 TON Address Conversion");
  console.log("=" .repeat(50));
  console.log("Bounceable (testable):         ", addr.toString({ bounceable: true, testOnly: true }));
  console.log("Bounceable (non-testable):     ", addr.toString({ bounceable: true, testOnly: false }));
  console.log("Non-bounceable (testable):     ", addr.toString({ bounceable: false, testOnly: true }));
  console.log("Non-bounceable (non-testable): ", addr.toString({ bounceable: false, testOnly: false }));
  console.log("Raw:                           ", addr.toRawString());
  console.log("=" .repeat(50));
  console.log("\nℹ️  Use bounceable (EQ) for smart contracts");
  console.log("ℹ️  Use non-bounceable (UQ/kQ) for wallets");
  console.log("ℹ️  Testnet typically uses testOnly=true, mainnet uses testOnly=false\n");
} catch (error) {
  console.error("❌ Invalid TON address:", error);
  process.exit(1);
}
