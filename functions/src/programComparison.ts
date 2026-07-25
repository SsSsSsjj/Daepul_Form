type ProgramInput = {
  id: string
  name: string
  year: number
  selectedHeadcount?: number
}
type FormInput = {
  id: string
  programId: string
  formType: 'application' | 'satisfaction' | 'demand_survey' | 'general'
  questions: Array<{ id: number; analyticsRole?: string }>
  responses: Array<{ answers?: Record<string, unknown> }>
  truncated?: boolean
}

type GradeMetric = {
  demandResponses: number
  applicationResponses: number
  satisfactionResponses: number
  satisfactionScores: number[]
}

function emptyGrade(): GradeMetric {
  return {
    demandResponses: 0,
    applicationResponses: 0,
    satisfactionResponses: 0,
    satisfactionScores: [],
  }
}

export function aggregateProgramComparison(programs: ProgramInput[], forms: FormInput[]) {
  return programs.map((program) => {
    const matching = forms.filter((form) => form.programId === program.id && form.formType !== 'general')
    const gradeBreakdown = new Map<string, GradeMetric>()
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
        const gradeValue = gradeQuestion ? response.answers?.[String(gradeQuestion.id)] : undefined
        const grade = typeof gradeValue === 'string' && gradeValue.trim() ? gradeValue.trim() : '학년 미응답'
        const gradeMetric = gradeBreakdown.get(grade) ?? emptyGrade()
        if (form.formType === 'demand_survey') gradeMetric.demandResponses += 1
        if (form.formType === 'application') gradeMetric.applicationResponses += 1
        if (form.formType === 'satisfaction') gradeMetric.satisfactionResponses += 1
        if (satisfactionQuestion && form.formType === 'satisfaction') {
          const score = Number(response.answers?.[String(satisfactionQuestion.id)])
          if (Number.isFinite(score) && score >= 1 && score <= 5) {
            satisfactionScores.push(score)
            gradeMetric.satisfactionScores.push(score)
          }
        }
        if (improvementQuestion && form.formType === 'satisfaction') {
          const comment = response.answers?.[String(improvementQuestion.id)]
          if (typeof comment === 'string' && comment.trim() && improvementComments.length < 200) {
            improvementComments.push(comment.trim())
          }
        }
        gradeBreakdown.set(grade, gradeMetric)
      })
    })

    const selected = program.selectedHeadcount && program.selectedHeadcount > 0
      ? program.selectedHeadcount
      : undefined
    return {
      programId: program.id,
      programName: program.name,
      year: program.year,
      selectedHeadcount: selected,
      demandResponses,
      applicationResponses,
      satisfactionResponses,
      applicationRatio: selected ? applicationResponses / selected : undefined,
      satisfactionResponseRate: selected ? satisfactionResponses / selected : undefined,
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
