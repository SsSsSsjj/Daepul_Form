import { initializeApp } from 'firebase/app'
import { getAnalytics, isSupported } from 'firebase/analytics'
import { ReCaptchaEnterpriseProvider, initializeAppCheck } from 'firebase/app-check'
import {
  browserLocalPersistence, GoogleAuthProvider, getAuth, onAuthStateChanged, setPersistence,
  signInWithCustomToken, signInWithEmailAndPassword, signInWithPopup, signInWithRedirect, signOut, type User,
} from 'firebase/auth'
import { GoogleAIBackend, Schema, getAI, getGenerativeModel } from 'firebase/ai'
import { Timestamp, collection, doc, getDoc, getDocs, getFirestore, query, serverTimestamp, setDoc, where, writeBatch } from 'firebase/firestore'
import type { FormQuestion, FormType, GeneratedForm, ProgramInfo, ResponseTopic, ResultStats, StoredFormResponse } from './types'
import { extractHwpText, isHwpFile } from './hwp'

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

// App Check debug mode is enabled only by Vite's local development build.
// Firebase creates the debug token in the browser; never put that token in source control.
if (firebaseApp && import.meta.env.DEV) {
  ;(self as typeof self & { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true
  initializeAppCheck(firebaseApp, {
    // The provider is bypassed while the SDK is in debug mode.
    provider: new ReCaptchaEnterpriseProvider('local-debug-provider'),
    isTokenAutoRefreshEnabled: true,
  })
} else if (firebaseApp && import.meta.env.VITE_FIREBASE_APPCHECK_RECAPTCHA_ENTERPRISE_SITE_KEY) {
  initializeAppCheck(firebaseApp, {
    provider: new ReCaptchaEnterpriseProvider(import.meta.env.VITE_FIREBASE_APPCHECK_RECAPTCHA_ENTERPRISE_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  })
}

export const auth = firebaseApp ? getAuth(firebaseApp) : null
export const db = firebaseApp ? getFirestore(firebaseApp) : null
const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })

export type LoginProvider = 'google' | 'kakao' | 'naver' | 'email'
type SocialLoginProvider = Exclude<LoginProvider, 'google' | 'email'>

const loginProviderLabels: Record<LoginProvider | 'existing', string> = {
  google: 'Google', kakao: '카카오', naver: '네이버', email: '이메일', existing: '기존 로그인 방식',
}

if (firebaseApp && firebaseConfig.measurementId) void isSupported().then((ok) => { if (ok) getAnalytics(firebaseApp) })

export async function signInWithGoogle() {
  if (!auth) throw new Error('Firebase가 설정되지 않았습니다.')
  // Keep the creator signed in across refreshes and redirect-based login fallbacks.
  await setPersistence(auth, browserLocalPersistence).catch(() => undefined)
  try {
    return (await signInWithPopup(auth, googleProvider)).user
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported'].includes(code)) {
      await signInWithRedirect(auth, googleProvider)
      return null
    }
    throw error
  }
}

export async function signInWithEmail(email: string, password: string) {
  if (!auth) throw new Error('Firebase가 설정되지 않았습니다.')
  await setPersistence(auth, browserLocalPersistence).catch(() => undefined)
  return (await signInWithEmailAndPassword(auth, email.trim(), password)).user
}

function socialAuthParams() {
  return new URLSearchParams(location.search)
}

export function hasSocialLoginCallback() {
  const params = socialAuthParams()
  return params.has('auth_code') || params.has('auth_error')
}

