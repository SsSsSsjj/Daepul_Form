# Firebase 운영 설정

앱 코드에는 Firebase 웹 SDK, Google 로그인, Firestore 저장 구조와 보안 규칙이 포함되어 있습니다.

Firebase Console에서 다음 작업이 필요합니다.

1. Authentication > 로그인 방법에서 Google 공급자를 사용 설정합니다.
2. Authentication > 설정 > 승인된 도메인에 실제 배포 도메인을 추가합니다.
3. Firestore 데이터베이스를 만든 뒤 `firebase deploy --only firestore:rules`로 보안 규칙을 배포합니다.
4. Firestore TTL 정책에서 `forms`, `responses`, `analysis` 컬렉션 그룹의 `expireAt` 필드를 만료 필드로 설정합니다.

폼, 응답, 분석 문서에는 동일한 만료 시각이 기록됩니다. 응답 문서 ID는 Google 사용자 UID이므로 같은 폼에 동일 계정으로 두 번 생성할 수 없으며, 보안 규칙은 응답 수정과 클라이언트 삭제를 모두 거부합니다.

로컬 `.env.local`은 Git에서 제외됩니다. 새 환경에서는 `.env.example`을 복사한 뒤 Firebase 웹 설정값을 입력합니다.
