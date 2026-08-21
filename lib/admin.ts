export const ADMIN_EMAIL = 'folstromjohn@gmail.com'

export interface AdminAccessClaims {
  admin?: unknown
  email?: unknown
  email_verified?: unknown
}

/** Shared policy for trusted server claims and the matching client affordance. */
export function hasAdminAccessClaims(claims: AdminAccessClaims | null | undefined): boolean {
  if (!claims) return false
  if (claims.admin === true) return true
  return typeof claims.email === 'string' &&
    claims.email.toLowerCase() === ADMIN_EMAIL &&
    claims.email_verified === true
}
