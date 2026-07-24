import { initializeApp } from 'firebase/app'
import { getAnalytics, isSupported } from 'firebase/analytics'
import { ReCaptchaEnterpriseProvider, initializeAppCheck } from 'firebase/app-check'
import {
  browserLocalPersistence, GoogleAuthProvider, getAuth, isSignInWithEmailLink, onAuthStateChanged,
  sendSignInLinkToEmail, setPersistence, signInAnonymously, signInWithEmailLink, signInWithPopup, signInWithRedirect, signOut, type User,
} from 'firebase/auth'
import { GoogleAIBackend, Schema, getAI, getGenerativeModel } from 'firebase/ai'
import { Timestamp, collection, deleteDoc, doc, getDoc, getDocs, initializeFirestore, limit, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { getDownloadURL, getStorage, ref, uploadBytesResumable } from 'firebase/storage'
import {
  defaultFormSettings,
  type FormQuestion, type FormSettings, type FormType, type GeneratedForm, type ProgramInfo,
  type ResponseAttachment, type ResponseDraft, type ResponsePage, type ResponseQuery, type ResponseTopic,
  type ResultStats, type StoredFormResponse,
} from './types'
import { extractHwpText, isHwpFile } from './hwp'
import { createFormService } from './formService'
import { queryResponses } from './features/responses/model'

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
export const db = firebaseApp ? initializeFirestore(firebaseApp, { ignoreUndefinedProperties: true }) : null
export const formService = createFormService(firebaseApp)
const functions = firebaseApp ? getFunctions(firebaseApp, 'asia-northeast3') : null
const storage = firebaseApp ? getStorage(firebaseApp) : null
if (auth) auth.languageCode = 'ko'
const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })

export type LoginProvider = 'google' | 'email'

const pendingEmailStorageKey = 'daepul-form-email-link'
type SubmissionAnswerValue = string | boolean | number | string[]
const emailActionParams = ['apiKey', 'continueUrl', 'lang', 'mode', 'oobCode', 'tenantId']

