import assert from 'node:assert/strict'
import { deleteApp, initializeApp } from 'firebase/app'
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signInAnonymously } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  setDoc,
  updateDoc,
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
      access: { participation: 'anyone', allowMultiple: false, allowedEmails: [] },
      schedule: { status: 'open' },
      submission: { allowEditAfterSubmit: false },
    },
  })

  const initialResponse = await getDoc(responseRef)
  assert.equal(initialResponse.exists(), false, 'A respondent can check that their own response is absent')

  await assertDenied(setDoc(responseRef, {
    responseId: respondent.user.uid,
    formId,
    respondentUid: null,
    anonymousId: respondent.user.uid,
    answers: { 1: 'bypass' },
    status: 'submitted',
  }), 'Respondents cannot bypass the callable submission transaction')

  const adminUrl = `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents/forms/${formId}/responses/${respondent.user.uid}`
  const adminResponse = await fetch(adminUrl, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer owner',
    },
    body: JSON.stringify({
      fields: {
        responseId: { stringValue: respondent.user.uid },
        formId: { stringValue: formId },
        anonymousId: { stringValue: respondent.user.uid },
        answers: { mapValue: { fields: { 1: { stringValue: 'test' } } } },
        status: { stringValue: 'submitted' },
      },
    }),
  })
  assert.equal(adminResponse.ok, true, 'Cloud Functions Admin SDK equivalent can create a response')
  assert.equal((await getDoc(responseRef)).exists(), true, 'A respondent can read their own response')

  const strangerResponseRef = doc(stranger.db, 'forms', formId, 'responses', respondent.user.uid)
  await assertDenied(getDoc(strangerResponseRef), 'Another respondent cannot read the response')
  await assertDenied(setDoc(strangerResponseRef, { answers: { 1: 'forged' } }), 'Another respondent cannot overwrite the response')
  await assertDenied(setDoc(responseRef, { answers: { 1: 'duplicate' } }), 'A respondent cannot submit directly')
  await assertDenied(updateDoc(responseRef, { answers: { 1: 'changed' } }), 'A respondent cannot update the response')
  await assertDenied(deleteDoc(responseRef), 'A respondent cannot delete the response')

  await deleteDoc(formRef)
  console.log('Firestore response rules test passed')
} finally {
  await Promise.all([owner.app, respondent.app, stranger.app].map((app) => deleteApp(app)))
}
