# Firebase 설정

대플폼은 Firebase Authentication, Firestore, Hosting, AI Logic과 App Check를 사용합니다.

## App Check 로컬 개발

`npm run dev`로 실행하면 개발 빌드에서만 App Check 디버그 모드가 활성화됩니다.

1. 로컬 주소를 브라우저에서 엽니다.
2. 개발자 도구 콘솔에서 `App Check debug token: ...` 값을 확인합니다.
3. Firebase Console의 **보안 > App Check > 앱**에서 웹 앱의 메뉴를 열고 **디버그 토큰 관리**를 선택합니다.
4. 표시된 토큰을 등록합니다.

디버그 토큰은 브라우저에 저장되며 코드나 `.env` 파일, GitHub에 넣지 않습니다. `localhost`를 reCAPTCHA 허용 도메인에 추가하지 않습니다.

## 배포 환경

최종 사용자가 AI 기능을 사용하려면 Firebase Console에서 웹 앱을 reCAPTCHA Enterprise 제공업체에 등록하고, 발급된 사이트 키를 다음 환경변수에 넣은 뒤 다시 빌드해야 합니다.

```text
VITE_FIREBASE_APPCHECK_RECAPTCHA_ENTERPRISE_SITE_KEY=발급된_사이트_키
```

사이트 키는 공개 클라이언트 식별자이며 디버그 토큰과 다릅니다. 디버그 토큰은 절대 배포하지 않습니다.

## 기타 필수 설정

1. Authentication에서 Google 로그인 제공업체를 활성화합니다.
2. Authentication의 승인된 도메인에 실제 배포 도메인을 추가합니다.
3. Firestore 보안 규칙을 배포합니다.
4. Firebase AI Logic API와 App Check 적용 상태를 확인합니다.
5. Firestore의 `expireAt` 필드에 TTL 정책을 설정해 종료 14일 후 데이터를 삭제합니다.

## 로그인 제공자 설정

### 이메일과 Google

Firebase Console의 **Authentication > 로그인 방법**에서 다음 제공자를 활성화합니다.

- 이메일/비밀번호
- Google

이메일 계정은 Firebase Console이나 별도 회원가입 흐름에서 미리 생성되어 있어야 합니다. 현재 대플폼 화면은 기존 이메일 계정의 로그인만 지원하며 회원가입과 비밀번호 재설정은 제공하지 않습니다.

### 카카오와 네이버 사전 준비

카카오·네이버 로그인은 Firebase Functions가 OAuth 인가 코드를 교환한 뒤 Firebase 커스텀 토큰을 발급합니다. Functions와 Secret Manager를 사용하려면 Firebase 프로젝트를 Blaze 요금제로 전환해야 합니다.

먼저 실제 사용자가 접속할 하나의 canonical origin을 정합니다. 예시는 다음과 같습니다.

```text
https://daepulform.web.app
```

카카오 Developers에서 애플리케이션을 생성한 뒤 카카오 로그인을 활성화하고, 이메일·닉네임 동의항목과 REST API 클라이언트 시크릿을 설정합니다. 다음 Redirect URI를 등록합니다.

```text
https://YOUR_DOMAIN/api/auth/kakao/callback
```

네이버 Developers에서 네이버 로그인 애플리케이션을 생성하고 회원 프로필의 이메일·이름 권한을 신청합니다. 다음 Callback URL을 등록합니다.

```text
https://YOUR_DOMAIN/api/auth/naver/callback
```

`functions/.env.<project-id>` 파일에 공개 origin을 저장합니다. 이 값은 비밀이 아니지만 배포 환경마다 다르므로 Git에는 커밋하지 않습니다.

```text
AUTH_PUBLIC_ORIGIN=https://YOUR_DOMAIN
```

OAuth 앱 키는 코드나 `.env`에 넣지 않고 Secret Manager에 등록합니다.

```powershell
firebase functions:secrets:set KAKAO_CLIENT_ID
firebase functions:secrets:set KAKAO_CLIENT_SECRET
firebase functions:secrets:set NAVER_CLIENT_ID
firebase functions:secrets:set NAVER_CLIENT_SECRET
```

로컬 Functions Emulator에서는 Git에서 제외되는 `functions/.secret.local`에 같은 네 개의 값을 넣을 수 있습니다.

### 커스텀 토큰 권한과 TTL

Functions 런타임 서비스 계정이 Firebase 커스텀 토큰을 서명할 수 있어야 합니다. 배포 후 `iam.serviceAccounts.signBlob` 오류가 발생하면 Google Cloud IAM에서 해당 런타임 서비스 계정에 **서비스 계정 토큰 생성자**(`roles/iam.serviceAccountTokenCreator`) 역할을 부여합니다.

Firestore의 다음 collection group에서 `expiresAt` 필드 TTL을 활성화합니다.

- `oauthStates`
- `oauthExchanges`

API는 만료 시각을 직접 검사하고 일회용 문서를 즉시 삭제합니다. TTL은 중단된 로그인에서 남은 문서를 정리하는 용도입니다.

### 빌드와 배포

```powershell
npm run build
npm run lint
npm run build:functions
npm run test:functions
npm run test:functions:emulator
firebase deploy --only functions:socialAuth,firestore:rules,hosting
```

에뮬레이터 스모크 테스트 전에는 Git에서 제외되는 `functions/.env.local`을 만듭니다.

```text
AUTH_PUBLIC_ORIGIN=http://127.0.0.1:5001
```

`functions/.secret.local`에는 테스트용 공급자 값을 저장합니다. 실제 키를 사용할 필요는 없습니다.

```text
KAKAO_CLIENT_ID=emulator-kakao-client
KAKAO_CLIENT_SECRET=emulator-kakao-secret
NAVER_CLIENT_ID=emulator-naver-client
NAVER_CLIENT_SECRET=emulator-naver-secret
```

스모크 테스트는 외부 `returnTo` 차단, OAuth 취소, `state` 재사용 거부, 잘못된 일회용 교환 코드 거부를 실제 HTTP Function과 Firestore 에뮬레이터에서 확인합니다. 실제 공급자 로그인은 배포 후 테스트 계정으로 확인합니다.

카카오·네이버 공급자 콘솔에는 반드시 `AUTH_PUBLIC_ORIGIN`과 같은 도메인의 Callback URL을 등록해야 합니다. `web.app`, `firebaseapp.com`, 커스텀 도메인을 섞어 사용하지 않습니다.
