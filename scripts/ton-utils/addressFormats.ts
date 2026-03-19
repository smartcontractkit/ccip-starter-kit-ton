import { Address } from '@ton/core'

export type TonAddressFormats = {
  bounceableTestable: string
  bounceableNonTestable: string
  nonBounceableTestable: string
  nonBounceableNonTestable: string
  raw: string
}

export type TonExplorerLinks = {
  bounceableTestableUrl: string
  bounceableNonTestableUrl: string
}

function normalizeAddress(input: string | Address): Address {
  if (input instanceof Address) {
    return input
  }

  // Allow plain 64-hex account IDs by assuming workchain 0.
  if (/^[0-9a-fA-F]{64}$/.test(input)) {
    return Address.parseRaw(`0:${input}`)
  }

  return Address.parse(input)
}

export function getBounceableTestableAddress(input: string | Address): string {
  return normalizeAddress(input).toString({ bounceable: true, testOnly: true })
}

export function getBounceableNonTestableAddress(input: string | Address): string {
  return normalizeAddress(input).toString({ bounceable: true, testOnly: false })
}

export function getNonBounceableTestableAddress(input: string | Address): string {
  return normalizeAddress(input).toString({ bounceable: false, testOnly: true })
}

export function getNonBounceableNonTestableAddress(input: string | Address): string {
  return normalizeAddress(input).toString({ bounceable: false, testOnly: false })
}

export function getRawAddress(input: string | Address): string {
  return normalizeAddress(input).toRawString()
}

export function getDifferentAddressFormats(input: string | Address): TonAddressFormats {
  return {
    bounceableTestable: getBounceableTestableAddress(input),
    bounceableNonTestable: getBounceableNonTestableAddress(input),
    nonBounceableTestable: getNonBounceableTestableAddress(input),
    nonBounceableNonTestable: getNonBounceableNonTestableAddress(input),
    raw: getRawAddress(input),
  }
}

export function getTonExplorerLinks(explorerBaseUrl: string, input: string | Address): TonExplorerLinks {
  const formats = getDifferentAddressFormats(input)
  const baseUrl = explorerBaseUrl.replace(/\/$/, '')

  return {
    bounceableTestableUrl: `${baseUrl}/${formats.bounceableTestable}`,
    bounceableNonTestableUrl: `${baseUrl}/${formats.bounceableNonTestable}`,
  }
}

export function logDifferentAddressFormats(input: string | Address): void {
  const formats = getDifferentAddressFormats(input)

  console.log('\nTON Address Conversion')
  console.log('='.repeat(50))
  console.log('Bounceable (testable):         ', formats.bounceableTestable)
  console.log('Bounceable (non-testable):     ', formats.bounceableNonTestable)
  console.log('Non-bounceable (testable):     ', formats.nonBounceableTestable)
  console.log('Non-bounceable (non-testable): ', formats.nonBounceableNonTestable)
  console.log('Raw:                           ', formats.raw)
  console.log('='.repeat(50))
  console.log('\nUse bounceable (EQ) for smart contracts')
  console.log('Use non-bounceable (UQ/kQ) for wallets')
  console.log('Testnet typically uses testOnly=true, mainnet uses testOnly=false\n')
}