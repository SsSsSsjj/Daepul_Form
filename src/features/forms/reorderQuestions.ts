import type { FormQuestion } from '../../types'

export function reorderQuestions(
  questions: FormQuestion[],
  sourceId: number,
  targetId: number,
) {
  const sourceIndex = questions.findIndex((question) => question.id === sourceId)
  const targetIndex = questions.findIndex((question) => question.id === targetId)
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return questions

  const next = [...questions]
  const [moved] = next.splice(sourceIndex, 1)
  next.splice(targetIndex, 0, moved)
  return next
}
