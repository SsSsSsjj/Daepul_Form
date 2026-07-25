const genericMessages = new Set([
  '',
  'internal',
  'internal error',
  'unknown',
  'unknown error',
])

function errorProperty(error: unknown, property: 'code' | 'message') {
  return typeof error === 'object' && error && property in error
    ? String(error[property as keyof typeof error])
    : ''
}

export function submissionErrorMessage(error: unknown) {
  const code = errorProperty(error, 'code').replace(/^functions\//, '')
  const message = errorProperty(error, 'message').replace(/^FirebaseError:\s*/i, '').trim()
  const safeServerMessage = genericMessages.has(message.toLowerCase()) ? '' : message

  if (code === 'already-exists') return 'already-submitted'
  if (code === 'unauthenticated') return '응답 세션이 만료되었습니다. 페이지를 새로고침한 뒤 다시 제출해 주세요.'
  if (code === 'unavailable') return '제출 서버에 연결할 수 없습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.'
  if (code === 'deadline-exceeded') return safeServerMessage || '제출 요청 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.'
  if (code === 'internal' || code === 'unknown' || !safeServerMessage) {
    return '서버에서 제출을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
  }
  return safeServerMessage
}
