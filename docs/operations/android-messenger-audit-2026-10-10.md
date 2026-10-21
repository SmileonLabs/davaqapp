# DavaQ Android 메신저 종합 감사 — 2026-10-10

검사 기준: `codex/android-messenger-native`, `c2ebce0`, Android versionCode 12 소스.
범위: 음성·영상 통화, 수신/발신/취소/거절/종료, 백그라운드·프로세스 종료 후 알림, 재접속, 메시지 전송 대기열·중복방지·읽음·첨부 권한, 친구·초대·그룹·Q/AI 소환.
iOS는 수정·검사 범위에서 제외했다. 운영에는 변경을 배포하지 않았다.

## 판정

전체 정상으로 판정할 수 없다. 7건은 실제 소스 실행 또는 격리 API에서 재현했으며, 1건은 네이티브와 JS 사이 실행 경로 누락을 코드로 확인했다. 기존 정상 경로 테스트가 통과하는 것과 잠금 화면/백그라운드 예외 경로의 안정성은 별개다.

이번 검사 중 `adb devices -l`에는 연결 기기가 없었다. 따라서 Galaxy S20의 실제 소리, 화면 잠금, Bluetooth, Wi-Fi/LTE 전환, 카메라·마이크 종료를 새로 검증하지 못했다. 아래의 코드 재현 결과를 실기기 재현으로 표현하지 않는다.

## 발견 사항

| ID | 우선순위 | 확인된 문제 | 사용자 영향 | 근거 / 수정 방향 |
|---|---|---|---|---|
| M01 | P1 | 백그라운드 종료 푸시가 `endSystemCall`을 호출하지 않고 `dismiss`만 호출 | 발신자가 취소해도 수신 장치에는 연결 중 알림·Telecom 세션이 만료까지 남을 수 있음. 다음 통화 등록이 막힐 수 있음 | `lib/fcmBackground.ts:26`, `lib/callNotifications.android.ts:57`, `plugins/android-telecom/DavaqTelecom.kt:214`. 실제 모듈 실행 결과 end 0회, dismiss 1회. 종료 푸시는 callId 단위 네이티브 종료·종료 표식·대기 액션 정리가 필요 |
| M02 | P1 | 백그라운드 수신은 `sentTime`을 검사하지 않고 수신 시각부터 45초를 새로 부여 | 오래전에 끝난 전화가 네트워크 복구 후 다시 울릴 수 있음 | `lib/fcmBackground.ts:34`, `lib/callNotifications.android.ts:47`. 15분 지난 푸시를 실행하자 신규 통화 시작 1회, 만료 +45초. foreground 정책은 같은 입력을 거절함. 서버의 절대 만료 시각·짧은 FCM TTL·클라이언트 공통 만료 검사가 필요 |
| M03 | P1 | 수신 소유자 기록이 24시간 후 만료되고 React 앱이 실행되지 않으면 갱신되지 않음 | 로그인 유지 상태라도 장시간 앱을 열지 않으면 백그라운드 통화 수신을 버림 | `lib/nativePushOwnerPolicy.ts:2`, `components/NativePushRegistrar.android.tsx:109`. 25시간 후 owner 판독이 null로 재현됨. 계정 격리를 유지하면서 세션/로그아웃과 연동되는 유효성 검증 필요; 단순 무기한 허용으로 우회하면 안 됨 |
| M04 | P1 | 전역 outbox가 빈 상태를 읽은 후 새 대기 메시지를 알리는 연결이 없음 | 전송 실패 후 채팅방을 나가 다른 화면에 있으면 자동 재시도가 멈춤 | `components/ChatOutboxDrainer.tsx:59,184,230`, `lib/chatMessageOutbox.ts`. 새 항목 추가 후 6번 타이머가 돌아도 읽기/전송 0회; 앱 foreground 이벤트 후 1회 전송. outbox 변경 구독 및 네트워크 복구 트리거 필요 |
| M05 | P1 | 푸시 해제에 로그인 직후 한 번 캡처한 bearer를 사용 | 오래 로그인한 뒤 로그아웃하면 해제 요청이 인증 만료로 실패할 수 있고 이전 계정의 푸시 연결이 서버에 남을 위험 | `components/NativePushRegistrar.android.tsx:109,132`, `lib/pushOwnership.ts:10`. 토큰 갱신 이후에도 최초 가짜 bearer를 사용하는 것을 실제 컴포넌트로 재현. 실패 후 지속 재시도 없음. 로그아웃 전에 해당 세션의 최신 토큰으로 해제하고, 기기 바인딩·기존 알림을 정리해야 함. 실제 타 계정 정보 노출이 관찰됐다는 뜻은 아님 |
| M06 | P1 | 앱 UI가 없는 상태의 네이티브 거절/시스템 응답은 영속 액션만 기록하며 인증된 서버 처리를 깨우는 경로가 없음 | 잠금 화면에서 거절해도 상대는 서버의 미응답 만료까지 기다릴 수 있음. 시스템/헤드셋 응답은 앱이 열리지 않으면 미디어 연결이 진행되지 않을 가능성 | `plugins/android-telecom/DavaqTelecom.kt:154,236,337,377`, `lib/callNotifications.android.ts:92`, `components/AndroidCallControls.android.tsx:37`. 거절 Receiver와 시스템 onAnswer는 React 화면을 시작하지 않음. 액션 소비자는 마운트된 React effect에 있음. 네이티브 cold-start 실기기 재현은 미실시; 인증 가능한 백그라운드 액션 처리 또는 명시적인 foreground 인계 필요 |
| M07 | P2 | 1회용 초대 코드를 조회한 뒤 조건 없이 사용 처리; 원자적 소비가 아님 | 두 사용자가 같은 코드를 동시에 사용하면 둘 다 친구 요청 생성 가능. 중간 insert 실패 시 이미 소비된 코드만 남을 수도 있음 | `api-server/src/routes/invites.ts:33,63`. 격리 PostgreSQL에서 row lock으로 동시 진입: HTTP 200/200, 친구 요청 2개 확인. active→used 조건부 갱신과 친구 요청 생성을 하나의 트랜잭션으로 묶어야 함 |
| M08 | P2 | Android 채팅 폴링에 foreground/네트워크 조건이 없음 | 채팅 화면이 마운트된 채 JS 타이머가 실행되는 동안 백그라운드에서도 typing 5초·messages 30초 요청. 통화 중 배터리·통신 부담 증가 가능 | `hooks/useChatPolling.ts:7,29,41`. background 상태로 타이머를 실행해 각 refetch 호출을 확인. OS가 JS를 정지시킨 상태에서도 계속 실행된다는 뜻은 아님. 화면 포커스·AppState·NetInfo 조건 통합 필요 |

