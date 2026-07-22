import assert from 'node:assert/strict'

const publicOrigin = process.env.AUTH_PUBLIC_ORIGIN || 'http://127.0.0.1:5001'
const functionBase = `${publicOrigin}/daepulform/asia-northeast3/socialAuth`

async function request(path, init) {
  return fetch(`${functionBase}${path}`, { redirect: 'manual', ...init })
}

const startResponse = await request(
  `/api/auth/kakao/start?returnTo=${encodeURIComponent('https://evil.example/forms')}`,
)
assert.equal(startResponse.status, 302)

const authorizationUrl = new URL(startResponse.headers.get('location'))
assert.equal(authorizationUrl.origin, 'https://kauth.kakao.com')
const state = authorizationUrl.searchParams.get('state')
assert.ok(state)

const setCookie = startResponse.headers.get('set-cookie')
assert.match(setCookie, /HttpOnly/i)
assert.match(setCookie, /SameSite=Lax/i)
const stateCookie = setCookie.split(';', 1)[0]

const cancelResponse = await request(
  `/api/auth/kakao/callback?state=${encodeURIComponent(state)}&error=access_denied`,
  { headers: { Cookie: stateCookie } },
)
assert.equal(cancelResponse.status, 303)
const cancelLocation = new URL(cancelResponse.headers.get('location'))
assert.equal(cancelLocation.origin, publicOrigin)
assert.equal(cancelLocation.pathname, '/')
assert.equal(cancelLocation.searchParams.get('auth_error'), 'oauth_cancelled')

const replayResponse = await request(
  `/api/auth/kakao/callback?state=${encodeURIComponent(state)}&error=access_denied`,
  { headers: { Cookie: stateCookie } },
)
assert.equal(replayResponse.status, 303)
const replayLocation = new URL(replayResponse.headers.get('location'))
assert.equal(replayLocation.searchParams.get('auth_error'), 'invalid_state')

const exchangeResponse = await request('/api/auth/exchange', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Origin: publicOrigin,
  },
  body: JSON.stringify({ code: 'invalid-code' }),
})
assert.equal(exchangeResponse.status, 400)
assert.deepEqual(await exchangeResponse.json(), { error: 'invalid_exchange_code' })

console.log('Firebase Auth emulator smoke test passed')
