# DAVAQ design system

DAVAQ is a card-for-card exchange service. Preserve shared chat, account and scanner functionality. TCGIndex remains the catalog/scanner source.

## Foundations

White canvas #FFFFFF; text and primary action #111111; secondary surface #F3F3F3; muted text #777777; borders #EAEAEA. Status errors retain semantic red. Camera view stays dark for visibility. Use 12px card radius, 10px buttons, 44px minimum interactive targets; spacing 4/8/12/16/20/24/32. Heading 26–32px, section 19px, body 15px, metadata 12–13px. Avoid decorative gradients and hero backgrounds. Native font fallback preserves Korean readability.

DAVAQ uppercase black wordmark. Simple readable Q tail expresses exchange; no illustrative mascot in product navigation.

## Components and hierarchy

Shared foundations: constants/colors.ts, constants/designSystem.ts; controls and frames: components/davaq/UI.tsx. Catalog and listing tiles: components/tcg/Cards.tsx. White bottom navigation, active black icon, inactive gray.

Home: owned/wanted registration, actual TCGIndex cards, mutual exchange candidates and map entry. Marketplace: two-column offered-card tiles, desired card names, region and condition ahead of cash value. Registration defaults to swap. New listings, wishes and proposals are card exchanges. Historical transactions remain readable and can finish using their existing lifecycle.

Map: marketplace list/map switch; authenticated TCG-only endpoint. Explicit optional area publication when registering. Coordinates rounded to two decimals on both client/server; shipping-only listings never publish coordinates. No legacy location inference or automatic device-position publication. Closed, unavailable and blocked-user listings are excluded. Results capped at 80, explicit area refresh. Card details and proposals reuse the existing transaction flow. Map source is OpenStreetMap, attribution retained, no prefetch.

## Release requirements

Apply additive migration 0041 before deploying API. Build API and PWA together; verify authenticated map search, location publication, blocks and unavailable stock. Keep original TCGIndex card/scanner service untouched. Native binary release requires device testing separately.

## Validation 2026-10-12

API and mobile TypeScript checks passed. Isolated PGlite transaction/map suite: 17 tests passed, including unpublished coordinates, reciprocal blocks, exhausted/reserved stock and coarse precision constraints. API/PWA production builds passed. Map renderer vendors pinned Leaflet JS/CSS/images/license at build time.

API content revision b4e73c914ca9de95c43fd0d61bcff4d190e5a51f. Additive migration 0041 applied after verified DavaQ-only database backup. Web refinements enlarge catalog artwork and restore bundled map renderer assets. Prepared release design-20261012-r5 (deployment pending AWS re-login) defers initial map search until authenticated configuration is ready, adds explicit foreground current-area lookup and a return path.

## 웹·네이티브 검색 분리 (2026-10-12)
- 웹: 하단 검색, 텍스트 검색 전용. /tcg/scan 및 /tcg/live-scan 직접 접근도 검색 화면으로 전환.
- 네이티브: 하단 스캔에서 카메라 즉시 진입. 이름 검색 별도 버튼. 탭을 떠나면 카메라 컴포넌트 해제.
- TCGIndex ScannerScreen의 네이티브 화면·게임 선택·시장/언어 선택·진단·자료 갱신·갤러리·가격 및 후보 UI를 재사용. DAVAQ 카드 상세/컬렉션으로 이동하도록 연결. 원본의 비네이티브 실행 분기만 제거.
- 타입 검사 통과. 새 네이티브 바이너리 배포 및 실물 카메라 검증은 미완료.

웹 r6 운영 배포 완료: 하단 검색 및 기존 스캔 주소의 텍스트 검색 전환 확인. 지도 보완 r5 내용 함께 포함. 서비스 health 정상, 임시 SSH 키 삭제 확인.

2026-10-13 r7 운영 배포: 흑백 아이콘/스플래시, 반듯한 홈 교환 카드, 이미지 확대 제거, 검색/보유 목록 2열. 타입 검사 통과 및 390px 웹 검증. 네이티브 아이콘/스플래시는 새 바이너리 배포 필요.

2026-10-13 r8 개선: 카드 타일/홈의 배경 프레임 및 안쪽 여백 축소. 정사각형 카탈로그 이미지의 내부 빈 공간만 확대 보정, 세로 이미지는 contain 유지. 홈은 전체 교환 매물과 카탈로그를 구분, 매물 없음 명시. 카드 둘러보기는 여러 TCG를 섞고 게임 필터 제공.

r9 운영 배포/시각 확인 완료: Image.getSize로 웹·앱 공통 비율 확인, 정사각형 카탈로그 내부 여백 1.75배 보정, 세로 이미지 contain 유지. 카드 타일 padding4, 높이 제한 제거. 실제 포켓몬/원피스 전체 테두리 표시와 혼합 목록 확인. 임시 배포 키 삭제.

2026-10-13 r10: 상단 대표 카드 2장 saveId를 아래 카탈로그 목록에서 제외. Frame은 탭/인증 화면 외 경로에 뒤로가기를 기본 표시하며 이전 앱 화면이 없으면 홈으로 이동. 타입 검사 및 웹 빌드 통과.
