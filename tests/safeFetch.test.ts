import { describe, expect, it } from 'vitest'
import { isBlockedIpAddress, parsePublicHttpUrl, SafeFetchError } from '@/lib/safeFetch'

describe('safe outbound fetch validation', () => {
  it('accepts only credential-free http and https URLs', () => {
    expect(parsePublicHttpUrl('https://example.com/recipe').protocol).toBe('https:')
    expect(parsePublicHttpUrl('http://example.com/recipe').protocol).toBe('http:')

    for (const url of [
      'file:///etc/passwd',
      'ftp://example.com/recipe',
      'https://user:secret@example.com/recipe',
      'not a URL',
    ]) {
      expect(() => parsePublicHttpUrl(url)).toThrow(SafeFetchError)
    }
  })

  it('rejects private, local, reserved, and address-obfuscation ranges', () => {
    for (const address of [
      '0.0.0.0',
      '10.20.30.40',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.31.255.255',
      '192.168.1.1',
      '198.18.0.1',
      '192.0.2.10',
      '224.0.0.1',
      '::',
      '::1',
      '::ffff:127.0.0.1',
      'fc00::1',
      'fe80::1',
      '2001:db8::1',
      '2002:7f00:1::',
      'ff02::1',
    ]) {
      expect(isBlockedIpAddress(address), address).toBe(true)
    }
  })

  it('allows representative public IPv4 and IPv6 addresses', () => {
    expect(isBlockedIpAddress('93.184.216.34')).toBe(false)
    expect(isBlockedIpAddress('2606:2800:220:1:248:1893:25c8:1946')).toBe(false)
  })

  it('rejects blocked IP literals before DNS or network access', () => {
    expect(() => parsePublicHttpUrl('http://127.0.0.1/admin')).toThrow(/non-public/)
    expect(() => parsePublicHttpUrl('http://[::1]/admin')).toThrow(/non-public/)
  })
})
