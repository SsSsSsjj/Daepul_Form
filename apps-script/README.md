# 대플폼 Google 스프레드시트 자동 저장

Firebase Blaze 요금제나 Cloud Functions 없이, 운영 계정의 Apps Script가 응답용
스프레드시트를 생성하고 Firestore 응답을 1분 간격으로 동기화합니다.

## 최초 1회 운영 설정

1. Apps Script에서 새 프로젝트를 만들고 `Code.gs`와 `appsscript.json`을 복사합니다.
2. Apps Script 프로젝트 설정의 스크립트 속성에 다음 값을 추가합니다.
   - `FIREBASE_PROJECT_ID`: Firebase 프로젝트 ID
   - `FIREBASE_WEB_API_KEY`: Firebase 웹 API 키
3. 스크립트를 실행하는 Google 계정을 Firebase 프로젝트 IAM 편집자로 추가합니다.
4. `installDaepulFormSync` 함수를 한 번 실행하고 권한을 승인합니다.
5. 웹 앱으로 배포합니다.
   - 실행 사용자: 웹 앱을 배포한 사용자
   - 액세스 권한: 모든 사용자
6. 배포 URL을 GitHub Actions 비밀 `VITE_GOOGLE_SHEETS_APPS_SCRIPT_URL`로 저장합니다.

## 제작자 사용 흐름

1. 폼을 배포합니다.
2. 외부 연동에서 **응답 시트 만들고 연결**을 누릅니다.
3. 운영 계정이 만든 스프레드시트가 제작자 이메일에 편집 권한으로 공유됩니다.
4. 새 응답은 약 1분 간격으로 `대플폼 응답` 시트에 추가됩니다.

연결을 해제해도 이미 생성된 스프레드시트는 삭제되지 않습니다.
