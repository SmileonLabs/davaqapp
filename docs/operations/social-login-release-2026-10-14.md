# DAVAQ Google / Apple 로그인 전환

## 운영 반영

- API: apple-auth-r19. 운영 provider 응답은 Google·Apple 모두 true.
- 웹: social-auth-r18. Google·Apple 버튼에서 각 제공자 인증 화면 진입 확인.
- 기존 회원 8명의 DB 사용자 ID와 데이터 유지. 신규 회원은 자체 SNS 인증으로 생성.
- 기존 회원은 기존 이메일 로그인 후 설정에서 SNS 계정 연결. 이메일 일치만으로 계정을 병합하지 않음.
- Google은 기존 TCGIndex OAuth 클라이언트에 DAVAQ callback 추가. TCGIndex callback 유지.
- Apple은 DAVAQ App ID와 별도 웹 Services ID 사용. 전용 키는 서버 보안 파일과 로컬 서명 보관 폴더에 저장. 비밀키 내용을 문서·앱에 포함하지 않음.

## 검증

- API 인증 테스트 10개 통과: 기존 회원 연결, 재사용 방지, verifier, 세션 및 Apple 토큰 검증 포함.
- 모바일 TypeScript 검사 통과. Hermes용 verifier 인코딩 160개 입력을 표준 base64url 결과와 비교해 통과.
- 운영 Google 시작 응답, Apple 인증 화면, 기존 회원 채팅 API 정상 응답 확인.
- 실제 사용자 Google·Apple 로그인 완료 및 물리 기기 테스트는 아직 확인 전.

## 네이티브 배포 진행

- Android 31 내부 테스트 배포 완료. iOS 22 Apple 처리 완료, DavaQ Internal 그룹 연결 확인.
- Chrome의 기존 DAVAQ 개발자 로그인으로 Play Console 접속 확인. 개발자 ID 5339000452196792538, 앱 ID 4975101285636395490.
- Google 계정 순번은 브라우저마다 다르므로 /u/0 또는 /u/2 번호를 계정 식별자로 취급하지 않음.
- Android 빌드 1차 디스크 부족은 재생성 가능한 Gradle transforms 및 Xcode ModuleCache 정리 후 재빌드로 해결.
- 소스, 서명 키, 기존 릴리스 파일은 보존. 갱신된 DavaQ App Store 2026 프로필 설치 및 Apple 로그인 entitlement 확인.

Android 31 빌드 검증 통과: 앱 서명, 프로덕션 API/로그인 번들, target SDK 36, ARM64 41개 라이브러리 16KB 정렬 확인.
AAB SHA-256: 3b4a6d495750ddcfbd811a9576b30140a7e7d347eaad807ed4e3b7237178c8da
APK SHA-256: 33f9c3e867546c67816da280a74e89e7f14689e79c35efcb10b1cf2bb46fe331
최종 파일은 .local/releases/social-auth-20261014-r19에 보관. 빌드 성공 후 Android 중간 생성물과 transforms 캐시를 정리해 iOS 빌드 공간 확보.

Google 내부 테스트 출시 23: 1.0.0 (31) - Google Apple login. Play Console에서 내부 테스터에게 제공됨 확인. 이전 30과 지원 기기 수 동일. 비차단 경고 1개는 R8 mapping 파일 미첨부.

iOS 22: xcodebuild 아카이브와 업로드 EXPORT SUCCEEDED. 보관 아카이브의 app.davaq.mobile / 1.0.0 / 22 확인. 시스템 키체인을 사용하는 codesign 검증 통과. Apple 처리 완료 및 DavaQ Internal 그룹 연결 확인. OS 제공 암호화 사용에 맞춰 비독점/비별도 알고리즘 항목 저장.
