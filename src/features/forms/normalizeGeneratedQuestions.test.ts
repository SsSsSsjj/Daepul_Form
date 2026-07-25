import { describe, expect, it } from 'vitest'
import { normalizeGeneratedQuestions, type AiGeneratedQuestion } from './normalizeGeneratedQuestions'

function selectQuestion(label: string, branchRules?: AiGeneratedQuestion['branchRules']): AiGeneratedQuestion {
  return {
    label,
    type: 'select',
    required: true,
    options: ['예', '아니오'],
    inputFormat: 'none',
    sectionId: 'section-1',
    sectionTitle: '기본 질문',
    branchRules,
  }
}

describe('normalizeGeneratedQuestions', () => {
  it('creates answer-based routes to normalized section ids', () => {
    const result = normalizeGeneratedQuestions([
      selectQuestion('참여하시겠습니까?', [
        { option: '예', action: 'section', targetSectionId: 'section-2' },
        { option: '아니오', action: 'section', targetSectionId: 'section-3' },
      ]),
      {
        label: '참여 목적',
        type: 'long_text',
        required: true,
        inputFormat: 'none',
        sectionId: 'section-2',
        sectionTitle: '예 응답',
        sectionNext: 'submit',
      },
      {
        label: '참여하지 않는 이유',
        type: 'long_text',
        required: false,
        inputFormat: 'none',
        sectionId: 'section-3',
        sectionTitle: '아니오 응답',
        sectionNext: 'submit',
      },
    ], 100)

    expect(result.questions[0].branch).toEqual({
      예: 'section-section-2',
      아니오: 'section-section-3',
    })
  })

  it('removes repeated routing prompts while preserving the actual branch question', () => {
    const repeated = Array.from({ length: 57 }, (_, index) => selectQuestion(
      `분기 질문 ${index + 1}`,
      index === 56
        ? [
          { option: '예', action: 'section', targetSectionId: 'section-2' },
          { option: '아니오', action: 'section', targetSectionId: 'section-3' },
        ]
        : undefined,
    ))
    const result = normalizeGeneratedQuestions([
      ...repeated,
      {
        label: '예 응답 질문',
        type: 'short_text',
        required: true,
        inputFormat: 'none',
        sectionId: 'section-2',
        sectionTitle: '예 응답',
      },
      {
        label: '아니오 응답 질문',
        type: 'short_text',
        required: true,
        inputFormat: 'none',
        sectionId: 'section-3',
        sectionTitle: '아니오 응답',
      },
    ], 100)

    expect(result.questions.filter(({ sectionId }) => sectionId === 'section-section-1')).toHaveLength(1)
    expect(result.questions[0].branch).toBeDefined()
    expect(result.reviewNotes[0]).toContain('56개')
  })

  it('does not crash when next or submit rules omit a target section id', () => {
    const result = normalizeGeneratedQuestions([
      selectQuestion('계속하시겠습니까?', [
        { option: '예', action: 'next' },
        { option: '아니오', action: 'submit' },
      ]),
    ], 100)

    expect(result.questions[0].branch).toEqual({ 아니오: 'submit' })
  })
})
