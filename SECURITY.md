# 비밀값 관리

## 저장 위치

- 로컬 개발 값은 저장소에 올리지 않는 `.env.local`과 `functions/.env`에 둡니다.
- GitHub 배포 값은 저장소 설정의 Actions secrets에 둡니다.
- Firebase Functions의 서버 비밀값은 Firebase Secret Manager 또는 Functions 환경 설정에 둡니다.
- Apps Script의 서버 비밀값은 Script Properties에 둡니다.
- 서비스 계정 JSON, OAuth client secret, 개인키, 액세스·갱신 토큰은 Git에 커밋하지 않습니다.

필요한 변수 이름만 `.env.example`과 `functions/.env.example`에 예시 값으로 유지합니다.

## 클라이언트 설정 주의

`VITE_`로 시작하는 값은 빌드된 브라우저 JavaScript에 포함되므로 비밀값 저장소에 넣어도 사용자에게 공개됩니다. Firebase 웹 API 키와 App Check 사이트 키는 클라이언트 식별 정보이며, Google Cloud와 Firebase 콘솔에서 허용 도메인·API 제한을 함께 설정해야 합니다. OAuth client secret, 서비스 계정 키 같은 서버 비밀값에는 `VITE_` 접두사를 사용하면 안 됩니다.

## 점검

커밋 전에 다음 명령으로 현재 Git 추적 파일을 검사합니다.

```sh
npm run security:scan
```

배포 워크플로도 빌드 전에 같은 검사를 실행합니다. 비밀값이 한 번이라도 커밋되었다면 기록에서 지우는 것만으로는 충분하지 않으므로, 해당 제공자에서 즉시 폐기·재발급한 다음 Git 기록을 정리해야 합니다.