function clearSocialLoginParams() {
  const url = new URL(location.href)
  for (const key of ['auth_code', 'auth_error', 'auth_provider', 'existing_provider']) url.searchParams.delete(key)
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

function socialLoginErrorMessage(code: string, provider: string, existingProvider: string) {
  const providerLabel = loginProviderLabels[provider as LoginProvider] ?? '소셜'
  const existingLabel = loginProviderLabels[existingProvider as LoginProvider | 'existing'] ?? '기존 로그인 방식'
  const messages: Record<string, string> = {
    account_exists: `같은 이메일로 가입된 계정이 있습니다. ${existingLabel}로 로그인해 주세요.`,
    email_required: `${providerLabel}에서 이메일 제공에 동의해야 로그인할 수 있습니다.`,
    invalid_exchange_code: '로그인 확인 코드가 만료되었습니다. 다시 로그인해 주세요.',
    invalid_state: '로그인 요청이 만료되었거나 브라우저 세션이 일치하지 않습니다. 다시 시도해 주세요.',
    oauth_cancelled: `${providerLabel} 로그인이 취소되었습니다.`,
    provider_unavailable: `${providerLabel} 로그인 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.`,
  }
  return messages[code] ?? '소셜 로그인을 완료하지 못했습니다. 다시 시도해 주세요.'
}

export async function completeSocialLoginCallback() {
  const params = socialAuthParams()
  const code = params.get('auth_code') ?? ''
  const error = params.get('auth_error') ?? ''
  const provider = params.get('auth_provider') ?? ''
  const existingProvider = params.get('existing_provider') ?? ''
  if (!code && !error) return ''
  clearSocialLoginParams()

  try {
    if (error) return socialLoginErrorMessage(error, provider, existingProvider)
    if (!auth) return 'Firebase가 설정되지 않았습니다.'
    const response = await fetch('/api/auth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    const body = await response.json() as { customToken?: string; error?: string }
    if (!response.ok || !body.customToken) {
      return socialLoginErrorMessage(body.error ?? 'invalid_exchange_code', provider, existingProvider)
    }
    await setPersistence(auth, browserLocalPersistence).catch(() => undefined)
    await signInWithCustomToken(auth, body.customToken)
    return ''
  } catch {
    return '소셜 로그인을 완료하지 못했습니다. 네트워크 연결을 확인하고 다시 시도해 주세요.'
  }
}

export function startSocialLogin(provider: SocialLoginProvider) {
  const current = new URL(location.href)
  for (const key of ['auth_code', 'auth_error', 'auth_provider', 'existing_provider']) current.searchParams.delete(key)
  const returnTo = `${current.pathname}${current.search}${current.hash}`
  location.assign(`/api/auth/${provider}/start?returnTo=${encodeURIComponent(returnTo)}`)
}

export function loginFailureMessage(error: unknown, provider: LoginProvider) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
  if (provider === 'email') {
    if (code === 'auth/invalid-email') return '올바른 이메일 주소를 입력해 주세요.'
    if (code === 'auth/user-disabled') return '사용이 중지된 계정입니다. 관리자에게 문의해 주세요.'
    if (code === 'auth/too-many-requests') return '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.'
    return '이메일 또는 비밀번호가 올바르지 않습니다.'
  }
  if (code === 'auth/account-exists-with-different-credential') {
    return '같은 이메일로 가입된 계정이 있습니다. 기존 카카오·네이버 또는 이메일 로그인을 이용해 주세요.'
  }
  return 'Google 로그인에 실패했습니다. 팝업 허용 및 Firebase 인증 설정을 확인해 주세요.'
}

export async function logout() {
  if (auth) await signOut(auth)
}

export function observeAuthState(callback: (user: User | null) => void) {
  if (!auth) { callback(null); return () => undefined }
  return onAuthStateChanged(auth, callback)
}

function expirationFromSurveyEnd(surveyEndDate: string) {
  const expiration = new Date(`${surveyEndDate}T23:59:59+09:00`)
  expiration.setDate(expiration.getDate() + 14)
  return Timestamp.fromDate(expiration)
}

export async function publishFormRecord({ formId, owner, program, questions, surveyEndDate, formType = 'general', theme = 'green' }: {
  formId: string; owner: User; program: ProgramInfo; questions: FormQuestion[]; surveyEndDate: string; formType?: FormType; theme?: string
}) {
  if (!db) throw new Error('Firestore가 설정되지 않았습니다.')
  await setDoc(doc(db, 'forms', formId), {
    ownerUid: owner.uid, ownerEmail: owner.email, program, questions, formType, theme, published: true,
    surveyEndAt: Timestamp.fromDate(new Date(`${surveyEndDate}T23:59:59+09:00`)),
    expireAt: expirationFromSurveyEnd(surveyEndDate), updatedAt: serverTimestamp(),
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
    formType: (data.formType ?? 'general') as FormType, theme: String(data.theme ?? 'green'),
    surveyEndDate: data.surveyEndAt instanceof Timestamp ? data.surveyEndAt.toDate().toISOString().slice(0, 10) : '',
  }
}

export async function getOwnedForms(userUid: string) {
  if (!db) throw new Error('Firestore가 설정되지 않았습니다.')
  const snapshot = await getDocs(query(collection(db, 'forms'), where('ownerUid', '==', userUid)))
  return Promise.all(snapshot.docs.map(async (item) => {
    const responses = await getDocs(collection(db, 'forms', item.id, 'responses'))
    const data = item.data()
    return { id: item.id, title: String(data.program?.programName ?? '제목 없는 폼'), published: data.published === true, responseCount: responses.size }
  }))
}

export async function deleteFormRecord(formId: string) {
  if (!db) throw new Error('Firestore가 설정되지 않았습니다.')
  const [responses, analyses] = await Promise.all([
    getDocs(collection(db, 'forms', formId, 'responses')),
    getDocs(collection(db, 'forms', formId, 'analysis')),
  ])
  const batch = writeBatch(db)
  responses.docs.forEach((item) => batch.delete(item.ref))
  analyses.docs.forEach((item) => batch.delete(item.ref))
  batch.delete(doc(db, 'forms', formId))
  await batch.commit()
}

export async function getFormResponses(formId: string): Promise<StoredFormResponse[]> {
  if (!db) throw new Error('Firestore가 설정되지 않았습니다.')
  const snapshot = await getDocs(collection(db, 'forms', formId, 'responses'))
  return snapshot.docs.map((item) => ({ id: item.id, answers: item.data().answers ?? {} }))
}

export async function submitResponseOnce({ formId, user, answers, surveyEndDate }: {
  formId: string; user: User; answers: Record<number, string | boolean | number>; surveyEndDate: string
}) {
  if (!db) throw new Error('Firestore가 설정되지 않았습니다.')
  const responseRef = doc(db, 'forms', formId, 'responses', user.uid)
  if ((await getDoc(responseRef)).exists()) throw new Error('already-submitted')
  await setDoc(responseRef, { formId, userUid: user.uid, answers, submittedAt: serverTimestamp(), expireAt: expirationFromSurveyEnd(surveyEndDate), immutable: true })
}

const formSchema = Schema.object({ properties: {
  formType: Schema.enumString({ enum: ['application', 'satisfaction', 'demand_survey', 'general'] }),
  program: Schema.object({ properties: {
    programName: Schema.string(), description: Schema.string(), target: Schema.string(), period: Schema.string(),
    schedule: Schema.string(), capacity: Schema.string(), requirements: Schema.string(), privacyConsent: Schema.string(),
  }}),
  questions: Schema.array({ items: Schema.object({ properties: {
    label: Schema.string(), type: Schema.enumString({ enum: ['short_text', 'long_text', 'select', 'checkbox', 'consent', 'rating', 'number'] }),
    required: Schema.boolean(), options: Schema.array({ items: Schema.string() }),
  }, optionalProperties: ['options'] }) }),
  reviewNotes: Schema.array({ items: Schema.string() }),
} })

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export async function generateFormFromDocuments(files: File[], memo: string): Promise<GeneratedForm> {
  if (!firebaseApp) throw new Error('Firebase가 설정되지 않았습니다.')
  const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() })
  const model = getGenerativeModel(ai, { model: 'gemini-3.5-flash', generationConfig: { responseMimeType: 'application/json', responseSchema: formSchema } })
  const parts = await Promise.all(files.map(async (file) => {
    if (!isHwpFile(file)) return { inlineData: { data: await fileToBase64(file), mimeType: file.type || 'application/pdf' } }
    try {
      const text = await extractHwpText(file)
      return { text: `[한글 문서: ${file.name}]\n${text}` }
    } catch (error) {
      console.error('HWP extraction failed', error)
      throw new Error(`HWP 파일 "${file.name}"을 읽지 못했습니다. 손상되었거나 암호가 설정된 파일인지 확인해 주세요.`)
    }
  }))
  const prompt = `첨부 자료를 읽고 실제 내용에 맞는 한국어 폼을 설계하세요. 만족도 조사라면 1~5점 rating과 자유의견을 포함하고, 신청서라면 신청 자격·일정·선발에 필요한 질문을 만드세요. 문서에 없는 사실은 만들지 말고 빈 문자열 또는 reviewNotes로 남기세요. 개인정보 질문은 꼭 필요한 최소한만 만드세요. 메모: ${memo || '없음'}`
  const result = await model.generateContent([...parts, { text: prompt }])
  const parsed = JSON.parse(result.response.text()) as Omit<GeneratedForm, 'questions'> & { questions: Array<Omit<FormQuestion, 'id'>> }
  return { ...parsed, questions: parsed.questions.map((question, index) => ({ ...question, id: Date.now() + index })) }
}

