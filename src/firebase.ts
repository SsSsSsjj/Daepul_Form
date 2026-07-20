import { initializeApp } from 'firebase/app'
import { getAnalytics, isSupported } from 'firebase/analytics'
import { GoogleAuthProvider, getAuth, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth'
import { GoogleAIBackend, Schema, getAI, getGenerativeModel } from 'firebase/ai'
import { Timestamp, collection, doc, getDoc, getDocs, getFirestore, query, serverTimestamp, setDoc, where } from 'firebase/firestore'
import type { FormQuestion, FormType, GeneratedForm, ProgramInfo, ResponseTopic, ResultStats, StoredFormResponse } from './types'

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

if (firebaseApp && firebaseConfig.measurementId) void isSupported().then((ok) => { if (ok) getAnalytics(firebaseApp) })

export async function signInWithGoogle() {
  if (!auth) throw new Error('Firebase가 설정되지 않았습니다.')
  return (await signInWithPopup(auth, googleProvider)).user
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
  const parts = await Promise.all(files.map(async (file) => ({ inlineData: { data: await fileToBase64(file), mimeType: file.type || 'application/pdf' } })))
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
