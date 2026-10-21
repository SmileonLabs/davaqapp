# 서버 디스크 정리 — 2026-10-16

대상: 기존 EC2 3.36.44.173. 작업 전 루트 116GiB, 사용 115GiB, 여유 약 1GiB(100%).

실행 중인 컨테이너 14개와 전체 컨테이너의 bind mount를 확인한 뒤 정리했다. 운영 DB·데이터 볼륨·카드 카탈로그·스캐너 인덱스·사진·인증키는 보존했다.

- 미사용 Docker 빌드 캐시: 도구 보고 10.09GB 정리.
- dangling Docker 이미지: 도구 보고 2.095GB 정리. 태그가 있는 이미지와 컨테이너는 유지.
- apt 패키지 다운로드 캐시 정리.
- 하루 이상 지난 DAVAQ /tmp 배포 패키지와 해제 임시본 35개 정리. 컨테이너 마운트와 겹치는 경로 제외.
- 마운트·실행 프로세스가 없는 AnotherMe 과거 배포본의 재설치 가능한 node_modules 정리. 소스와 롤백 컨테이너 보존.
- 과거 DAVAQ 배포 폴더 42개 압축 보관 완료. 전체 컨테이너 마운트와 겹치는 폴더 및 최근 3개 후보를 제외. tar 원본 비교 검증 성공 후 원본 정리. 압축본 1,959,260,668 bytes.

압축 보관 위치: `/opt/davaq-backups/disk-cleanup-20261016/inactive-deployments.tar.gz`. root 소유, 0600. 폴더 목록은 같은 경로 manifest.txt에 기록.

중간 검증: 컨테이너 14개 실행 유지, DAVAQ·TCGIndex·AnotherMe 웹 HTTP 200 확인. 외부 TCGIndex 요청이 한 차례 타임아웃된 후 재확인에서 200 응답.

최종 루트 사용률 74%, 여유 32,587,800,576 bytes(약 30.35GiB, df -h 표기 31G). 작업 전 약 1GiB에서 약 30GiB 추가 확보. 운영 컨테이너 14개 실행 유지.

최종 HTTP 확인: DAVAQ 및 AnotherMe 외부 응답 200. TCGIndex 로컬 127.0.0.1:3100 응답 200. TCGIndex 외부 주소는 200 응답과 30초 타임아웃이 간헐적으로 관찰되어 외부 경로까지 지속 정상이라고 단정하지 않음. TCGIndex 프로세스나 라우팅 설정은 변경하지 않았다.

복구는 필요한 폴더만 `sudo tar -xzf /opt/davaq-backups/disk-cleanup-20261016/inactive-deployments.tar.gz -C /opt <manifest.txt에 있는 폴더명>`으로 수행할 수 있다. 현재 운영 경로로 덮어쓰지 말고 manifest에서 필요한 과거 배포 폴더를 선택한다.
