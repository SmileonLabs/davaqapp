# DavaQ Android 빌드·배포 인수인계

기준일: 2026-10-10. 소스 기준 커밋 `c2ebce0`에서 감사 보고서·검사 증거와 이 문서를 추가한 체크포인트다. 이번 체크포인트는 새 앱 빌드나 Play 배포를 수행하지 않는다. iOS는 별도 작업 범위다.

## 현재 상태

- 저장소: https://github.com/SmileonLabs/davaqapp — push remote 이름은 `davaqapp`이다. `origin`은 다른 저장소이므로 이 작업에는 사용하지 않는다.
- 로컬 저장소: `C:/Users/mirac/Desktop/Projects/davaq`.
- Android 패키지 `app.davaq.mobile`, versionName `1.0.0`, versionCode `12`, minSdk 26, compile/targetSdk 36.
- Firebase 프로젝트 `davaq-43e77`. Android 클라이언트와 서버의 Firebase Admin 인증이 같은 프로젝트를 사용해야 한다.
- Play 내부 테스트에 버전 12가 게시되어 있으며 연결한 Galaxy S20에서도 Play 설치 버전 12를 확인했다. 공개 프로덕션 심사 완료를 뜻하지 않는다.
- 감사에서 보고한 8개 항목은 미해결이다. 새 양자 통화 테스트는 아직 완료되지 않았다. 상세 결과는 [감사 보고서](android-messenger-audit-2026-10-10.md), 재현 출력은 [검사 증거](evidence/android-messenger-audit-2026-10-10.jsonl)에 있다. 증거 파일의 bearer-1/bearer-2는 테스트용 문자열이며 실제 인증 토큰이 아니다.
- 기존 native-calling / google-play-testing 문서의 버전 8·9, 로컬 debug signing 안내는 당시 이력이다. 현재 버전과 업로드 서명 절차는 이 문서 및 실제 빌드 스크립트를 기준으로 한다.

## 파일 위치

아래 상대 경로의 기준은 위 로컬 저장소다. 비밀 파일은 경로만 기록하고 내용을 Git에 넣지 않는다.

| 용도 | 위치 | Git 관리 |
|---|---|---|
| 앱 식별자·버전·Expo 설정 | `artifacts/mobile/app.json`, `artifacts/mobile/app.config.js` | 포함 |
| 모바일 의존성 / 고정 버전 | `artifacts/mobile/package.json`, 루트 `pnpm-lock.yaml` | 포함 |
| Android 네이티브 생성 원본 | `artifacts/mobile/plugins/withAndroidTelecom.js`, `artifacts/mobile/plugins/android-telecom/` | 포함 |
| 업로드 서명 주입 플러그인 | `artifacts/mobile/plugins/withAndroidUploadSigning.js` | 포함; 값 없음 |
| AAB/APK 빌드 | `artifacts/mobile/scripts/build-play.ps1` | 포함 |
| APK / ELF 검사 | `artifacts/mobile/scripts/verify-android-apk.js`, `verify-android-elf.ps1` | 포함 |
| Firebase 클라이언트 설정 | `artifacts/mobile/google-services.json` | 제외 |
| 앱 로컬 환경변수 | `artifacts/mobile/.env.local` | 제외 |
| 업로드 서명 키 | `artifacts/mobile/.local-signing/davaq-upload.jks` | 제외 |
| 서명 파일 경로·별칭·암호 설정 | `artifacts/mobile/.local-signing/credentials.json` | 제외 |
| Expo 생성 Android 프로젝트 | `artifacts/mobile/android/` | 제외; prebuild로 생성 |
| 로컬 SDK·NDK 선택 | `artifacts/mobile/android/local.properties` | 제외 |
| 현재 PC의 Gradle / CMake 경로 보정 | `artifacts/mobile/android/davaq-local-ndk.gradle`, `davaq-short-modules.json` | 제외 |
| AAB 산출물 | `artifacts/mobile/android/app/build/outputs/bundle/release/app-release.aab` | 제외 |
| APK 산출물 | `artifacts/mobile/android/app/build/outputs/apk/release/app-release.apk` | 제외 |
| EAS 모바일 설정 | `artifacts/mobile/eas.json` | 포함; 현재 배포는 로컬 Gradle 경로로 검증 |

