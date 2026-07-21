# 온라인 주문 예외관리 설계 리뷰

## 결론

이 시스템의 중심은 `orders` 조회 화면이 아니라 **스냅샷 동기화 + 상태 이력 + SLA 예외 케이스**입니다. 기존 점수 조회 페이지의 정적 배포와 지역 선택 UX는 재사용할 수 있지만, 브라우저에 복호화 키와 마스터 암호를 넣는 인증 구조는 재사용하면 안 됩니다. Supabase Auth로 사용자를 인증하고 RLS로 점포 범위를 DB에서 강제해야 합니다.

## 핵심 판단

### 주문번호 단독 Primary Key는 부적절

현재 원본에 `순번`이 있으므로 한 주문에 여러 상품 행이 있을 수 있습니다. 내부 PK는 UUID를 사용하고 `(source_system, order_no, line_no)`에 UNIQUE를 둡니다. 향후 API·크롤러가 추가되어도 source adapter만 교체할 수 있습니다.

### 데이터는 즉시 삭제하지 않음

엑셀에서 사라졌다는 사실은 완료나 삭제를 뜻하지 않을 수 있습니다. 조회조건 변경, 다운로드 실패, 부분 파일일 가능성이 있기 때문입니다.

1. 매 업로드를 `sync_batches`에 기록합니다.
2. 보인 행은 `last_seen_batch_id`, `last_seen_at`, `missing_streak=0`으로 갱신합니다.
3. 전국 전체 스냅샷에서만 미발견 행의 `missing_streak`을 올립니다.
4. 2회 연속 누락 후 `archived_at`을 설정하되 원본과 이력은 보존합니다.
5. `정산`은 누락 여부와 무관하게 예외 케이스만 자동 종료합니다.

### SLA는 주문 컬럼이 아니라 정책과 케이스로 분리

- 등록 상태: `registered_at + shipping_days` 초과 시 `shipping_delay`
- 출고 상태: `shipped_at + settlement_days` 초과 시 `settlement_delay`
- 정산 상태: 열려 있는 예외를 `resolved_at`으로 종료

정책은 `sla_policies`에 적용 시작일을 포함해 보관합니다. 정책 변경 시 과거 판단 근거가 사라지지 않습니다. 화면에서 매번 전체 주문을 계산하기보다 동기화 직후 RPC 또는 Edge Function이 `order_exceptions`를 갱신하는 편이 빠르고 감사 추적도 쉽습니다.

## 권장 데이터 흐름

```text
Excel/API/Crawler -> Source Adapter -> Validation/Staging -> Sync Service
                                                   |-> Orders upsert
                                                   |-> Status history
                                                   |-> Missing detection
                                                   `-> Exception engine
                                                            -> Dashboard/RLS
```

브라우저 SheetJS 업로드는 초기 MVP에 적절합니다. 다만 대용량 파일, 재시도, 원자성, 감사로그가 중요해지면 파일을 Storage에 올리고 Edge Function이 파싱·검증·트랜잭션 처리하도록 이동합니다. service_role 키는 브라우저에 두지 않습니다.

## 점포 액션

`확인 완료`와 `메모`는 MVP에 포함할 가치가 있습니다. 주문 원본을 수정하는 것이 아니라 예외에 대한 매장 대응 증적이기 때문입니다. `플랫폼 문의 완료`는 현재 플랫폼 구분이 없으므로 제외하고, 향후 `exception_actions(action_type, note, actor, created_at)` 형태로 일반화합니다. 공유 점포 계정보다 개인 계정/SSO가 도입되면 책임 추적이 정확해집니다.

## 폴더 구조

```text
src/
  app/                 # route/shell/providers
  features/auth/       # 점포·관리자 로그인
  features/orders/     # 조회, 필터, 상세
  features/sync/       # Excel adapter, 검증, 업로드
  features/exceptions/ # SLA 표시, 확인, 메모
  features/admin/      # 정책, 전국·지역 통계
  lib/supabase/        # client, generated DB types
  shared/              # 공통 UI와 유틸
supabase/
  migrations/          # 스키마/RLS/RPC
  functions/           # 대용량 동기화 단계에서 사용
```

현재 코드는 MVP 검증 속도를 위해 작게 유지하되, 기능이 늘면 위 단위로 이동합니다.

## 단계별 로드맵

### 0단계 — 데이터 검증 (1주)

- 실제 엑셀 3~5개로 주문번호+순번 중복, 날짜/시간 형식, 누락 패턴 확인
- 전국 파일과 부분 파일을 구분할 수 있는 운영 규칙 확정
- 등록/출고/정산 기준시점과 영업일 적용 여부 확정

### 1단계 — MVP (2~3주)

- Supabase Auth/RLS, 점포·관리자 화면
- SheetJS 검증 및 500행 단위 upsert
- 상태 이력, 등록/정산 지연, 동기화 배치 로그
- 점포 확인·메모, 관리자 SLA 정책 변경
- GitHub Pages 배포 및 운영 체크리스트

### 2단계 — 운영 안정화 (2~4주)

- Edge Function 트랜잭션 동기화, 파일 해시 중복 방지
- 2회 누락 soft archive와 복구 화면
- 오류행 다운로드, 재처리, 동기화 전후 대사
- 지역/점포 TOP10, 오늘 신규/종료, 감사로그

### 3단계 — 자동수집

- `source_system`별 adapter 계약 정의
- 인트라넷 API 우선, 불가할 때만 브라우저 자동화
- 스케줄러, 재시도, 알림, 수집 상태 모니터링
- 사내 SSO 및 개인별 권한으로 전환

## 배포 선택

GitHub Pages는 정적 React 앱과 Supabase 조합으로 MVP에 충분합니다. 다만 서버 측 Excel 처리, 비밀키가 필요한 인트라넷 연계, 프록시가 필요해지면 Vercel 또는 Supabase Edge Functions를 함께 사용해야 합니다. 저장소에는 원본 Excel·개인정보·service_role 키를 올리지 않습니다.

점포별 파일 분할, Private Storage, 생성 속도, cache busting, manifest 전환 전략은 [FILE_DISTRIBUTION.md](FILE_DISTRIBUTION.md)에 별도로 정리했습니다.
