import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, Firestore } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'
import { hasAdminAccessClaims } from './admin'

function getAdminApp() {
  if (getApps().length > 0) return getApps()[0]
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

/** Server-side Firestore client for API routes (admin SDK, bypasses rules). */
export function getAdminDb(): Firestore {
  return getFirestore(getAdminApp())
}

async function verifyDecodedToken(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization')
    const match = authHeader?.match(/^Bearer\s+(.+)$/i)
    const token = match?.[1]?.trim()
    if (!token) return null
    getAdminApp()
    return await getAuth().verifyIdToken(token)
  } catch {
    return null
  }
}

export async function verifyAuthToken(req: NextRequest): Promise<string | null> {
  return (await verifyDecodedToken(req))?.uid || null
}

/** Verify identity and require either the admin custom claim or verified admin email. */
export async function verifyAdminToken(req: NextRequest): Promise<string | null> {
  const decoded = await verifyDecodedToken(req)
  return decoded && hasAdminAccessClaims(decoded) ? decoded.uid : null
}