`credentials.json`의 필드명은 `keystorePath`, `keystorePassword`, `keyAlias`, `keyPassword`다. 기존 업로드 키와 이 파일은 안전한 별도 경로로 보관·전달해야 한다. 저장소 clone만으로 복원되지 않는다. 현재 키를 새로 생성해 대체하지 않는다.

## 필요한 설정

- Node.js: 이 PC에서 `24.17.0` 확인. pnpm: 저장소 지정 `10.26.1`.
- JDK 17, Android platform 36 / build-tools 36.0.0.
- 현재 PC의 Unity Android 도구 루트: `C:/Program Files/Unity/Hub/Editor/6000.4.7f1/Editor/Data/PlaybackEngines/AndroidPlayer`.
  - JDK: 위 경로의 `OpenJDK`; SDK: `SDK`; NDK: `NDK` (27.2.12479018).
  - CMake 작업 경로는 `C:/dq-cxx`, Ninja는 `C:/Users/mirac/AppData/Local/Temp/davaq-ninja-1.13.2/ninja.exe`.
  - 이 Ninja 파일은 임시 폴더에 있으므로 다른 PC나 청소 후에는 존재를 확인해야 한다.
  - 로컬 Gradle init 파일은 짧은 경로 매핑 JSON과 해당 junction을 함께 사용한다. 다른 PC에서는 이 경로들을 그대로 복사하지 말고 Expo SDK 54에 맞는 도구를 설정한다. 생성 폴더를 삭제하기 전에 로컬 보정 파일을 별도 보관한다.
