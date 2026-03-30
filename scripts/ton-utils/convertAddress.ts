import { pathToFileURL } from 'node:url'
import { logDifferentAddressFormats } from './addressFormats'

function runCli(): void {
  const address = process.argv[2]

  if (!address) {
    console.error('Usage: npm run utils:convertAddress <address>')
    process.exit(1)
  }

  try {
    logDifferentAddressFormats(address)
  } catch (error) {
    console.error('Invalid TON address:', error)
    process.exit(1)
  }
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMainModule) {
  runCli()
}
