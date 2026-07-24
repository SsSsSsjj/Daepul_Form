# 📝 대플폼 (Daepul Form)

`React` `TypeScript` `Firebase` `Gemini` `Vite`

대플폼은 강남대학교 대학일자리플러스센터의 프로그램 신청서, 만족도 조사, 수요조사 등 다양한 폼을 제작하고 배포하는 웹 서비스입니다.

PDF·이미지·HWP 참고자료와 담당자 메모를 Gemini가 분석해 폼 초안을 만들 수 있으며, AI를 사용하지 않고 빈 폼부터 직접 작성할 수도 있습니다. 제작한 폼은 공개 링크와 QR 코드로 공유하고, 수집된 응답은 대시보드와 Excel 파일로 확인할 수 있습니다.

## 🛠 주요 기능

- Google 또는 이메일 링크를 통한 제작자 로그인
- PDF, PNG, JPG, HWP, HWPX 참고자료 분석
- Gemini 기반 폼 기본정보·질문 자동 생성
- AI 없이 폼을 처음부터 직접 생성
- 질문 유형, 필수 여부, 공개 범위 및 접수 일정 설정
- 계절형 테마를 포함한 폼 디자인 선택
- 공개 링크·QR 코드 생성 및 공유
- 강남대학교 이메일 등 참여 대상별 접근 제어
- 서버 기반 제출값 검증과 중복 제출 제한
- 응답 임시저장, 접수 상태 관리 및 결과 대시보드
- 응답 원본·통계 Excel 내보내기
- 버튼으로 Google 스프레드시트를 연결해 새 응답 자동 저장

## 🧾 사용 흐름

```text
로그인
  → AI로 폼 만들기 또는 직접 폼 만들기
  → 기본정보와 질문 편집
  → 디자인·참여 정책 설정
  → 공개 링크 및 QR 배포
  → 응답 현황 확인·Excel 다운로드
```

### AI로 만들기

1. 참고문서를 첨부하거나 담당자 메모를 입력합니다.
2. `AI로 폼 만들기`를 선택합니다.
3. Gemini가 만든 기본정보와 질문을 검토·수정합니다.

### 직접 만들기

1. 첫 화면에서 `직접 폼 만들기`를 선택합니다.
2. 폼 제목, 설명, 대상, 기간과 질문을 입력합니다.
3. 디자인과 배포 정책을 설정한 뒤 공개합니다.

## 🚀 로컬 실행

Node.js 22 환경을 권장합니다.

```bash
npm install
npm --prefix functions install
cp .env.example .env.local
npm run dev
```

개발 서버가 시작되면 터미널에 표시된 로컬 주소로 접속합니다.

## ⚙️ 환경 설정 (`.env.local`)

```dotenv
VITE_FIREBASE_API_KEY=your_firebase_web_api_key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
VITE_FIREBASE_MEASUREMENT_ID=your_measurement_id
VITE_FIREBASE_APPCHECK_RECAPTCHA_ENTERPRISE_SITE_KEY=your_recaptcha_enterprise_site_key
VITE_ENABLE_DEMO_AUTH=false
```

실제 설정값은 Firebase Console의 웹 앱 설정에서 확인합니다. 상세한 Firebase 구성 방법은 [`FIREBASE_SETUP.md`](./FIREBASE_SETUP.md)를 참고하세요.

## 🔐 Firebase 사전 설정

- Firebase Authentication 공급자 설정
- Firestore Database 및 Cloud Storage 생성
- Firebase AI Logic과 Gemini API 사용 설정
- App Check 및 reCAPTCHA Enterprise 사이트 키 설정
- Cloud Functions와 Hosting 배포 권한 설정
- `firestore.rules`, `storage.rules`, `firestore.indexes.json` 배포

```bash
npm run build
npm run build:functions
firebase deploy
```

### Google 스프레드시트 자동 저장

운영자는 Google Cloud Console에서 Google Sheets API와 Google Drive API를 활성화하고 OAuth 2.0 웹 클라이언트를 만듭니다. 승인된 리디렉션 URI에는 배포될 `googleSheetsOAuthCallback` 함수 URL을 등록합니다.

```dotenv
# functions/.env.<project-id>
GOOGLE_SHEETS_CLIENT_ID=your-google-oauth-web-client-id
GOOGLE_SHEETS_REDIRECT_URI=https://asia-northeast3-your-project.cloudfunctions.net/googleSheetsOAuthCallback
```

클라이언트 보안 비밀번호는 파일에 저장하지 않고 Secret Manager에 등록합니다.

```bash
firebase functions:secrets:set GOOGLE_SHEETS_CLIENT_SECRET
firebase deploy --only functions
```

배포 후 사용자는 폼을 먼저 저장한 다음 `Google 스프레드시트 연결` 버튼에서 권한을 승인하고 기존 시트를 선택하거나 새 시트를 만들 수 있습니다. 새 응답은 선택한 문서의 `대플폼 응답` 탭에 자동 추가됩니다.

## 📁 폴더 구조

```text
├── src/
│   ├── assets/                   # 로고 등 정적 리소스
│   ├── features/responses/       # 응답 정책·결과 관리 UI
│   ├── App.tsx                   # 폼 제작·배포·관리 화면
│   ├── firebase.ts               # 인증, AI, Firestore 연동
│   ├── main.tsx                  # 앱 진입점
│   └── types.ts                  # 폼 데이터 계약
├── functions/
│   ├── src/                      # 인증·폼·응답 Cloud Functions
│   └── test/                     # Functions 테스트
├── test/                         # Firestore 보안 규칙 테스트
├── firestore.rules               # Firestore 접근 제어
├── storage.rules                 # 첨부파일 접근 제어
├── firebase.json                 # Firebase 배포·에뮬레이터 설정
├── .env.example                  # 환경 변수 예시
├── FIREBASE_SETUP.md             # Firebase 설정 가이드
└── CODEX2_INTEGRATION.md         # 후속 연동 인터페이스
```

## ✅ 검증 명령

```bash
npm run build
npm run build:functions
npm run lint
npm run test:functions
npm run test:firestore-rules
```

## 📌 주의사항

- `.env.local`과 Firebase 서비스 계정 키는 절대 저장소에 커밋하지 마세요.
- 운영 환경에서는 `VITE_ENABLE_DEMO_AUTH`를 반드시 `false`로 유지하세요.
- App Check, 인증 공급자, Firestore·Storage 보안 규칙을 배포 전에 확인하세요.
- 첨부자료와 응답에는 개인정보가 포함될 수 있으므로 접근 권한과 보존 기간을 신중히 설정하세요.
- AI가 만든 문항과 개인정보 동의 문구는 담당자가 반드시 검토한 뒤 배포하세요.

## 📬 문의

- 강남대학교 대학일자리플러스센터: `031-280-3431~5`
- E-mail: [job@kangnam.ac.kr](mailto:job@kangnam.ac.kr)
- 카카오톡 채널: [@강남대 대플](https://pf.kakao.com/_IzWdxj)
