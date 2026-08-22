import { describe, expect, it } from 'vitest'
import { ADMIN_EMAIL, hasAdminAccessClaims } from '@/lib/admin'

describe('admin access claims', () => {
  it('accepts the explicit admin custom claim', () => {
    expect(hasAdminAccessClaims({ admin: true })).toBe(true)
  })

  it('accepts only the verified configured admin email', () => {
    expect(hasAdminAccessClaims({ email: ADMIN_EMAIL, email_verified: true })).toBe(true)
    expect(hasAdminAccessClaims({ email: ADMIN_EMAIL.toUpperCase(), email_verified: true })).toBe(true)
    expect(hasAdminAccessClaims({ email: ADMIN_EMAIL, email_verified: false })).toBe(false)
    expect(hasAdminAccessClaims({ email: ADMIN_EMAIL })).toBe(false)
    expect(hasAdminAccessClaims({ email: 'other@example.com', email_verified: true })).toBe(false)
  })

  it('does not accept truthy lookalikes or absent claims', () => {
    expect(hasAdminAccessClaims({ admin: 'true' })).toBe(false)
    expect(hasAdminAccessClaims(null)).toBe(false)
  })
})
