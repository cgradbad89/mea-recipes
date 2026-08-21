#!/usr/bin/env node
/**
 * scripts/_lib.js — shared helpers for the Batch-4 canonical-staples dev tooling.
 *
 * READ-ONLY by intent. These helpers authenticate to the malignant-metro project
 * using the cert creds already in .env.local (no serviceAccountKey.json needed)
 * and mint a real Firebase ID token for hitting auth-gated API routes locally.
 *
 * Nothing here writes to Firestore.
 */

const fs = require('fs')
const path = require('path')

// Web API key (public; already hardcoded in lib/firebase.ts) — used only to
// exchange an admin-minted custom token for an ID token via Identity Toolkit.
const WEB_API_KEY = 'AIzaSyA3rUqgLZ2Qcr8oDEJ8D66sgvOpriKLgWg'

/** Parse .env.local into process.env (does not overwrite already-set vars). */
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(envPath)) throw new Error(`.env.local not found at ${envPath}`)
  const raw = fs.readFileSync(envPath, 'utf8')
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const key = t.slice(0, eq).trim()
    let val = t.slice(eq + 1).trim()
    // strip a single layer of surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    // PEM keys are stored with literal \n — restore real newlines
    val = val.replace(/\\n/g, '\n')
    if (process.env[key] === undefined) process.env[key] = val
  }
}

let _admin = null
/**
 * Initialise + return the firebase-admin singleton (cert from env).
 *
 * firebase-admin v14 removed the legacy namespaced API (`require('firebase-admin')`
 * + `admin.apps` / `admin.credential.cert`) from the CJS root export. This uses the
 * modular subpath entry points instead, but keeps the same call shape callers already
 * use: `getAdmin().firestore()` / `getAdmin().auth()`.
 */
function getAdmin() {
  if (_admin) return _admin
  const { initializeApp, getApps, cert } = require('firebase-admin/app')
  const { getFirestore } = require('firebase-admin/firestore')
  const { getAuth } = require('firebase-admin/auth')

  const app = getApps().length === 0
    ? initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY,
        }),
      })
    : getApps()[0]

  _admin = {
    firestore: () => getFirestore(app),
    auth: () => getAuth(app),
  }
  return _admin
}

/** Mint a real Firebase ID token (admin custom token → Identity Toolkit exchange). */
async function mintIdToken(uid = 'batch4-dryrun-bot') {
  const admin = getAdmin()
  const customToken = await admin.auth().createCustomToken(uid)
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  )
  const data = await res.json()
  if (!res.ok || !data.idToken) {
    throw new Error(`token exchange failed: ${res.status} ${JSON.stringify(data).slice(0, 200)}`)
  }
  return data.idToken
}

module.exports = { loadEnv, getAdmin, mintIdToken, WEB_API_KEY }
