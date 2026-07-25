import type {
  AnalyticsRole,
  FormQuestion,
  FormType,
  ProgramComparisonMetric,
} from '../../types'

export const gradeOptions = ['1학년', '2학년', '3학년', '4학년', '기타']

const roleDefaults: Record<AnalyticsRole, Omit<FormQuestion, 'id'>> = {
  grade: {
    label: '학년을 선택해 주세요.',
    type: 'select',
    required: true,
    options: gradeOptions,
    analyticsRole: 'grade',
  },
  overall_satisfaction: {
    label: '프로그램 전반에 얼마나 만족하셨나요?',
    type: 'rating',
    required: true,
    analyticsRole: 'overall_satisfaction',
  },
  strength: {
    label: '프로그램에서 좋았던 점을 적어 주세요.',
    type: 'long_text',
    required: false,
    analyticsRole: 'strength',
  },
  improvement: {
    label: '프로그램에서 아쉬웠거나 개선이 필요한 점을 적어 주세요.',
    type: 'long_text',
    required: false,
    analyticsRole: 'improvement',
  },
}

export function analyticsRolesForFormType(formType: FormType): AnalyticsRole[] {
  if (formType === 'general') return []
  return formType === 'satisfaction'
    ? ['grade', 'overall_satisfaction', 'strength', 'improvement']
    : ['grade']
}

export function ensureAnalyticsQuestions(
  questions: FormQuestion[],
  formType: FormType,
  startId = Date.now(),
): FormQuestion[] {
  const requiredRoles = analyticsRolesForFormType(formType)
  const present = new Set(questions.map(({ analyticsRole }) => analyticsRole).filter(Boolean))
  let nextId = Math.max(startId, ...questions.map(({ id }) => id + 1), 1)
  const additions = requiredRoles
    .filter((role) => !present.has(role))
    .map((role) => ({ ...roleDefaults[role], id: nextId++ }))
  return [...questions, ...additions]
}

export function ratio(numerator: number, denominator?: number) {
  return denominator && denominator > 0 ? numerator / denominator : undefined
}

export function filterProgramMetrics(
  programs: ProgramComparisonMetric[],
  year: number,
  grade = 'all',
) {
  return programs
    .filter((program) => program.year === year)
    .map((program) => {
      if (grade === 'all') return program
      const breakdown = program.gradeBreakdown[grade]
      return {
        ...program,
        demandResponses: breakdown?.demandResponses ?? 0,
        applicationResponses: breakdown?.applicationResponses ?? 0,
        satisfactionResponses: breakdown?.satisfactionResponses ?? 0,
        applicationRatio: ratio(breakdown?.applicationResponses ?? 0, program.selectedHeadcount),
        satisfactionResponseRate: ratio(breakdown?.satisfactionResponses ?? 0, program.selectedHeadcount),
        satisfactionAverage: breakdown?.satisfactionAverage,
        satisfactionSampleSize: breakdown?.satisfactionSampleSize ?? 0,
      }
    })
}

export function rankedPrograms(
  programs: ProgramComparisonMetric[],
  metric: 'demandResponses' | 'applicationResponses' | 'applicationRatio' | 'satisfactionResponseRate' | 'satisfactionAverage',
  direction: 'high' | 'low' = 'high',
) {
  return programs
    .filter((program) => metric !== 'satisfactionAverage' || program.satisfactionSampleSize >= 3)
    .filter((program) => program[metric] !== undefined)
    .sort((left, right) => {
      const difference = Number(right[metric]) - Number(left[metric])
      return direction === 'high' ? difference : -difference
    })
}

const stopWords = new Set([
  '그리고', '하지만', '프로그램', '조금', '정말', '너무', '있어서', '좋았습니다',
  '아쉬웠습니다', '합니다', '입니다', 'the', 'and', 'for',
])

export function improvementKeywords(comments: string[], limit = 8) {
  const counts = new Map<string, number>()
  comments.forEach((comment) => {
    new Set(comment.toLocaleLowerCase('ko').match(/[가-힣]{2,}|[a-z][a-z0-9-]{2,}/g) ?? [])
      .forEach((word) => {
        const normalized = /[가-힣]{3,}/.test(word) ? word.replace(/(으로|에서|에게|까지|부터|처럼|보다|하고|하며|가|이|은|는|을|를|과|와|도|에|의)$/u, '') : word
        if (normalized.length >= 2 && !stopWords.has(normalized)) {
          counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
        }
      })
  })
  return [...counts.entries()]
    .map(([keyword, count]) => ({ keyword, count }))
    .sort((left, right) => right.count - left.count || left.keyword.localeCompare(right.keyword, 'ko'))
    .slice(0, limit)
}
