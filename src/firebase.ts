import { initializeApp } from 'firebase/app'
import { getAnalytics, isSupported } from 'firebase/analytics'
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  type User,
} from 'firebase/auth'
import {
  Timestamp,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import type { FormQuestion, ProgramInfo, ResponseTopic, ResultStats } from './types'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}

export const firebaseConfigured = Object.values(firebaseConfig).every(Boolean)
export const demoAuthEnabled = import.meta.env.VITE_ENABLE_DEMO_AUTH === 'true'

const firebaseApp = firebaseConfigured ? initializeApp(firebaseConfig) : null
export const auth = firebaseApp ? getAuth(firebaseApp) : null
export const db = firebaseApp ? getFirestore(firebaseApp) : null
const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })

if (firebaseApp && firebaseConfig.measurementId) {
  void isSupported().then((supported) => {
    if (supported) getAnalytics(firebaseApp)
  })
}

export async function signInWithGoogle() {
  if (!auth) throw new Error('Firebase가 설정되지 않았습니다.')
  const credential = await signInWithPopup(auth, googleProvider)
  return credential.user
}

export function observeAuthState(callback: (user: User | null) => void) {
  if (!auth) {
    callback(null)
    return () => undefined
  }
  return onAuthStateChanged(auth, callback)
}

function expirationFromSurveyEnd(surveyEndDate: string) {
  const expiration = new Date(`${surveyEndDate}T23:59:59+09:00`)
  expiration.setDate(expiration.getDate() + 14)
  return Timestamp.fromDate(expiration)
}

export async function publishFormRecord({
  formId,
  owner,
  program,
  questions,
  surveyEndDate,
}: {
  formId: string
  owner: User
  program: ProgramInfo
  questions: FormQuestion[]
  surveyEndDate: string
}) {
  if (!db) throw new Error('Firestore가 설정되지 않았습니다.')
  await setDoc(doc(db, 'forms', formId), {
    ownerUid: owner.uid,
    ownerEmail: owner.email,
    program,
    questions,
    published: true,
    surveyEndAt: Timestamp.fromDate(new Date(`${surveyEndDate}T23:59:59+09:00`)),
    expireAt: expirationFromSurveyEnd(surveyEndDate),
    updatedAt: serverTimestamp(),
  }, { merge: true })
}

export async function hasSubmittedResponse(formId: string, userUid: string) {
  if (!db) return false
  return (await getDoc(doc(db, 'forms', formId, 'responses', userUid))).exists()
}

export async function getPublishedForm(formId: string) {
  if (!db) throw new Error('Firestore가 설정되지 않았습니다.')
  const snapshot = await getDoc(doc(db, 'forms', formId))
  if (!snapshot.exists() || snapshot.data().published !== true) throw new Error('published-form-not-found')
  const data = snapshot.data()
  return {
    program: data.program as ProgramInfo,
    questions: data.questions as FormQuestion[],
    surveyEndDate: data.surveyEndAt instanceof Timestamp ? data.surveyEndAt.toDate().toISOString().slice(0, 10) : '',
  }
}

export async function submitResponseOnce({
  formId,
  user,
  answers,
  surveyEndDate,
}: {
  formId: string
  user: User
  answers: Record<number, string | boolean>
  surveyEndDate: string
}) {
  if (!db) throw new Error('Firestore가 설정되지 않았습니다.')
  const responseRef = doc(db, 'forms', formId, 'responses', user.uid)
  if ((await getDoc(responseRef)).exists()) throw new Error('already-submitted')
  await setDoc(responseRef, {
    formId,
    userUid: user.uid,
    answers,
    submittedAt: serverTimestamp(),
    expireAt: expirationFromSurveyEnd(surveyEndDate),
    immutable: true,
  })
}

export async function saveAnalysisRecord({
  formId,
  owner,
  stats,
  topics,
  surveyEndDate,
}: {
  formId: string
  owner: User
  stats: ResultStats
  topics: ResponseTopic[]
  surveyEndDate: string
}) {
  if (!db) throw new Error('Firestore가 설정되지 않았습니다.')
  await setDoc(doc(db, 'forms', formId, 'analysis', 'current'), {
    ownerUid: owner.uid,
    stats,
    topics,
    updatedAt: serverTimestamp(),
    expireAt: expirationFromSurveyEnd(surveyEndDate),
  })
}

export type { User as FirebaseUser }
