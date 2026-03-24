import { initializeApp, getApps } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'

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
