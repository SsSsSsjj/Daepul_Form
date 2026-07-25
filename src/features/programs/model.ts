import type {
  AnalyticsRole,
  FormQuestion,
  FormType,
  ProgramComparisonMetric,
  ProgramRecord,
  StoredFormResponse,
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

export type ProgramComparisonFormInput = {
  id: string
  programId: string
  formType: FormType
  questions: FormQuestion[]
  responses: StoredFormResponse[]
  truncated?: boolean
}

type GradeAccumulator = {
  demandResponses: number
  applicationResponses: number
  satisfactionResponses: number
  satisfactionScores: number[]
}

function emptyGradeAccumulator(): GradeAccumulator {
  return {
    demandResponses: 0,
    applicationResponses: 0,
    satisfactionResponses: 0,
    satisfactionScores: [],
  }
}

export function aggregateProgramComparison(
  programs: ProgramRecord[],
  forms: ProgramComparisonFormInput[],
): ProgramComparisonMetric[] {
  return programs.map((program) => {
    const matching = forms.filter((form) => form.programId === program.id && form.formType !== 'general')
    const gradeBreakdown = new Map<string, GradeAccumulator>()
    const satisfactionScores: number[] = []
    const improvementComments: string[] = []
    let demandResponses = 0
    let applicationResponses = 0
    let satisfactionResponses = 0

    matching.forEach((form) => {
      const gradeQuestion = form.questions.find(({ analyticsRole }) => analyticsRole === 'grade')
      const satisfactionQuestion = form.questions.find(({ analyticsRole }) => analyticsRole === 'overall_satisfaction')
      const improvementQuestion = form.questions.find(({ analyticsRole }) => analyticsRole === 'improvement')
      form.responses.forEach((response) => {
        if (form.formType === 'demand_survey') demandResponses += 1
        if (form.formType === 'application') applicationResponses += 1
        if (form.formType === 'satisfaction') satisfactionResponses += 1
        const gradeValue = gradeQuestion ? response.answers[String(gradeQuestion.id)] : undefined
        const grade = typeof gradeValue === 'string' && gradeValue.trim() ? gradeValue.trim() : '학년 미응답'
        const gradeMetric = gradeBreakdown.get(grade) ?? emptyGradeAccumulator()
        if (form.formType === 'demand_survey') gradeMetric.demandResponses += 1
        if (form.formType === 'application') gradeMetric.applicationResponses += 1
        if (form.formType === 'satisfaction') gradeMetric.satisfactionResponses += 1
        if (satisfactionQuestion && form.formType === 'satisfaction') {
          const rating = Number(response.answers[String(satisfactionQuestion.id)])
          if (Number.isFinite(rating) && rating >= 1 && rating <= 5) {
            satisfactionScores.push(rating)
            gradeMetric.satisfactionScores.push(rating)
          }
        }
        if (improvementQuestion && form.formType === 'satisfaction') {
          const comment = response.answers[String(improvementQuestion.id)]
          if (typeof comment === 'string' && comment.trim() && improvementComments.length < 200) {
            improvementComments.push(comment.trim())
          }
        }
        gradeBreakdown.set(grade, gradeMetric)
      })
    })

    return {
      programId: program.id,
      programName: program.name,
      year: program.year,
      selectedHeadcount: program.selectedHeadcount,
      demandResponses,
      applicationResponses,
      satisfactionResponses,
      applicationRatio: ratio(applicationResponses, program.selectedHeadcount),
      satisfactionResponseRate: ratio(satisfactionResponses, program.selectedHeadcount),
      satisfactionAverage: satisfactionScores.length
        ? satisfactionScores.reduce((sum, value) => sum + value, 0) / satisfactionScores.length
        : undefined,
      satisfactionSampleSize: satisfactionScores.length,
      gradeBreakdown: Object.fromEntries([...gradeBreakdown.entries()].map(([grade, metric]) => [
        grade,
        {
          demandResponses: metric.demandResponses,
          applicationResponses: metric.applicationResponses,
          satisfactionResponses: metric.satisfactionResponses,
          satisfactionAverage: metric.satisfactionScores.length
            ? metric.satisfactionScores.reduce((sum, value) => sum + value, 0) / metric.satisfactionScores.length
            : undefined,
          satisfactionSampleSize: metric.satisfactionScores.length,
        },
      ])),
      improvementComments,
      truncated: matching.some(({ truncated }) => truncated),
    }
  })
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