M01~M06을 먼저 수정하고 Android 다음 버전을 검증해야 한다. M07은 서버 수정, M08은 앱 성능 보완이다.

## 확인한 정상 경로와 한계

- 운영 API 및 LiveKit 관리 API 접근 정상.
- 운영 최근 24시간 음성 통화 8건: cancelled 5, ended 2(accepted 2), missed 1. 영상 통화 기록은 해당 조회 구간에 없음.
- 운영 진단에서 오디오 송신/수신 바이트 증가가 함께 있는 샘플 확인: 35,759/45,394, 275,699/173,508, 172,030/280,248 bytes. 전송이 이루어졌다는 근거이며 실제 사용자가 들은 음질·소리를 보장하지 않음.
- API 컨테이너 로그의 FCM 통화 전송 완료 6건에 오류 코드 없음. Firebase 인증 불일치 재발은 관찰되지 않음. FCM 수락이 장치의 벨소리 재생 확인은 아님.
- 운영 조회 시 오래된 ringing 0, 종료 미완료 LiveKit room 0, 미완료 종료 카드 0, 남은 통화 사용자 잠금 0, LiveKit room 0.
- 친구 요청·초대 정상 사용·그룹 생성/추가/송수신, 답장·전달 중복 방지·반응·삭제·고정, Q 대화 소유권·전달, AI 소환 허용 철회/본인 복귀 후 해제의 정상 경로 통합 검사 통과.
- 비공개 첨부 접근 권한, 읽음 커서·메시지 순서 병합, 계정 전환 중 요청 격리, 통화 종료 멱등성·잠금 정리 테스트 통과.
- Redis publish 실패가 곧바로 푸시 경로를 중단한다는 의심은 제외: 실제 redisPublish에는 오류 포착과 local fallback이 있음.
- 통화 보류는 코드가 명시적으로 지원하지 않음. PiP, 근접 센서에 따른 화면 끄기와 전체 통화 이력 UX는 이번 검사에서 완성된 Android 기능으로 확인되지 않았으므로 정상 지원이라고 주장하지 않음.

## 실행한 자동 검사

| 검사 | 결과 |
|---|---:|
| Android native / plugin suite | 30 passed |
| 모바일 reliability 및 PWA 정책 | 67 passed |
| API 전체 단위/라우트 suite | 154 passed; 최초 실행에서 인프라 2 suites는 환경 조건으로 생략 |
| API client reliability | 8 passed |
| Call owner / chat transport | 7 passed |
| 기존 foreground service plugin | 4 passed |
| 웹 통화 자원 정리 회귀(보조 검사; Android 통화 검증을 대신하지 않음) | 15 passed |
| 영상 재생 정책(보조 검사) | 5 passed |
| 로컬 일회성 PostgreSQL/Redis 인프라·통화 일관성 | 13 passed; 앞서 생략된 suites를 별도로 실행 |
| 합계 | 303 tests passed |
| 프로젝트 종합 통합 harness | 251 checks passed; 메신저 외 교환 기능도 포함 |
| mobile / api TypeScript | 모두 통과 |

특별 재현은 기존 정상 경로 suite와 별도로 실행했다. 결과는 `evidence/android-messenger-audit-2026-10-10.jsonl`에 보관했다. 테스트용 데이터·요청은 로컬 일회성 DB에만 생성했다. 실제 이용자에게 메시지를 보내거나 전화를 걸지 않았다.

## 실기기 최종 검증표 — 미완료

