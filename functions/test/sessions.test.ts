import { describe, expect, it } from 'vitest'
import { AuthFlowError } from '../src/auth/core'
import {
  OAuthSessionService,
  type OAuthSessionRepository,
  type StoredOAuthExchange,
  type StoredOAuthState,
} from '../src/auth/sessions'

class MemoryRepository implements OAuthSessionRepository {
  readonly states = new Map<string, StoredOAuthState>()
  readonly exchanges = new Map<string, StoredOAuthExchange>()

  async createState(id: string, state: StoredOAuthState) { this.states.set(id, state) }
  async takeState(id: string) {
    const state = this.states.get(id) ?? null
    this.states.delete(id)
    return state
  }
  async createExchange(id: string, exchange: StoredOAuthExchange) { this.exchanges.set(id, exchange) }
  async takeExchange(id: string) {
    const exchange = this.exchanges.get(id) ?? null
    this.exchanges.delete(id)
    return exchange
  }
}

describe('OAuthSessionService', () => {
  it('creates and consumes a browser-bound state once', async () => {
    const repository = new MemoryRepository()
    const service = new OAuthSessionService(repository, () => 1_000, () => 'state-code')
    const state = await service.createState('kakao', '/?form=abc')
    await expect(service.consumeState('kakao', state, state)).resolves.toBe('/?form=abc')
    await expect(service.consumeState('kakao', state, state)).rejects.toMatchObject({ code: 'invalid_state' })
  })

  it('rejects mismatched, provider-swapped, and expired states', async () => {
    let now = 1_000
    const repository = new MemoryRepository()
    const service = new OAuthSessionService(repository, () => now, () => 'state-code')
    const state = await service.createState('naver', '/')
    await expect(service.consumeState('naver', state, 'other')).rejects.toBeInstanceOf(AuthFlowError)
    await expect(service.consumeState('kakao', state, state)).rejects.toMatchObject({ code: 'invalid_state' })

    await service.createState('naver', '/')
    now += 10 * 60 * 1000 + 1
    await expect(service.consumeState('naver', state, state)).rejects.toMatchObject({ code: 'invalid_state' })
  })

  it('expires and prevents replay of one-time exchange codes', async () => {
    let now = 1_000
    const repository = new MemoryRepository()
    let nextCode = 'exchange-code'
    const service = new OAuthSessionService(repository, () => now, () => nextCode)
    const code = await service.createExchange('firebase-token')
    await expect(service.consumeExchange(code)).resolves.toBe('firebase-token')
    await expect(service.consumeExchange(code)).rejects.toMatchObject({ code: 'invalid_exchange_code' })

    nextCode = 'expired-code'
    const expiredCode = await service.createExchange('expired-token')
    now += 2 * 60 * 1000 + 1
    await expect(service.consumeExchange(expiredCode)).rejects.toMatchObject({ code: 'invalid_exchange_code' })
  })
})
