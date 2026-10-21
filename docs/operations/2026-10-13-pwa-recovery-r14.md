PWA 복귀 안정성 수정

실기기 멈춤 자체는 재현하지 못함. 확인된 취약 경로: 카드·교환 API 호출 deadline 부재, hidden 상태 visualViewport.height를 화면 높이로 반영. GET 15초/쓰기 30초 deadline, 인증되지 않은 화면 focus refetch 방지, 30초 이상 백그라운드 및 online/BFCache 복귀에서 읽기 쿼리 취소 후 active 조회 복구. mutation은 재전송하지 않음. viewport hidden/0-height 방어 및 visibility 복귀 재계산. 기존 SW의 API 캐시 제외와 버전별 immutable shell 보존은 유지.

12 API/복귀 테스트, 5 lifecycle/viewport 테스트, TypeScript 통과. web-build-recovery-r14 생성. AWS 세션 로그아웃으로 운영 배포는 로그인 대기. 실제 서비스 반영 전.

운영 반영 완료: /opt/davaq-web-recovery-r14-6a4484bdd8bd/web-build-recovery-r14. 기존 root 백업 /opt/davaq-backups/before-web-recovery-r14.env. 운영 HTML 새 번들/height guard 확인. API /api/healthz status ok. 브라우저 카드 로딩 완료, 홈→교환→홈 전환 정상. root height 709px. EIC 임시 키 삭제 완료. 실기기에서 간헐적 멈춤 재발 여부는 추가 확인 필요.
