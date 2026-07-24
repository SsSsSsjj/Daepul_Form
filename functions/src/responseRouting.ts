type StoredQuestion = Record<string, unknown>

function text(value: unknown, maximum = 120) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

export function questionsOnResponseRoute(questions: unknown[], answers: Record<string, unknown>) {
  const sections: Array<{ id: string; questions: StoredQuestion[] }> = []
  questions.forEach((item) => {
    const question = item && typeof item === 'object' ? item as StoredQuestion : {}
    const sectionId = text(question.sectionId) || 'section-main'
    const section = sections.find(({ id }) => id === sectionId)
    if (section) section.questions.push(question)
    else sections.push({ id: sectionId, questions: [question] })
  })
  if (sections.length <= 1) return sections.flatMap(({ questions: items }) => items)

  const active: StoredQuestion[] = []
  const visited = new Set<string>()
  let index = 0
  while (index >= 0 && index < sections.length) {
    const section = sections[index]
    if (visited.has(section.id)) break
    visited.add(section.id)
    active.push(...section.questions)

    let target = ''
    for (const question of section.questions) {
      const branch = question.branch && typeof question.branch === 'object' && !Array.isArray(question.branch)
        ? question.branch as Record<string, unknown>
        : {}
      const branchTarget = branch[String(answers[String(question.id ?? '')] ?? '')]
      if (typeof branchTarget === 'string' && branchTarget) { target = branchTarget; break }
    }
    if (!target) target = text(section.questions.find(({ sectionNext }) => sectionNext)?.sectionNext)
    if (target === 'submit') break
    if (target) {
      const targetIndex = sections.findIndex(({ id }) => id === target)
      if (targetIndex < 0) break
      index = targetIndex
    } else index += 1
  }
  return active
}
