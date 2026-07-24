# Codex 2 연동 계약

## 공통 타입

`src/types.ts`가 단일 계약 원본이다.

- `Form`, `Section`, `Question`, `Option`, `BranchRule`
- `FormAccess`, `FormSchedule`, `Theme`, `FormDraft`
- `FormResponse`, `Answer`, `Respondent`, `UploadMetadata`
- `FormAccessDecision`

기존 프로토타입 호환 타입은 `FormQuestion`, `StoredFormResponse`로 유지한다. 공개 후에도
`formId`, 질문 `id`, 선택지 `id`를 바꾸지 않는다.

## 클라이언트 서비스

`src/formService.ts`의 `formService`를 사용한다.

| 함수 | 용도 |
| --- | --- |
| `getPublicForm(formId)` | 공개 폼과 현재 접근/제출 가능 상태 조회 |
| `getPublicFormBySlug(userId, slug)` | `/{userId}/{slug}` 주소로 공개 폼 조회 |
| `getFormAccess(formId)` | 차단 사유, 상태, 응답 수, 잔여 수/시간 조회 |
| `submitResponse(input)` | 서버 검증 후 응답을 원자적으로 저장 |
| `checkSlug(slug, formId?)` | 사용자별 slug 사용 가능 여부 조회 |
| `reserveSlug(formId, slug)` | 최종 저장 시 slug를 트랜잭션으로 예약 |
| `updateLifecycle(formId, status)` | `draft/scheduled/open/paused/closed/private` 변경 |
| `listResponses(formId, pageSize, cursor?)` | 결과 목록 최신순 cursor 페이지네이션 |

모든 변경 함수는 Firebase 인증 컨텍스트를 사용한다. `submitResponse`는 “누구나 응답”인
경우에도 `signInAsGuest()`로 만든 Firebase 익명 세션 뒤에서 호출한다.

## 서버 검증

`functions/src/index.ts`의 `submitFormResponse`와 `functions/src/forms.ts`의 조회·관리 callable이
다음을 검사한다.

- 실제 폼 상태와 시작/마감 시각
- 최대 응답 수와 `responseCount` 원자적 증가
- 익명/로그인/학교/특정 계정·그룹 접근 정책
- 계정당 또는 브라우저 식별자당 중복 제출
- 필수 답변
- 테스트 제출은 폼 제작자만 허용

응답 문서는 클라이언트가 Firestore에 직접 쓸 수 없다. `submitFormResponse`만 Admin SDK
트랜잭션으로 생성한다.

## Firestore 경로

- `forms/{formId}`: 폼 본문, 설정, 상태, `creatorUid`, `responseCount`
- `forms/{formId}/responses/{responseId}`: 제출 응답
- `forms/{formId}/versions/{versionId}`: 불변 버전 스냅샷 기반
- `formDrafts/{creatorUid}_{formId}`: 제작 중 클라우드 자동저장
- `formSlugs/{creatorUid}_{slug}`: 사용자별 주소 예약

`firestore.rules`에서 제작자만 자신의 폼과 결과를 관리할 수 있으며, 접근 정책에 맞지
않는 사용자는 공개 질문 문서를 직접 읽을 수 없다.

## 상태 의미

- `draft`: 링크 접근/제출 불가
- `scheduled`: 설정에 따라 안내 접근 가능, 시작 전 제출 불가
- `open`: 공개 및 접수 중
- `paused`: 링크 접근 가능, 제출 불가
- `closed`: 링크 접근 가능, 제출 불가
- `private`: 링크 접근/제출 모두 불가

서버는 예약 시작 시각이 지나면 `scheduled`를 실질적으로 `open`으로, 마감 시각이 지나면
`open`을 실질적으로 `closed`로 판정한다.
