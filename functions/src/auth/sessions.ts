import type { Firestore } from 'firebase-admin/firestore'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { AuthFlowError, randomCode, safeEqual, sha256, type SocialProvider } from './core'

const STATE_TTL_MS = 10 * 60 * 1000
const EXCHANGE_TTL_MS = 2 * 60 * 1000

export type StoredOAuthState = {
  provider: SocialProvider
  returnTo: string
  expiresAtMs: number
}

export type StoredOAuthExchange = {
  customToken: string
  expiresAtMs: number
}

export interface OAuthSessionRepository {
  createState(id: string, state: StoredOAuthState): Promise<void>
  takeState(id: string): Promise<StoredOAuthState | null>
  createExchange(id: string, exchange: StoredOAuthExchange): Promise<void>
  takeExchange(id: string): Promise<StoredOAuthExchange | null>
}

type StateDocument = Omit<StoredOAuthState, 'expiresAtMs'> & { expiresAt: Timestamp }
type ExchangeDocument = Omit<StoredOAuthExchange, 'expiresAtMs'> & { expiresAt: Timestamp }

export class FirestoreOAuthSessionRepository implements OAuthSessionRepository {
  constructor(private readonly firestore: Firestore) {}

  async createState(id: string, state: StoredOAuthState) {
    await this.firestore.collection('oauthStates').doc(id).create({
      provider: state.provider,
      returnTo: state.returnTo,
      expiresAt: Timestamp.fromMillis(state.expiresAtMs),
      createdAt: FieldValue.serverTimestamp(),
    })
  }

  async takeState(id: string) {
    return this.firestore.runTransaction(async (transaction) => {
      const reference = this.firestore.collection('oauthStates').doc(id)
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) return null
      transaction.delete(reference)
      const data = snapshot.data() as StateDocument
      return { provider: data.provider, returnTo: data.returnTo, expiresAtMs: data.expiresAt.toMillis() }
    })
  }

  async createExchange(id: string, exchange: StoredOAuthExchange) {
    await this.firestore.collection('oauthExchanges').doc(id).create({
      customToken: exchange.customToken,
      expiresAt: Timestamp.fromMillis(exchange.expiresAtMs),
      createdAt: FieldValue.serverTimestamp(),
    })
  }

  async takeExchange(id: string) {
    return this.firestore.runTransaction(async (transaction) => {
      const reference = this.firestore.collection('oauthExchanges').doc(id)
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) return null
      transaction.delete(reference)
      const data = snapshot.data() as ExchangeDocument
      return { customToken: data.customToken, expiresAtMs: data.expiresAt.toMillis() }
    })
  }
}

export class OAuthSessionService {
  constructor(
    private readonly repository: OAuthSessionRepository,
    private readonly now: () => number = Date.now,
    private readonly createRandomCode: () => string = randomCode,
  ) {}

  async createState(provider: SocialProvider, returnTo: string) {
    const state = this.createRandomCode()
    await this.repository.createState(sha256(state), {
      provider,
      returnTo,
      expiresAtMs: this.now() + STATE_TTL_MS,
    })
    return state
  }

  async consumeState(provider: SocialProvider, state: string, cookieState: string) {
    if (!state || !cookieState || !safeEqual(state, cookieState)) {
      throw new AuthFlowError('invalid_state', 'OAuth state가 브라우저 세션과 일치하지 않습니다.')
    }
    const stored = await this.repository.takeState(sha256(state))
    if (!stored || stored.provider !== provider || stored.expiresAtMs <= this.now()) {
      throw new AuthFlowError('invalid_state', 'OAuth state가 만료되었거나 이미 사용되었습니다.')
    }
    return stored.returnTo
  }

  async createExchange(customToken: string) {
    const code = this.createRandomCode()
    await this.repository.createExchange(sha256(code), {
      customToken,
      expiresAtMs: this.now() + EXCHANGE_TTL_MS,
    })
    return code
  }

  async consumeExchange(code: string) {
    if (!code || code.length > 200) throw new AuthFlowError('invalid_exchange_code', '일회용 로그인 코드가 올바르지 않습니다.')
    const stored = await this.repository.takeExchange(sha256(code))
    if (!stored || stored.expiresAtMs <= this.now()) {
      throw new AuthFlowError('invalid_exchange_code', '일회용 로그인 코드가 만료되었거나 이미 사용되었습니다.')
    }
    return stored.customToken
  }
}