아래를 실제 Android 2대로 통과하기 전에는 “메신저 전체 정상” 또는 “텔레그램 수준 완료”라고 판정할 수 없다.

1. 버전 확인 후 포그라운드/홈 이동/잠금/최근 앱 제거/장시간 미사용 각각에서 음성·영상 수신.
2. 발신 연결음, 수신 벨소리·진동, 무음·방해금지·권한 거부의 정확한 동작.
3. 발신 취소·거절·미응답·응답 직후 종료가 양쪽 화면과 통화 카드에 일치하는지.
4. 통화 종료 후 마이크·카메라·통화 알림·오디오 포커스가 해제되고 곧바로 재통화 가능한지.
5. Bluetooth/이어폰/스피커 전환, 헤드셋 수신, 일반 전화가 들어오는 경우.
6. 영상 카메라 on/off·전후면 전환·홈 이동·잠금 후 복귀.
7. Wi-Fi↔LTE 전환, 일시 단절, 비행기 모드 복구, 앱 종료 중 상대 종료.
8. 메시지 전송 직후 방 이탈, 오프라인 전송, 앱 재시작, 50개 이상 누락 복구, 이미지/파일 업로드 취소·재시도.
9. 읽음/알림 제거/알림 탭 이동 및 로그아웃·계정 변경 후 이전 계정 알림 차단.
10. 그룹채팅·친구 초대·AI 소환 정상 경로를 실제 UI에서 재검증.
## 플랫폼 동작 확인 자료

- [Firebase 메시지 수명](https://firebase.google.com/docs/cloud-messaging/customize-messages/setting-message-lifespan): Android TTL 미지정 시 기본 보관 기간은 4주다. DavaQ의 수신 통화 메시지는 별도 TTL을 지정하지 않으므로 M02의 클라이언트 만료 누락을 서버에서도 보완해야 한다.
- [Firebase Android 수신 처리](https://firebase.google.com/docs/cloud-messaging/android/receive-messages): 백그라운드의 notification payload는 OS 알림 영역으로 간다. 따라서 M05에서 서버의 이전 계정 토큰 해제가 실패하면 앱의 foreground owner 검사만으로 표시를 막을 수 없다.

## 실기기 연결 후 추가 검사 — 2026-10-10 13:50 KST 이후

Galaxy S20 5G(SM-G981N, Android 13)가 ADB에 정상 연결된 뒤 읽기 전용 기기 검사를 수행했다. 앞의 미연결 기록은 최초 코드 감사 시점의 상태이며, 이 절은 연결 후 확인한 결과다.

| 항목 | 실기기 결과 |
|---|---|
| 설치 상태 | Google Play 설치, versionCode 12 / versionName 1.0.0, 앱 프로세스 실행 중 |
| 권한 | 마이크·알림 허용. 카메라 미허용이며 아직 사용자 선택을 기록한 플래그 없음. 영상 통화에서 요청·허용 후 검증 필요 |
| 소리 | 내부·외부 ringer mode 모두 SILENT. 벨소리·알림 스트림 음소거, 미디어 음량 0. 통화 스트림은 음소거 아님, 수화부/스피커 저장 음량 8 |
| 방해금지 | OFF |
| 알림 채널 | 메시지·통화 채널 importance 4(HIGH), 삭제·사용자 차단 관찰되지 않음. 통화 채널 sound=null은 네이티브 Ringtone 재생 구현과 일치하며 그 값만으로 수신음 결함이라고 판정하지 않음 |
| 백그라운드 정책 | RUN_IN_BACKGROUND / RUN_ANY_IN_BACKGROUND 기본 allow, standby bucket active(10). Doze 예외 목록에는 없음; 이것만으로 수신 실패라고 판정하지 않음 |
| 검사 시점 자원 상태 | DavaQ 통화 서비스 없음, 마이크·카메라 사용 중 아님, 실제/요청 오디오 MODE_NORMAL, mode owner 없음 |
| 최근 종료 이력 | 최신 종료는 13:04 설치에 따른 종료. 해당 기록 이후 새 크래시·ANR 종료는 관찰되지 않음 |
| 앱 로그 | 최근 버퍼에 FATAL EXCEPTION/통화 FGS 권한 예외/ringback_start_failed 없음. 13:07·13:09에 WebSocket 1000 종료 로그가 있으며 실제 통화 종료 상태와 함께 검토해야 함; 이 로그만으로 앱 충돌로 판정하지 않음 |
| 운영 정리 재확인 | 오래된 ringing, 미종료 통화방, 미정리 종료 카드, 남은 통화 잠금 모두 0; LiveKit 방 0 |

잠금 화면 수신→발신 취소→재수신→응답→종료 테스트를 사용자에게 요청했다. 이번 관찰 구간에는 새 통화 이벤트가 없었으므로 실제 수신 벨소리, 양방향 가청 음성, 영상, 취소 직후 정리, 장시간 백그라운드 동작은 통과로 기록하지 않는다. 기존 8개 코드/API 발견 사항도 해결된 것으로 변경하지 않는다. 이번 추가 검사에서 앱·서버 코드, 사용자 소리 설정, 설치 버전을 변경하지 않았다.
