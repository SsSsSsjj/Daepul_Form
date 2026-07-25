import assert from 'node:assert/strict'
import { deleteApp, initializeApp } from 'firebase/app'
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signInAnonymously } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'

const projectId = process.env.GCLOUD_PROJECT || 'daepulform-rules-test'
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080'

function emulatorAddress(value) {
  const url = new URL(`http://${value}`)
  return { host: url.hostname, port: Number(url.port) }
}

async function createClient(name, anonymous = true) {
  const app = initializeApp({ apiKey: 'demo-key', projectId }, name)
  const auth = getAuth(app)
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true })
  const user = anonymous
    ? (await signInAnonymously(auth)).user
    : (await createUserWithEmailAndPassword(auth, `${name}@test.local`, 'test-password-123')).user
  const db = getFirestore(app)
  const { host, port } = emulatorAddress(firestoreHost)
  connectFirestoreEmulator(db, host, port)
  return { app, db, user }
}

async function assertDenied(operation, label) {
  await assert.rejects(operation, (error) => {
    assert.equal(error?.code, 'permission-denied', label)
    return true
  })
}

const owner = await createClient('rules-owner', false)
const respondent = await createClient('rules-respondent')
const stranger = await createClient('rules-stranger')
const formId = `rules-${Date.now()}`
const formRef = doc(owner.db, 'forms', formId)
const respondentFormRef = doc(respondent.db, 'forms', formId)
const responseRef = doc(respondent.db, 'forms', formId, 'responses', respondent.user.uid)

try {
  await assertDenied(getDoc(formRef), 'A missing form cannot be read before its owner creates it')
  await setDoc(formRef, {
    formId,
    creatorUid: owner.user.uid,
    ownerUid: owner.user.uid,
    responseCount: 0,
    published: true,
    settings: {
      access: {
        participation: 'anyone',
        identityCollection: 'anonymous',
        allowMultiple: false,
        allowedEmails: [],
        allowedGroups: [],
      },
      schedule: { status: 'open' },
      submission: { allowEditAfterSubmit: false, maxResponses: 10 },
    },
  })
  const ownerForms = await getDocs(query(collection(owner.db, 'forms'), where('ownerUid', '==', owner.user.uid)))
  assert.equal(ownerForms.docs.some((item) => item.id === formId), true, 'An owner can list their own forms')

  const privateIntegrationRef = doc(owner.db, 'forms', formId, 'privateIntegrations', 'googleSheets')
  await assertDenied(getDoc(privateIntegrationRef), 'A form owner cannot read stored Google OAuth credentials')
  await assertDenied(setDoc(privateIntegrationRef, { refreshToken: 'must-not-be-client-readable' }), 'A form owner cannot write Google OAuth credentials')

  const initialResponse = await getDoc(responseRef)
  assert.equal(initialResponse.exists(), false, 'A respondent can check that their own response is absent')

  await assertDenied(setDoc(responseRef, {
    responseId: respondent.user.uid,
    formId,
    actorUid: respondent.user.uid,
    respondentUid: null,
    anonymousId: respondent.user.uid,
    respondentEmail: '',
    respondentName: '',
    studentId: '',
    attachments: [],
    answers: { 1: 'bypass' },
    status: 'submitted',
    formVersion: 1,
    submittedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    immutable: true,
  }), 'A response cannot be created without its atomic counter update')

  await runTransaction(respondent.db, async (transaction) => {
    const currentForm = await transaction.get(respondentFormRef)
    assert.equal(currentForm.data().responseCount, 0)
    transaction.set(responseRef, {
      responseId: respondent.user.uid,
      formId,
      actorUid: respondent.user.uid,
      respondentUid: null,
      anonymousId: respondent.user.uid,
      respondentEmail: '',
      respondentName: '',
      studentId: '',
      attachments: [],
      answers: { 1: 'test' },
      status: 'submitted',
      formVersion: 1,
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      immutable: true,
    })
    transaction.update(respondentFormRef, {
      responseCount: 1,
      latestResponseId: respondent.user.uid,
      updatedAt: serverTimestamp(),
    })
  })

  assert.equal((await getDoc(responseRef)).exists(), true, 'A respondent can read their own response')
  assert.equal((await getDoc(respondentFormRef)).data().responseCount, 1, 'The response counter increments atomically')

  const strangerResponseRef = doc(stranger.db, 'forms', formId, 'responses', respondent.user.uid)
  await assertDenied(getDoc(strangerResponseRef), 'Another respondent cannot read the response')
  await assertDenied(setDoc(strangerResponseRef, { answers: { 1: 'forged' } }), 'Another respondent cannot overwrite the response')
  await assertDenied(setDoc(responseRef, { answers: { 1: 'duplicate' } }), 'A respondent cannot submit directly')
  await assertDenied(updateDoc(responseRef, { answers: { 1: 'changed' } }), 'A respondent cannot update the response')
  await assertDenied(deleteDoc(responseRef), 'A respondent cannot delete the response')
  await assertDenied(updateDoc(respondentFormRef, {
    responseCount: 2,
    latestResponseId: 'missing-response',
    updatedAt: serverTimestamp(),
  }), 'The response counter cannot increment without a new response')

  await deleteDoc(formRef)
  console.log('Firestore response rules test passed')
} finally {
  await Promise.all([owner.app, respondent.app, stranger.app].map((app) => deleteApp(app)))
}