type PendingEmailSignIn = {
  email: string
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

export async function signInAsGuest() {
  if (!auth) throw new Error('Firebase가 설정되지 않았습니다.')
  await setPersistence(auth, browserLocalPersistence).catch(() => undefined)
  return (await signInAnonymously(auth)).user
}

function currentReturnTo() {
  const url = new URL(location.href)
  emailActionParams.forEach((key) => url.searchParams.delete(key))
  return `${url.pathname}${url.search}${url.hash}`
}

function savePendingEmailSignIn(value: PendingEmailSignIn) {
  try {
    localStorage.setItem(pendingEmailStorageKey, JSON.stringify(value))
  } catch {
    // Cross-device completion can still ask for the address when storage is unavailable.
  }
}

export function getPendingEmailAddress() {
  try {
    const value = JSON.parse(localStorage.getItem(pendingEmailStorageKey) ?? 'null') as PendingEmailSignIn | null
    return typeof value?.email === 'string' ? value.email : ''
  } catch {
    return ''
  }
}

function clearEmailActionParams() {
  const url = new URL(location.href)
  emailActionParams.forEach((key) => url.searchParams.delete(key))
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

export function discardEmailSignInLink() {
  try {
    localStorage.removeItem(pendingEmailStorageKey)
  } catch {
    // The URL can still be cleaned up when storage is unavailable.
  }
  clearEmailActionParams()
}

export function hasEmailSignInLink() {
  return Boolean(auth && isSignInWithEmailLink(auth, location.href))
}

export async function requestEmailSignInLink(email: string) {
  if (!auth) throw new Error('Firebase가 설정되지 않았습니다.')
  const normalizedEmail = email.trim()
  const returnTo = currentReturnTo()
  await sendSignInLinkToEmail(auth, normalizedEmail, {
    url: new URL(returnTo, location.origin).toString(),
    handleCodeInApp: true,
  })
  savePendingEmailSignIn({ email: normalizedEmail })
}

export async function completeEmailSignIn(email = getPendingEmailAddress()) {
  if (!auth) throw new Error('Firebase가 설정되지 않았습니다.')
  await setPersistence(auth, browserLocalPersistence).catch(() => undefined)
  const user = (await signInWithEmailLink(auth, email.trim(), location.href)).user

  try {
    localStorage.removeItem(pendingEmailStorageKey)
  } catch {
    // Signing in succeeded, so storage cleanup must not block navigation.
  }
  clearEmailActionParams()
  return user
}

export function loginFailureMessage(error: unknown, provider: LoginProvider) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
  if (provider === 'email') {
    if (code === 'auth/invalid-email') return '올바른 이메일 주소를 입력해 주세요.'
    if (code === 'auth/expired-action-code' || code === 'auth/invalid-action-code') {
      return '로그인 링크가 만료되었거나 이미 사용되었습니다. 새 링크를 받아 주세요.'
    }
    if (code === 'auth/invalid-credential') return '입력한 이메일이 로그인 링크와 일치하지 않습니다.'
    if (code === 'auth/too-many-requests') return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'
    if (code === 'auth/unauthorized-continue-uri') return '로그인 복귀 주소가 허용되지 않았습니다. 관리자에게 문의해 주세요.'
    if (code === 'auth/operation-not-allowed') return '이메일 링크 로그인이 아직 활성화되지 않았습니다. 관리자에게 문의해 주세요.'
    if (code === 'auth/network-request-failed') return '네트워크 연결을 확인하고 다시 시도해 주세요.'
    return '이메일 로그인을 진행하지 못했습니다. 잠시 후 다시 시도해 주세요.'
  }
  return 'Google 로그인에 실패했습니다. 팝업 허용 및 Firebase 인증 설정을 확인해 주세요.'
}

export function aiFailureMessage(error: unknown) {
  if (error instanceof Error && error.message.startsWith('HWP 파일')) return error.message

  const details = error as { code?: unknown; customErrorData?: { status?: unknown } }
  const code = typeof details?.code === 'string' ? details.code : ''
  const status = Number(details?.customErrorData?.status ?? 0)

  if (code === 'api-not-enabled') return 'AI 서비스 설정이 아직 반영되지 않았습니다. 잠시 후 다시 시도해 주세요.'
  if (code === 'no-api-key' || code === 'no-app-id' || code === 'no-project-id') {
    return 'AI 서비스 설정이 완료되지 않았습니다. 관리자에게 문의해 주세요.'
  }
  if (code === 'fetch-error' && (status === 401 || status === 403)) {
    return '앱 보안 확인에 실패했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.'
  }
  if (code === 'fetch-error' && status === 429) return 'AI 요청이 많습니다. 잠시 후 다시 시도해 주세요.'
  if (code === 'fetch-error' && status === 404) return '현재 AI 모델을 사용할 수 없습니다. 관리자에게 문의해 주세요.'
  if (code === 'fetch-error' && status >= 500) return 'AI 서비스가 일시적으로 불안정합니다. 잠시 후 다시 시도해 주세요.'
  if (code === 'parse-failed' || code === 'response-error' || code === 'invalid-schema' || error instanceof SyntaxError) {
    return 'AI 분석 결과를 처리하지 못했습니다. 다시 시도해 주세요.'
  }
  if (code === 'fetch-error' || (error instanceof Error && /fetch|network/i.test(error.message))) {
    return '네트워크 연결을 확인한 뒤 다시 시도해 주세요.'
  }
  return 'AI 문서 분석을 실행하지 못했습니다. 잠시 후 다시 시도해 주세요.'
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

export async function publishFormRecord({ formId, owner, program, questions, surveyEndDate, formType = 'general', theme = 'green', settings = defaultFormSettings, checkForExistingResponses = false }: {
  formId: string; owner: User; program: ProgramInfo; questions: FormQuestion[]; surveyEndDate: string; formType?: FormType; theme?: string; settings?: FormSettings; checkForExistingResponses?: boolean
}) {
  if (!db) throw new Error('Firestore가 설정되지 않았습니다.')
  if (settings.publicSlug) {
    const slugMatches = await getDocs(query(
      collection(db, 'forms'),
      where('settings.publicSlug', '==', settings.publicSlug),
      where('published', '==', true),
      limit(2),
    ))
    if (slugMatches.docs.some((item) => item.id !== formId)) throw new Error('public-slug-in-use')
  }
  let targetFormId = formId
  let responseCount = 0
  // A first publish must not read the not-yet-created form: Firestore correctly
  // denies that lookup because the document has no owner data to authorize.
  if (checkForExistingResponses) {
    const existingForm = await getDoc(doc(db, 'forms', formId))
    if (existingForm.exists()) {
      responseCount = Number(existingForm.data().responseCount ?? 0)
      const normalizeQuestions = (items: FormQuestion[]) => items.map(({ id, label, type, required, options, inputFormat, maxSelections, imageUrl, optionImageUrls }) => ({
        id, label, type, required, options: options ?? [], inputFormat: inputFormat ?? 'none', maxSelections: maxSelections ?? null,
        imageUrl: imageUrl ?? '', optionImageUrls: optionImageUrls ?? [],
      }))
      const previousQuestions = (existingForm.data().questions ?? []) as FormQuestion[]
      const questionsChanged = JSON.stringify(normalizeQuestions(previousQuestions)) !== JSON.stringify(normalizeQuestions(questions))
      if (questionsChanged) {
        const existingResponses = await getDocs(query(collection(db, 'forms', formId, 'responses'), limit(1)))
        if (!existingResponses.empty) {
          targetFormId = `form-${crypto.randomUUID().slice(0, 8)}`
          responseCount = 0
        }
      }
    }
  }

  const nextVersion = targetFormId === formId && checkForExistingResponses ? settings.version + 1 : 1
  const versionedSettings = {
    ...settings,
    integrations: { ...settings.integrations, formId: targetFormId },
    version: nextVersion,
  }
  const publicQuestions = questions.map(({ correctAnswers: _correctAnswers, correctFeedback: _correctFeedback, incorrectFeedback: _incorrectFeedback, ...question }) => {
    void _correctAnswers; void _correctFeedback; void _incorrectFeedback
    return question
  })
  await setDoc(doc(db, 'forms', targetFormId), {
    formId: targetFormId,
    creatorUid: owner.uid,
    ownerUid: owner.uid,
    ownerEmail: owner.email,
    program,
    questions: publicQuestions,
    formType,
    theme,
    settings: versionedSettings,
    status: settings.schedule.status,
    responseCount,
    published: settings.schedule.status !== 'private',
    surveyEndAt: Timestamp.fromDate(new Date(`${surveyEndDate}T23:59:59+09:00`)),
    expireAt: expirationFromSurveyEnd(surveyEndDate), updatedAt: serverTimestamp(),
  }, { merge: true })
  await setDoc(doc(db, 'forms', targetFormId, 'versions', String(nextVersion)), {
    version: nextVersion,
    program,
    questions,
    formType,
    theme,
    settings: versionedSettings,
    createdAt: serverTimestamp(),
    createdBy: owner.uid,
  })
  await setDoc(doc(db, 'forms', targetFormId, 'quiz', 'config'), {
    enabled: settings.quiz.enabled,
    releaseScore: settings.quiz.releaseScore,
    showCorrectAnswers: settings.quiz.showCorrectAnswers,
    questions: Object.fromEntries(questions.map((question) => [String(question.id), {
      points: Math.max(0, Number(question.points ?? 0)),
      correctAnswers: question.correctAnswers ?? [],
      correctFeedback: question.correctFeedback ?? '',
      incorrectFeedback: question.incorrectFeedback ?? '',
    }])),
    updatedAt: serverTimestamp(),
    updatedBy: owner.uid,
  })
  return targetFormId
}

export async function hasSubmittedResponse(formId: string, userUid: string) {
  if (!db) return false
  return (await getDoc(doc(db, 'forms', formId, 'responses', userUid))).exists()
}

export async function getPublishedForm(formId: string, includePrivate = false) {
  if (!db) throw new Error('Firestore가 설정되지 않았습니다.')
  let snapshot = await getDoc(doc(db, 'forms', formId))
  if (!snapshot.exists() && !includePrivate) {
    const slugMatches = await getDocs(query(
      collection(db, 'forms'),
      where('settings.publicSlug', '==', formId),
      where('published', '==', true),
      limit(1),
    ))
    if (!slugMatches.empty) snapshot = slugMatches.docs[0]
  }
  if (!snapshot.exists() || (!includePrivate && snapshot.data().published !== true)) throw new Error('published-form-not-found')
  const data = snapshot.data()
  return {
    id: snapshot.id,
    program: data.program as ProgramInfo,
    questions: data.questions as FormQuestion[],
    formType: (data.formType ?? 'general') as FormType, theme: String(data.theme ?? 'green'),
    settings: { ...defaultFormSettings, ...(data.settings ?? {}) } as FormSettings,
    responseCount: Number(data.responseCount ?? 0),
    surveyEndDate: data.surveyEndAt instanceof Timestamp ? data.surveyEndAt.toDate().toISOString().slice(0, 10) : '',
  }
}

export async function getOwnedForms(userUid: string) {
  if (!db) throw new Error('Firestore가 설정되지 않았습니다.')
  const snapshot = await getDocs(query(collection(db, 'forms'), where('ownerUid', '==', userUid)))
  const owned = snapshot.docs.filter((item) => !item.data().deletedAt).map((item) => {
    const data = item.data()
    return {
      id: item.id,
      title: String(data.program?.programName ?? '제목 없는 폼'),
      published: data.published === true,
      status: String(data.settings?.schedule?.status ?? (data.published ? 'open' : 'draft')),
      startsAt: String(data.settings?.schedule?.startsAt ?? ''),
      closesAt: String(data.settings?.schedule?.closesAt ?? ''),
      maxResponses: Number(data.settings?.submission?.maxResponses ?? 0),
      publicSlug: String(data.settings?.publicSlug ?? ''),
      responseCount: Number(data.responseCount ?? 0),
      organizationShared: false,
      workspaceName: String(data.settings?.workspace?.name ?? ''),
      ownerEmail: String(data.ownerEmail ?? ''),
    }
  })
  if (!functions) return owned
  try {
    const shared = await httpsCallable<Record<string, never>, { forms: typeof owned }>(functions, 'listOrganizationForms')({})
    return [...owned, ...shared.data.forms
      .filter((form) => !owned.some((item) => item.id === form.id))
      .map((form) => ({ ...form, title: `[${form.workspaceName || '조직 공유'}] ${form.title}` }))]
  } catch {
    return owned
  }
}

export async function getDeletedForms(userUid: string) {
  if (!db) throw new Error('Firestore가 설정되지 않았습니다.')
  const snapshot = await getDocs(query(collection(db, 'forms'), where('ownerUid', '==', userUid)))
  return snapshot.docs.filter((item) => Boolean(item.data().deletedAt)).map((item) => ({
    id: item.id,
    title: String(item.data().program?.programName ?? '제목 없는 폼'),
    deletedAt: item.data().deletedAt instanceof Timestamp ? item.data().deletedAt.toDate().toISOString() : '',
  }))
}

export async function getFormVersions(formId: string): Promise<Array<{
  version: number
  createdAt: string
  questionCount: number
  title: string
}>> {
  if (!db) throw new Error('Firestore가 설정되지 않았습니다.')
  const snapshot = await getDocs(collection(db, 'forms', formId, 'versions'))
  return snapshot.docs.map((item) => {
    const data = item.data()
    return {
      version: Number(data.version ?? item.id),
      createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : '',
      questionCount: Array.isArray(data.questions) ? data.questions.length : 0,
      title: String(data.program?.programName ?? '제목 없는 폼'),
    }
  }).sort((left, right) => right.version - left.version)
}

export async function deleteFormRecord(formId: string) {
  if (!db) throw new Error('Firestore가 설정되지 않았습니다.')
  await updateDoc(doc(db, 'forms', formId), {
    deletedAt: serverTimestamp(),
    publishedBeforeDelete: true,
    published: false,
    'settings.schedule.status': 'private',
    updatedAt: serverTimestamp(),
  })
}

export async function restoreFormRecord(formId: string) {
  if (!db) throw new Error('Firestore가 설정되지 않았습니다.')
  await updateDoc(doc(db, 'forms', formId), {
    deletedAt: null,
    published: false,
    'settings.schedule.status': 'paused',
    updatedAt: serverTimestamp(),
  })
}

export async function emptyDeletedForms(): Promise<number> {
  const userUid=auth?.currentUser?.uid
  if(!userUid)throw new Error('제작자 로그인이 필요합니다.')
  const deleted=await getDeletedForms(userUid)
  for(const form of deleted)await permanentlyDeleteForm(form.id)
  return deleted.length
}

export async function permanentlyDeleteForm(formId:string){
  if(!db)throw new Error('Firestore가 설정되지 않았습니다.')
  const formRef=doc(db,'forms',formId)
  const formSnapshot=await getDoc(formRef)
  if(!formSnapshot.exists()||!formSnapshot.data().deletedAt)throw new Error('휴지통에 있는 폼만 영구 삭제할 수 있습니다.')
  const childCollections=['responses','drafts','analysis','versions','quiz']
  const childSnapshots=await Promise.all(childCollections.map(name=>getDocs(collection(db,'forms',formId,name))))
  const references=childSnapshots.flatMap(snapshot=>snapshot.docs.map(item=>item.ref))
  for(let start=0;start<references.length;start+=450){
    const batch=writeBatch(db)
    references.slice(start,start+450).forEach(reference=>batch.delete(reference))
    await batch.commit()
  }
  await deleteDoc(formRef)
}

export async function getFormResponses(formId: string): Promise<StoredFormResponse[]> {
  if (!db) throw new Error('Firestore가 설정되지 않았습니다.')
  const snapshot = await getDocs(collection(db, 'forms', formId, 'responses'))
  return snapshot.docs.map((item) => {
    const data = item.data()
    return {
      id: item.id,
      responseId: String(data.responseId ?? item.id),
      formId,
      answers: data.answers ?? {},
      submittedAt: data.submittedAt instanceof Timestamp ? data.submittedAt.toDate().toISOString() : '',
      updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate().toISOString() : '',
      respondentUid: String(data.respondentUid ?? data.userUid ?? ''),
      anonymousId: String(data.anonymousId ?? ''),
      respondentEmail: String(data.respondentEmail ?? ''),
      respondentName: String(data.respondentName ?? ''),
      studentId: String(data.studentId ?? ''),
      status: data.status ?? 'submitted',
      formVersion: Number(data.formVersion ?? 1),
      attachments: data.attachments ?? [],
      quizResult: data.quizResult,
    }
  })
}

export async function queryFormResponses(
  formId: string,
  responseQuery: ResponseQuery,
  exportAll = false,
): Promise<ResponsePage> {
  // Response reads are permitted only to owners/collaborators by Firestore rules.
  // Keep this path independent from Cloud Functions so results remain available
  // on Firebase projects where callable functions have not been provisioned.
  const responses = await getFormResponses(formId)
  return queryResponses(responses, responseQuery, exportAll)
}

export async function manageFormResponses(
  formId: string,
  responseIds: string[],
  action: 'delete' | 'reviewed' | 'archived' | 'submitted',
) {
  if (!functions) throw new Error('Firebase Functions가 설정되지 않았습니다.')
  await httpsCallable(functions, 'manageFormResponses')({ formId, responseIds, action })
}

export async function getOwnResponse(formId: string): Promise<StoredFormResponse | null> {
  if (!functions) throw new Error('Firebase Functions가 설정되지 않았습니다.')
  const result = await httpsCallable<{ formId: string }, { response: StoredFormResponse | null }>(
    functions,
    'getOwnFormResponse',
  )({ formId })
  return result.data.response
}

export async function updateOwnResponse(
  formId: string,
  answers: Record<number, SubmissionAnswerValue>,
  respondent: { name: string; studentId: string; email: string },
) {
  if (!functions) throw new Error('Firebase Functions가 설정되지 않았습니다.')
  const result = await httpsCallable<
    Record<string, unknown>,
    { responseId: string; quizResult?: import('./types').QuizResult }
  >(functions, 'updateOwnFormResponse')({
    formId,
    answers,
    respondentName: respondent.name,
    studentId: respondent.studentId,
    respondentEmail: respondent.email,
  })
  return result.data.quizResult ?? null
}

export async function getPublicResultSummary(formId: string): Promise<{
  total: number
  summaries: import('./types').QuestionSummary[]
}> {
  if (!functions) throw new Error('Firebase Functions가 설정되지 않았습니다.')
  const result = await httpsCallable<
    { formId: string },
    { total: number; summaries: import('./types').QuestionSummary[] }
  >(functions, 'getPublicResultSummary')({ formId })
  return result.data
}

export async function setFormCollaborator(
  formId: string,
  email: string,
  role: 'viewer' | 'editor' | 'remove',
) {
  if (!functions) throw new Error('Firebase Functions가 설정되지 않았습니다.')
  await httpsCallable(functions, 'setFormCollaborator')({ formId, email, role })
}

export type GoogleSheetsConnectionStatus = {
  status: 'disconnected'|'authorized'|'connected'
  spreadsheetId?: string
  spreadsheetTitle?: string
  spreadsheetUrl?: string
}

export type GoogleSpreadsheetChoice = {
  id: string
  name: string
  modifiedTime: string
  webViewLink: string
}

export async function beginGoogleSheetsConnection(formId:string){
  if(!functions)throw new Error('Firebase Functions가 설정되지 않았습니다.')
  const result=await httpsCallable<{formId:string},{authorizationUrl:string}>(functions,'beginGoogleSheetsConnection')({formId})
  return result.data.authorizationUrl
}

export async function getGoogleSheetsConnection(formId:string):Promise<GoogleSheetsConnectionStatus>{
  if(!functions)throw new Error('Firebase Functions가 설정되지 않았습니다.')
  const result=await httpsCallable<{formId:string},GoogleSheetsConnectionStatus>(functions,'getGoogleSheetsConnection')({formId})
  return result.data
}

export async function listAvailableGoogleSpreadsheets(formId:string):Promise<GoogleSpreadsheetChoice[]>{
  if(!functions)throw new Error('Firebase Functions가 설정되지 않았습니다.')
  const result=await httpsCallable<{formId:string},{items:GoogleSpreadsheetChoice[]}>(functions,'listAvailableGoogleSpreadsheets')({formId})
  return result.data.items
}

export async function selectGoogleSpreadsheet(formId:string,spreadsheetId:string):Promise<GoogleSheetsConnectionStatus>{
  if(!functions)throw new Error('Firebase Functions가 설정되지 않았습니다.')
  const result=await httpsCallable<{formId:string;spreadsheetId:string},GoogleSheetsConnectionStatus>(functions,'selectGoogleSpreadsheet')({formId,spreadsheetId})
  return result.data
}

export async function createAndConnectGoogleSpreadsheet(formId:string):Promise<GoogleSheetsConnectionStatus>{
  if(!functions)throw new Error('Firebase Functions가 설정되지 않았습니다.')
  const result=await httpsCallable<{formId:string},GoogleSheetsConnectionStatus>(functions,'createAndConnectGoogleSpreadsheet')({formId})
  return result.data
}

export async function disconnectGoogleSheets(formId:string){
  if(!functions)throw new Error('Firebase Functions가 설정되지 않았습니다.')
  await httpsCallable<{formId:string},{status:'disconnected'}>(functions,'disconnectGoogleSheets')({formId})
}

export async function getFormDeliveryStatus(formId: string): Promise<Array<{
  id: string
  source: 'mail' | 'integrationDeliveries'
  status: string
  type: string
  error: string
  attempts: number
}>> {
  if (!functions) throw new Error('Firebase Functions가 설정되지 않았습니다.')
  const result = await httpsCallable<
    { formId: string },
    { deliveries: Array<{ id: string; source: 'mail' | 'integrationDeliveries'; status: string; type: string; error: string; attempts: number }> }
  >(functions, 'getFormDeliveryStatus')({ formId })
  return result.data.deliveries
}

export async function retryFormDelivery(
  deliveryId: string,
  source: 'mail' | 'integrationDeliveries',
) {
  if (!functions) throw new Error('Firebase Functions가 설정되지 않았습니다.')
  await httpsCallable(functions, 'retryFormDelivery')({ deliveryId, source })
}

export async function updateFormLifecycle(formId: string, status: FormSettings['schedule']['status']) {
  if (!db) throw new Error('Firestore가 설정되지 않았습니다.')
  await updateDoc(doc(db, 'forms', formId), {
    'settings.schedule.status': status,
    published: status !== 'private',
    updatedAt: serverTimestamp(),
  })
}

export async function updateFormSchedule(formId: string, startsAt?: string, closesAt?: string) {
  if (!db) throw new Error('Firestore가 설정되지 않았습니다.')
  await updateDoc(doc(db, 'forms', formId), {
    'settings.schedule.startsAt': startsAt || null,
    'settings.schedule.closesAt': closesAt || null,
    updatedAt: serverTimestamp(),
  })
}

export async function submitResponseOnce({ formId, user, answers, surveyEndDate, questions, settings = defaultFormSettings, respondentEmail = '', respondentName = '', studentId = '', attachments = [] }: {
  formId: string
  user: User
  answers: Record<number, SubmissionAnswerValue>
  surveyEndDate: string
  questions: FormQuestion[]
  settings?: FormSettings
  respondentEmail?: string
  respondentName?: string
  studentId?: string
  attachments?: ResponseAttachment[]
}): Promise<import('./types').QuizResult | null> {
  if (!functions) throw new Error('Firebase Functions가 설정되지 않았습니다.')
  void user
  void surveyEndDate
  void questions
  void settings
  try {
    const result = await httpsCallable<
      Record<string, unknown>,
      { responseId: string; quizResult?: import('./types').QuizResult }
    >(functions, 'submitFormResponse')({
      formId,
      answers,
      respondentEmail,
      respondentName,
      studentId,
      attachments,
    })
    return result.data.quizResult ?? null
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
    if (code.endsWith('already-exists')) throw new Error('already-submitted')
    const message = typeof error === 'object' && error && 'message' in error ? String(error.message) : ''
    throw new Error(message.replace(/^FirebaseError:\s*/i, '') || 'server-validation-failed')
  }
}

export function uploadResponseAttachment({
  formId, user, questionId, file, onProgress,
}: {
  formId: string
  user: User
  questionId: number
  file: File
  onProgress: (percentage: number) => void
}) {
  if (!storage) return Promise.reject(new Error('Firebase Storage가 설정되지 않았습니다.'))
  if (file.size > 20 * 1024 * 1024) return Promise.reject(new Error('file-too-large'))
  const safeName = file.name.replace(/[^0-9A-Za-z가-힣._-]/g, '_').slice(0, 120)
  const path = `response-files/${formId}/${user.uid}/${crypto.randomUUID()}-${safeName}`
  const upload = uploadBytesResumable(ref(storage, path), file, { contentType: file.type || 'application/octet-stream' })
  return new Promise<ResponseAttachment>((resolve, reject) => {
    upload.on('state_changed', (snapshot) => onProgress(Math.round(snapshot.bytesTransferred / snapshot.totalBytes * 100)), reject, async () => {
      resolve({
        id: crypto.randomUUID(),
        questionId,
        name: file.name,
        contentType: file.type,
        size: file.size,
        path,
        downloadUrl: await getDownloadURL(upload.snapshot.ref),
      })
    })
  })
}

const supportedFormImageExtensions = new Set([
  'pjp', 'jfif', 'jpe', 'pjpeg', 'jpeg', 'jpg', 'gif', 'png', 'tif', 'tiff', 'bmp', 'heic', 'heif', 'ico', 'webp',
])

export function uploadFormImage({
  formId,
  user,
  file,
  onProgress,
}: {
  formId: string
  user: User
  file: File
  onProgress?: (percentage: number) => void
}) {
  if (!storage) return Promise.reject(new Error('Firebase Storage가 설정되지 않았습니다.'))
  const extension=file.name.split('.').pop()?.toLowerCase()??''
  if (!supportedFormImageExtensions.has(extension)) return Promise.reject(new Error('unsupported-image-type'))
  if (file.size > 20 * 1024 * 1024) return Promise.reject(new Error('image-too-large'))
  const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(-100)
  const path=`form-images/${user.uid}/${formId}/${crypto.randomUUID()}-${safeName}`
  const upload=uploadBytesResumable(ref(storage,path),file,{contentType:file.type||`image/${extension}`})
  return new Promise<string>((resolve,reject)=>{
    upload.on('state_changed',
      (snapshot)=>onProgress?.(Math.round(snapshot.bytesTransferred/Math.max(1,snapshot.totalBytes)*100)),
      reject,
      ()=>void getDownloadURL(upload.snapshot.ref).then(resolve,reject),
    )
  })
}

export async function saveResponseDraft(draft: ResponseDraft) {
  if (!db) throw new Error('Firestore가 설정되지 않았습니다.')
  await setDoc(doc(db, 'forms', draft.formId, 'drafts', draft.actorId), {
    ...draft,
    updatedAt: serverTimestamp(),
  }, { merge: true })
}

export async function loadResponseDraft(formId: string, actorId: string): Promise<ResponseDraft | null> {
  if (!db) return null
  const snapshot = await getDoc(doc(db, 'forms', formId, 'drafts', actorId))
  if (!snapshot.exists()) return null
  const data = snapshot.data()
  return {
    formId,
    actorId,
    formVersion: Number(data.formVersion ?? 1),
    answers: data.answers ?? {},
    updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate().toISOString() : '',
  }
}

export async function deleteResponseDraft(formId: string, actorId: string) {
  if (!db) return
  await deleteDoc(doc(db, 'forms', formId, 'drafts', actorId))
}

const formSchema = Schema.object({ properties: {
  formType: Schema.enumString({ enum: ['application', 'satisfaction', 'demand_survey', 'general'] }),
  program: Schema.object({ properties: {
    programName: Schema.string(), description: Schema.string(), target: Schema.string(), period: Schema.string(),
    schedule: Schema.string(), capacity: Schema.string(), requirements: Schema.string(), privacyConsent: Schema.string(),
  }}),
  questions: Schema.array({ items: Schema.object({ properties: {
    label: Schema.string(), type: Schema.enumString({ enum: ['short_text', 'long_text', 'select', 'checkbox', 'consent', 'rating', 'number', 'file'] }),
    required: Schema.boolean(), options: Schema.array({ items: Schema.string() }),
    inputFormat: Schema.enumString({ enum: ['none', 'email', 'phone'] }),
  }, optionalProperties: ['options', 'inputFormat'] }) }),
  reviewNotes: Schema.array({ items: Schema.string() }),
  suggestedTheme: Schema.enumString({ enum: ['green', 'spring', 'summer', 'autumn', 'winter', 'kangnam'] }),
  suggestedEndDate: Schema.string(),
  suggestedSettings: Schema.object({ properties: {
    publicSlug: Schema.string(),
    participation: Schema.enumString({ enum: ['anyone', 'authenticated', 'kangnam', 'allowlist'] }),
    identityCollection: Schema.enumString({ enum: ['anonymous', 'profile', 'email_input', 'verified_email'] }),
    allowMultiple: Schema.boolean(),
    status: Schema.enumString({ enum: ['draft', 'scheduled', 'open', 'paused', 'closed', 'private'] }),
    startsAt: Schema.string(),
    closesAt: Schema.string(),
    maxResponses: Schema.integer(),
    allowDrafts: Schema.boolean(),
    allowEditAfterSubmit: Schema.boolean(),
    emailReceipt: Schema.boolean(),
    showOwnResponse: Schema.boolean(),
    showPublicResults: Schema.boolean(),
    randomizeQuestions: Schema.boolean(),
    submitLabel: Schema.string(),
    completionMessage: Schema.string(),
    icon: Schema.enumString({ enum: ['calendar', 'clipboard', 'graduation', 'heart', 'none'] }),
    shareTitle: Schema.string(),
    shareDescription: Schema.string(),
    newResponseEmail: Schema.boolean(),
  }}),
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
  const prompt = `첨부 자료를 읽고 실제 내용에 맞는 한국어 폼과 배포 설정을 함께 설계하세요.
만족도 조사라면 1~5점 rating과 자유의견을 포함하고, 신청서라면 신청 자격·일정·선발에 필요한 질문을 만드세요.
객관식(select)과 체크박스(checkbox) 질문에는 실제 문서 내용을 바탕으로 options를 반드시 2개 이상 작성하세요. checkbox는 여러 항목을 동시에 선택하는 질문에만 사용하세요.
이메일 또는 휴대전화 번호를 직접 입력받는 단답형 질문은 inputFormat을 각각 email 또는 phone으로 지정하고, 그 외 질문은 none으로 지정하세요.
suggestedSettings에는 문서에 근거해 참여 정책, 응답자 정보, 접수 일정, 최대 응답 수, 제출 후 동작, 공유 제목·설명을 추천하세요.
publicSlug는 폼 제목을 설명하는 짧은 영문 소문자·숫자·하이픈 주소로 만드세요. 날짜는 문서에 있으면 startsAt/closesAt에 ISO 형식으로, suggestedEndDate에는 YYYY-MM-DD로 적으세요.
강남대학교 공식 행사·사업이면 suggestedTheme은 kangnam, 계절성이 명확하면 해당 계절, 아니면 green을 사용하세요.
문서에 없는 사실은 만들지 말고 문자열은 빈 값, 숫자는 0, 보수적인 기본값을 사용한 뒤 reviewNotes에 확인할 내용을 남기세요.
개인정보 질문은 꼭 필요한 최소한만 만드세요. 메모: ${memo || '없음'}`
  const result = await model.generateContent([...parts, { text: prompt }])
  const parsed = JSON.parse(result.response.text()) as Omit<GeneratedForm, 'questions'> & { questions: Array<Omit<FormQuestion, 'id'>> }
  return {
    ...parsed,
    questions: parsed.questions.map((question, index) => {
      const selectable = question.type === 'select' || question.type === 'checkbox'
      const options = question.options?.map((option) => option.trim()).filter(Boolean) ?? []
      return {
        ...question,
        id: Date.now() + index,
        inputFormat: question.type === 'short_text' && ['email', 'phone'].includes(question.inputFormat ?? '') ? question.inputFormat : 'none',
        options: selectable ? (options.length >= 2 ? options : ['선택지 1', '선택지 2']) : undefined,
      }
    }),
  }
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
