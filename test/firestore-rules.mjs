import assert from 'node:assert/strict'
import { deleteApp, initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth'
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

async function createClient(name) {
  const app = initializeApp({ apiKey: 'demo-key', projectId }, name)
  const auth = getAuth(app)
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true })
  const user = (await signInAnonymously(auth)).user
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

const owner = await createClient('rules-owner')
const respondent = await createClient('rules-respondent')
const stranger = await createClient('rules-stranger')
const formId = `rules-${Date.now()}`
const formRef = doc(owner.db, 'forms', formId)
const responseRef = doc(respondent.db, 'forms', formId, 'responses', respondent.user.uid)

try {
  await setDoc(formRef, { ownerUid: owner.user.uid, published: true })

  const initialResponse = await getDoc(responseRef)
  assert.equal(initialResponse.exists(), false, 'A respondent can check that their own response is absent')

  await setDoc(responseRef, {
    formId,
    userUid: respondent.user.uid,
    answers: { 1: 'test' },
    immutable: true,
  })
  assert.equal((await getDoc(responseRef)).exists(), true, 'A respondent can read their own response')

  const strangerResponseRef = doc(stranger.db, 'forms', formId, 'responses', respondent.user.uid)
  await assertDenied(getDoc(strangerResponseRef), 'Another respondent cannot read the response')
  await assertDenied(setDoc(strangerResponseRef, { answers: { 1: 'forged' } }), 'Another respondent cannot overwrite the response')
  await assertDenied(setDoc(responseRef, { answers: { 1: 'duplicate' } }), 'A respondent cannot submit twice')
  await assertDenied(updateDoc(responseRef, { answers: { 1: 'changed' } }), 'A respondent cannot update the response')
  await assertDenied(deleteDoc(responseRef), 'A respondent cannot delete the response')

  const ownerResponseRef = doc(owner.db, 'forms', formId, 'responses', respondent.user.uid)
  assert.equal((await getDoc(ownerResponseRef)).exists(), true, 'The form owner can read responses')
  await deleteDoc(ownerResponseRef)
  await deleteDoc(formRef)
  console.log('Firestore response rules test passed')
} finally {
  await Promise.all([owner.app, respondent.app, stranger.app].map((app) => deleteApp(app)))
}
