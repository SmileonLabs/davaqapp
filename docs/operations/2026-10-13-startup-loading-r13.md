# DAVAQ startup / loading / selected navigation — 2026-10-13

User reported that iPhone build 19 still showed the old purple character on launch. The installed-build report is confirmed by the user; physical-device reproduction is unavailable in this workspace. Build 19's archived Info.plist and compiled asset catalog already point at the black launch screen, so the exact on-device cause remains unconfirmed.

The iOS renewal now uses `DavaqMonoLaunchV2.storyboard`, `DavaqMonoLaunchLogoV2` and `DavaqMonoLaunchBackgroundV2`. A finalized Expo config plugin preserves this identity after prebuild, removes the default storyboard from linked resources, and removes obsolete launch-image keys. The packaged launch identity will be verified before deployment. Regeneration with an extra default storyboard reference passed the duplicate-reference regression check.

Legacy source icon/splash aliases were replaced with the monochrome DAVAQ mark. CardArt now uses expo-image memory/disk caching, computes cropping from the loaded image instead of a duplicate getSize request, shows loading state until the image is displayed, and offers retry on failure. The existing thumbnail-to-original fallback is retained. Selected bottom navigation now uses a black icon background, white icon and bold dark label; unselected items remain gray. Native scanner navigation remains hidden.

TypeScript, native configuration checks (4), plugin syntax and scoped diff checks passed. Deployment target: iOS 20, Android 29, web startup-r13. Deployment status will be updated after publisher verification.

Web deployed to `/opt/davaq-web-startup-r13-7a5f75fcf67b/web-build-startup-r13`. New bundle verified in the browser; selected navigation verified on Home and Market. Health endpoint returned `ok`. Temporary EIC key removed; security groups unchanged.

iOS 20 archive/signature passed. Its Info.plist references `DavaqMonoLaunchV2`; the compiled storyboard and three new logo resolutions are present, and the old `SplashScreen.storyboardc` is absent. Loading/retry labels are present in the packaged JS bundle. Export/upload succeeded after the first upload package failed from disk exhaustion. Completed compilation cache was cleared; signed archive and installed Pods retained. Android 29 build is running with one Gradle worker.

iOS 20 is available to DavaQ Internal (3 testers). Build ID `5786f6a5-ca52-4b93-917c-1977be6360a9`. Test notes saved, publisher evidence captured. Device launch confirmation requested from the user while Android build continues.

사용자 실기기 확인: iPhone 1.0.0 (20) 업데이트 후 시작 화면이 정상이라는 답변을 받음. Android 29 첫 빌드는 디스크 부족으로 실패했고, 완료된 iOS의 재생성 가능한 Pods를 제거한 뒤 재시도 중. Podfile.lock과 서명된 아카이브는 보존.

최종 상태: Android 29는 네이티브 라이브러리 병합을 통과했으나 App Bundle 패키징이 반복 디스크 부족으로 중단됨. 업로드/배포하지 않았음. 현재 약 120MB 여유, 추가 5GB 이상의 빌드 볼륨 경로를 요청함. 이전 Android 28 배포는 유지. iOS 20 아카이브는 모든 파일 SHA와 심볼릭 링크를 검증하여 tar.gz로 보존.

후속 복구: 사용자 PC 빌드 임시파일 삭제 승인 후 전역 Gradle 캐시 8.5GB, Xcode ModuleCache 1.6GB, React Native 다운로드 및 pip 캐시를 정리하여 약 12GiB 여유 확보. Android 29 재빌드 성공. 실제 APK/AAB의 카드 로딩·재시도 레이블, 운영 로그인·API, 서명, 16KB 정렬 검증 모두 통과. Google Play 업로드 처리 중.

최종 배포 완료: Android 1.0.0 (29), 내부 테스트 release 21. Google Play 화면에서 “내부 테스터에게 제공됨” 확인. 지원 기기 감소 없음. R8 매핑 파일 안내 1개는 난독화 비활성 설정에 따른 비차단 경고. 증거: evidence/android-29-loading-20261013.jpg. 실기기 Android 이미지 로딩/메뉴 동작은 사용자의 업데이트 후 확인이 남음.