- `DAVAQ_GOOGLE_SERVICES_JSON`: Firebase 클라이언트 JSON의 절대 경로. 미지정 시 모바일 폴더의 `google-services.json` 사용. `app.config.js`가 프로젝트와 패키지를 검증한다.
- `EXPO_PUBLIC_API_BASE_URL=https://davaq.anothermeai.app`.
- `EXPO_PUBLIC_DOMAIN=davaq.anothermeai.app`.
- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`: 승인된 기존 DavaQ 로그인 설정의 공개 키를 로컬 환경에서 공급한다. 실제 값은 이 문서에 기록하지 않는다. 운영 공개 전 Clerk production 전환은 별도 검토 항목이다.
- 빌드 스크립트는 서명 설정을 읽어 `DAVAQ_ANDROID_KEYSTORE_PATH`, `DAVAQ_ANDROID_STORE_PASSWORD`, `DAVAQ_ANDROID_KEY_ALIAS`, `DAVAQ_ANDROID_KEY_PASSWORD`를 해당 프로세스에만 주입하고 종료 시 복원한다. release 작업은 업로드 서명이 없으면 실패하도록 구성되어 있다.
- `EXPO_PUBLIC_*`는 앱 번들에 들어가므로 서버 키·비밀번호를 넣지 않는다.

## 로컬 빌드·검증 순서

다음은 후속 작업자가 실행할 절차다. 이번 인수인계에서는 실행하지 않았다.

1. 저장소 루트에서 `pnpm install --frozen-lockfile`을 실행한다.
2. 위 로컬 전용 파일을 안전하게 준비하고 `JAVA_HOME`, `ANDROID_HOME`, 공개 앱 환경변수를 설정한다.
3. 새 Play 배포라면 `app.json`의 Android versionCode를 이미 업로드한 번호보다 큰 값으로 변경하고 `app.config.js`의 최소 버전 처리도 함께 확인한다. 12를 재업로드하지 않는다.
4. 모바일 폴더에서 Android만 생성한다. `--clean`을 무조건 사용하면 로컬 도구 보정 파일이 없어질 수 있다.

```powershell
Set-Location C:/Users/mirac/Desktop/Projects/davaq/artifacts/mobile
$env:JAVA_HOME = 'C:/Program Files/Unity/Hub/Editor/6000.4.7f1/Editor/Data/PlaybackEngines/AndroidPlayer/OpenJDK'
$env:ANDROID_HOME = 'C:/Program Files/Unity/Hub/Editor/6000.4.7f1/Editor/Data/PlaybackEngines/AndroidPlayer/SDK'
$env:DAVAQ_GOOGLE_SERVICES_JSON = Join-Path (Get-Location) 'google-services.json'
$env:EXPO_PUBLIC_API_BASE_URL = 'https://davaq.anothermeai.app'
$env:EXPO_PUBLIC_DOMAIN = 'davaq.anothermeai.app'
# 기존 .env.local에 필요한 Clerk 공개 설정을 준비한다. 비밀을 콘솔에 출력하지 않는다.
pnpm exec expo prebuild --platform android --no-install
pnpm run typecheck
pnpm run test:android-native
pnpm run test:reliability
./scripts/build-play.ps1 -GradleInitScript "$((Get-Location).Path)/android/davaq-local-ndk.gradle" -Architectures arm64-v8a
```

다른 PC의 표준 도구 설정에서는 해당 로컬 init 파일을 전제로 하지 않는다. 기존 구현의 확인된 배포 ABI는 ARM64이며 다른 ABI는 추가 검증이 필요하다. prebuild가 추적 파일을 바꾸면 diff를 확인한다.

```powershell
# 12는 검증하려는 실제 versionCode로 바꾼다.
node scripts/verify-android-apk.js android/app/build/outputs/apk/release/app-release.apk 12 --release
./scripts/verify-android-elf.ps1 -Apk android/app/build/outputs/apk/release/app-release.apk
Get-FileHash android/app/build/outputs/bundle/release/app-release.aab -Algorithm SHA256
```

버전 12의 기존 AAB SHA-256: `DF2A007786961D23095AD129AD99A21D7A79A258E5E0E3251002E7170C264D19`. 새 빌드에는 별도의 해시·검사 결과를 기록한다.

## Play 배포 및 서버 의존성

- Play 개발자: SmileOn Labs (`5339000452196792538`). 앱 ID `4975101285636395490`, 내부 테스트 트랙 `4700858542884065904`.
- [내부 테스트 콘솔](https://play.google.com/console/u/2/developers/5339000452196792538/app/4975101285636395490/tracks/4700858542884065904?tab=releases).
- [테스터 참여·설치 링크](https://play.google.com/apps/internaltest/4700858542884065904).
- 검증된 업로드 서명 AAB를 새 내부 테스트 릴리스에 업로드하고 버전·변경사항·대상 트랙을 확인해 게시한다. 콘솔의 계정 선택 번호 `/u/2`는 로그인 환경에 따라 달라질 수 있다.
- Play App Signing 키와 로컬 업로드 키는 다르다. Play 설치본을 로컬 APK로 덮어쓰지 않는다. 이 기기에서는 ADB 설치 후 Play 설치자 검사가 앱 실행을 막은 이력이 있으므로 배포 검증은 공식 Play 업데이트로 진행한다.
- 루트 `eas.json`과 모바일 `eas.json`은 다르다. EAS를 사용한다면 모바일 작업 디렉터리와 EAS 서명/비밀 설정을 별도로 검증해야 한다. 이 문서는 EAS cloud 빌드 성공을 주장하지 않는다.
- DavaQ 서버 배포 경로 `/opt/davaq-release-20260912`, compose 파일 `docker-compose.server.yml`, API 컨테이너 `davaq-prod-app-1`.
- 서버 전용 환경 파일 `/opt/davaq-release-20260912/.env`: `FIREBASE_SERVICE_ACCOUNT`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` 등은 서버에서만 설정한다. 파일 본문·서비스 계정 JSON·SSH 키는 Git이나 앱에 포함하지 않는다.
- Firebase 서버 인증은 프로젝트 `davaq-43e77`로 수정되어 OAuth 및 FCM dry-run 검증을 통과했다. 새 클라이언트 빌드만으로 서버 푸시 설정이 변경되지는 않는다.
- [API 상태 확인](https://davaq.anothermeai.app/api/healthz). 공유 호스트의 AnotherMe 서비스·환경·DB를 변경하지 않는다.

## 중단 시점

이번 커밋은 검사 결과와 인수인계 기록만 추가한다. 발견 사항 수정, 추가 실기기 테스트, 새 버전 빌드, 운영 서버 변경, Play 게시 작업은 진행하지 않고 중단한다.
