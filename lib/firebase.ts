import { initializeApp, getApps } from 'firebase/app'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getAuth, GoogleAuthProvider, connectAuthEmulator } from 'firebase/auth'

const firebaseConfig = {
  apiKey: "AIzaSyA3rUqgLZ2Qcr8oDEJ8D66sgvOpriKLgWg",
  authDomain: "malignant-metro.firebaseapp.com",
  projectId: "malignant-metro",
  storageBucket: "malignant-metro.firebasestorage.app",
  messagingSenderId: "969397424975",
  appId: "1:969397424975:web:42b2e5d695af3a5f482b3a"
}

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]
export const db = getFirestore(app)
export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()

// --- EMULATOR LOGIC ---
// To use local emulators, set NEXT_PUBLIC_USE_FIRESTORE_EMULATOR=true in your environment.
// Note: Emulators start empty. You must manually seed data or export production data using:
// firebase emulators:export ./emulator-data (and --import ./emulator-data on start).
const IS_EMULATOR = process.env.NEXT_PUBLIC_USE_FIRESTORE_EMULATOR === 'true'

if (IS_EMULATOR) {
  // Use a global flag to prevent double-connecting during Next.js hot module replacement
  if (!(globalThis as any)._EMULATORS_STARTED) {
    connectFirestoreEmulator(db, '127.0.0.1', 8080)
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
    ;(globalThis as any)._EMULATORS_STARTED = true
    
    // Log clearly on both server and client console
    if (typeof window === 'undefined') {
      console.log('🔥 CONNECTED TO FIREBASE EMULATORS (Server)')
    } else {
      console.log('🔥 CONNECTED TO FIREBASE EMULATORS (Client)')
    }
  }
} else if (process.env.NODE_ENV === 'development') {
  if (!(globalThis as any)._PROD_WARNING_LOGGED) {
    if (typeof window === 'undefined') {
      console.log('⚠️ CONNECTED TO PRODUCTION FIREBASE IN LOCAL DEV (Server)')
    } else {
      console.log('⚠️ CONNECTED TO PRODUCTION FIREBASE IN LOCAL DEV (Client)')
    }
    ;(globalThis as any)._PROD_WARNING_LOGGED = true
  }
}
