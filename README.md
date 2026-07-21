# 타사 온라인 주문 확인

ABC마트 점포가 자기 매장의 `등록·출고` 미완료 주문만 조회하는 GitHub Pages 정적 웹앱입니다.

## 데이터 구조

- 점포마스터: 첫 시트의 `점코드`, `점명`, `지역명`
- 주문 원본: 첫 시트의 2단 병합 헤더 지원
- 점포 매칭: 주문 파일 C열 `매장명`과 점포마스터 `점명`
- 공개 대상: 진행상태가 `등록` 또는 `출고`인 행만 포함
- 주문번호가 없을 때: `등록일자 / 순번`을 대체 식별값으로 표시
- 로그인 비밀번호: `99` + 점포코드 4자리

## 데이터 갱신

PowerShell에서 아래 명령을 실행합니다.

```powershell
npm.cmd run generate:data -- "점포마스터.xlsx 전체 경로" "타사온라인_정산대상.xlsx 전체 경로"
npm.cmd run build
```

생성 결과는 `public/data`에 저장됩니다. `manifest.json`은 매장 목록과 버전을 담고, 실제 주문은 데이터가 있는 점포마다 `stores/<해시>.json`으로 나뉩니다. 화면은 로그인한 점포의 파일 하나만 요청합니다.

## 로컬 실행

```powershell
npm.cmd install
npm.cmd run dev
```

## GitHub Pages

`main` 브랜치에 푸시하면 `.github/workflows/deploy.yml`이 빌드하고 GitHub Pages에 배포합니다. `manifest.json`은 캐시하지 않고 매번 새 버전을 확인하며, 점포 파일명에는 원본 파일 해시가 포함되어 데이터 갱신 시 자동으로 캐시가 무효화됩니다.

> 이 비밀번호는 강한 보안이 아니라 단순 진입 확인용입니다. GitHub Pages 정적 파일은 서버 인증으로 보호되지 않습니다.
