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
