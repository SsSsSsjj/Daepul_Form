function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export type ParticipationAccess = {
  participation?: unknown
  allowedEmails?: unknown
  allowedGroups?: unknown
}

export type ParticipantToken = {
  email?: unknown
  email_verified?: unknown
  groups?: unknown
}

export function participantIsAllowed(
  access: ParticipationAccess,
  token: ParticipantToken,
  anonymous: boolean,
) {
  const participation = text(access.participation)
  const email = text(token.email).toLowerCase()
  const verified = token.email_verified === true

  if (participation === 'anyone') return true
  if (participation === 'authenticated') return !anonymous
  if (participation === 'kangnam') {
    return !anonymous && verified && email.endsWith('@kangnam.ac.kr')
  }
  if (participation === 'allowlist') {
    const allowedEmails = Array.isArray(access.allowedEmails)
      ? access.allowedEmails.map((value) => text(value).toLowerCase()).filter(Boolean)
      : []
    const allowedGroups = Array.isArray(access.allowedGroups)
      ? access.allowedGroups.map(text).filter(Boolean)
      : []
    const userGroups = Array.isArray(token.groups)
      ? token.groups.map(text).filter(Boolean)
      : []
    return !anonymous
      && verified
      && (allowedEmails.includes(email) || allowedGroups.some((group) => userGroups.includes(group)))
  }
  return false
}