export async function summarizeResponses(responses: string[]): Promise<ResponseTopic[]> {
  if (!firebaseApp || !responses.length) return []
  const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() })
  const schema = Schema.array({ items: Schema.object({ properties: {
    title: Schema.string(), category: Schema.enumString({ enum: ['긍정 의견', '개선 의견', '후속 요청', '기타 의견'] }),
    summary: Schema.string(), sourceIds: Schema.array({ items: Schema.integer() }), reportSentence: Schema.string(),
  } }) })
  const model = getGenerativeModel(ai, { model: 'gemini-3.5-flash', generationConfig: { responseMimeType: 'application/json', responseSchema: schema } })
  const numbered = responses.map((text, index) => `${index}: ${text}`).join('\n')
  const result = await model.generateContent(`다음 익명 자유응답을 주제별로 요약하세요. sourceIds에는 근거가 된 0부터 시작하는 응답 번호만 넣고, 근거 없는 판단은 하지 마세요.\n${numbered}`)
  const parsed = JSON.parse(result.response.text()) as Array<Omit<ResponseTopic, 'id'>>
  return parsed.map((topic, index) => ({ ...topic, id: `ai-${index}` }))
}

export async function saveAnalysisRecord({ formId, owner, stats, topics, surveyEndDate }: {
  formId: string; owner: User; stats: ResultStats; topics: ResponseTopic[]; surveyEndDate: string
}) {
  if (!db) throw new Error('Firestore가 설정되지 않았습니다.')
  await setDoc(doc(db, 'forms', formId, 'analysis', 'current'), { ownerUid: owner.uid, stats, topics, updatedAt: serverTimestamp(), expireAt: expirationFromSurveyEnd(surveyEndDate) })
}

export type { User as FirebaseUser }
