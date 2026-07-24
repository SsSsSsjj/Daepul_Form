// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { QuestionSectionsEditor } from '../../App'
import type { FirebaseUser } from '../../firebase'
import type { FormQuestion } from '../../types'

const initialQuestions: FormQuestion[] = [{
  id: 1,
  label: '학적 상태',
  type: 'select',
  required: true,
  options: ['재학생', '휴학생'],
}]

function Harness() {
  const [questions, setQuestions] = useState(initialQuestions)
  return <QuestionSectionsEditor
    questions={questions}
    setQuestions={setQuestions}
    formId="test-form"
    user={{} as FirebaseUser}
    draggedQuestionId={null}
    dragOverQuestionId={null}
    reorderAnnouncement=""
    onDragStart={() => undefined}
    onDragMove={() => undefined}
    onDragEnd={() => undefined}
    onDragCancel={() => undefined}
    onMove={() => undefined}
    onDuplicate={() => undefined}
  />
}

describe('QuestionSectionsEditor', () => {
  it('adds a section and configures answer-based routing', () => {
    render(<Harness/>)

    fireEvent.click(screen.getByRole('button', { name: '섹션 추가' }))
    expect(screen.getAllByRole('textbox', { name: '섹션 제목' })).toHaveLength(2)

    fireEvent.click(screen.getByRole('checkbox', { name: /선택한 답변에 따라 이동/ }))
    const routeSelect = screen.getByRole('combobox', { name: '재학생 선택 시 동작' })
    expect(routeSelect).toHaveTextContent('“섹션 2” 섹션으로 이동')

    fireEvent.change(routeSelect, { target: { value: 'submit' } })
    expect(routeSelect).toHaveValue('submit')
  })
})
