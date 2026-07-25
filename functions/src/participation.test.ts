import { describe, expect, it } from 'vitest'
import { participantIsAllowed } from './participation'

describe('participantIsAllowed', () => {
  it('allows only the anyone policy for an anonymous session', () => {
    expect(participantIsAllowed({ participation: 'anyone' }, {}, true)).toBe(true)
    expect(participantIsAllowed({ participation: 'authenticated' }, {}, true)).toBe(false)
    expect(participantIsAllowed({ participation: 'kangnam' }, {}, true)).toBe(false)
    expect(participantIsAllowed({ participation: 'allowlist', allowedEmails: ['guest@example.com'] }, {}, true)).toBe(false)
  })

  it('requires a non-anonymous account for the authenticated policy', () => {
    expect(participantIsAllowed({ participation: 'authenticated' }, {}, false)).toBe(true)
  })

  it('requires a verified kangnam.ac.kr email for the university policy', () => {
    const access = { participation: 'kangnam' }
    expect(participantIsAllowed(access, { email: 'student@kangnam.ac.kr', email_verified: true }, false)).toBe(true)
    expect(participantIsAllowed(access, { email: 'student@kangnam.ac.kr', email_verified: false }, false)).toBe(false)
    expect(participantIsAllowed(access, { email: 'student@example.com', email_verified: true }, false)).toBe(false)
  })

  it('requires a verified email in the creator allowlist', () => {
    const access = { participation: 'allowlist', allowedEmails: ['Allowed@Example.com'] }
    expect(participantIsAllowed(access, { email: 'allowed@example.com', email_verified: true }, false)).toBe(true)
    expect(participantIsAllowed(access, { email: 'other@example.com', email_verified: true }, false)).toBe(false)
    expect(participantIsAllowed(access, { email: 'allowed@example.com', email_verified: false }, false)).toBe(false)
  })

  it('denies unknown policy values', () => {
    expect(participantIsAllowed({ participation: 'unexpected' }, {}, false)).toBe(false)
  })
})
