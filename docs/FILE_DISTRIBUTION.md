# 점포별 데이터 파일 분할 설계

## 요약 결론

점포별 파일 분할은 **전국 데이터를 모든 브라우저에 내려보내지 않는 읽기 모델**로 적절합니다. 그러나 GitHub Pages의 공개 경로에 점포 파일을 두는 것만으로는 접근통제가 되지 않습니다. 파일명은 추측·공유될 수 있고 Git 이력에도 과거 데이터가 남습니다.

운영 권장안은 다음 두 가지입니다.

1. **권장: Hybrid** — Postgres를 원장/이력/전국 통계로 유지하고, 점포 조회용 스냅샷만 점포별로 생성해 Supabase Private Storage에 저장
2. **DB 최소화: File-first** — Postgres에는 사용자·점포·SLA·동기화·파일 manifest만 저장하고 주문 본문은 점포별 Private Storage 파일에만 저장

전국 현황, 상태 이력, 누락 판정, 동시 업로드 안정성이 필요하므로 실제 운영에서는 Hybrid가 더 단순하고 안전합니다. 주문 본문을 DB에 두지 않는 것이 절대 조건이면 File-first도 가능하지만 이전 점포 파일을 매번 읽어 diff해야 합니다.

## 기존 webdata.bin에서 가져올 점과 버릴 점

가져올 점:

- 정적 UI와 데이터 배포를 분리하는 구조
- 데이터 생성 파이프라인과 웹 조회 코드를 분리하는 운영 방식
- 앱 파일의 캐시 버전을 명시적으로 관리한 경험

버릴 점:

- 브라우저 JavaScript에 복호화 키·마스터 비밀번호 포함
- 모든 권한 범위의 데이터를 하나의 파일로 다운로드
- 고정 파일명에 `cache: no-store`만 적용하여 매번 전체 파일 재다운로드

브라우저에 포함된 비밀은 비밀이 아닙니다. PBKDF2/AES-GCM 자체가 강해도 키가 앱 코드에 있으면 권한 분리가 되지 않습니다.

## 권장 파일 포맷

초기에는 `JSON + gzip`을 권장합니다. 디버깅과 마이그레이션이 쉽고 브라우저의 `DecompressionStream` 또는 작은 라이브러리로 처리할 수 있습니다. MessagePack은 실제 측정에서 JSON 파싱이 병목일 때만 도입합니다. 임의 바이너리 포맷은 유지보수 비용이 큽니다.

```json
{
  "schemaVersion": 1,
  "storeCode": "S001",
  "syncBatchId": "uuid",
  "generatedAt": "2026-07-21T08:00:00Z",
  "slaPolicy": { "shippingDays": 2, "settlementDays": 5 },
  "summary": { "open": 13, "shippingDelay": 5, "settlementDelay": 8, "newToday": 2, "closedToday": 4 },
  "orders": []
}
```

파일명은 내용을 해시한 immutable 이름을 사용합니다.

```text
order-snapshots/{store_id}/orders.v1.{sha256앞12자리}.json.gz
```

`store_code`는 외부에 노출될 수 있는 업무 식별자이므로 Storage 경로에는 추측하기 어려운 `store_id` UUID를 권장합니다.

## manifest

최신 파일 위치를 고정 JSON 파일로 두기보다 RLS가 적용된 `store_snapshot_manifests` 테이블로 관리합니다.

```text
store_id, current_object_path, content_hash, byte_size, row_count,
schema_version, sync_batch_id, generated_at, previous_object_path
```

로그인 후 자기 점포 manifest 한 행만 읽고, Private Storage에서 JWT 인증 다운로드 또는 짧은 signed URL로 파일을 받습니다. Private bucket은 다운로드에도 RLS가 적용됩니다.

## 생성 파이프라인

```text
Excel 선택
  -> SheetJS 파싱/헤더 검증
  -> 주문번호+순번 중복 제거
  -> 점포별 Map 그룹화 O(n)
  -> 이전 manifest/hash와 비교
  -> 변경 점포만 JSON 직렬화 + gzip(Web Worker)
  -> 새 immutable object 업로드
  -> manifest 일괄 전환
  -> sync batch 완료
  -> 보존기간 후 이전 object 삭제
```

속도를 위해 다음을 적용합니다.

- SheetJS 파싱과 압축은 Web Worker에서 수행해 화면 멈춤 방지
- 점포 파일 생성은 CPU 병렬도 2~4개, 업로드는 동시 4~6개로 제한
- canonical JSON의 SHA-256이 이전 hash와 같으면 생성·업로드 생략
- 점포별 summary를 파일 상단에 미리 계산해 첫 화면에서 전체 주문을 다시 집계하지 않음
- 50,000행 같은 목표 샘플로 파싱/그룹/압축/업로드 시간을 각각 측정하고 운영 기준 설정

행 전체를 여러 번 순회하지 않는다면 분할 자체는 O(n)입니다. 실제 병목은 일반적으로 Excel 파싱, JSON 직렬화, 네트워크 업로드이므로 숫자를 가정하기보다 실제 전국 파일로 벤치마크해야 합니다.

## 업데이트와 원자성

새 파일을 같은 이름으로 덮어쓰지 않습니다. 모든 변경 점포의 새 파일 업로드가 성공한 뒤 manifest를 한 트랜잭션에서 전환합니다. 중간 실패 시 기존 manifest는 그대로이므로 점포는 이전 정상 버전을 계속 봅니다.

- 동기화 시작: `processing`
- 변경 파일 upload
- 검증: storeCode, schemaVersion, rowCount, hash
- manifest 전환: `current -> previous`, `new -> current`
- 동기화 완료: `completed`
- 이전 버전: 7~30일 보존 후 정리

전국 Excel에서 사라진 주문은 즉시 삭제하지 않고 파일 metadata에 `missingStreak`을 유지합니다. 전국 전체 스냅샷에서 2회 연속 누락된 경우에만 archive 처리합니다. 부분 파일 업로드에서는 누락 판정을 하지 않습니다.

## 캐시 무효화

Vite 앱 자산과 주문 데이터를 별도로 다룹니다.

| 대상 | 이름/키 | 캐시 정책 | 갱신 방법 |
|---|---|---|---|
| JS/CSS | Vite content hash | 1년 immutable | 새 배포 시 HTML이 새 hash 참조 |
| manifest | DB 행 | no-store 또는 짧은 TTL | 로그인/새로고침 때 version 확인 |
| 점포 snapshot | content hash 파일명 | 1년 immutable | manifest만 새 object로 전환 |
| 브라우저 로컬 | `storeId + contentHash` | IndexedDB | hash가 같으면 재사용, 과거 1개만 보존 |

쿼리 문자열 `?v=날짜`보다 content hash 파일명이 확실합니다. 앱은 로그인할 때 manifest의 hash를 확인하고 로컬 IndexedDB와 같으면 다운로드하지 않습니다. 인증 응답과 signed URL은 Service Worker에 캐시하지 않습니다.

## GitHub Pages 배포 검토

GitHub Pages에는 React 정적 앱만 배포하고 데이터 파일은 저장소와 Pages artifact에서 제외해야 합니다. GitHub는 생성 파일을 Git 바깥 object storage에 두도록 권장하며, Pages 공개 사이트와 저장소 크기에도 제한이 있습니다. 또한 Pages는 민감한 거래/비밀번호 처리 용도로 권장되지 않으므로 실제 사내 운영은 Vercel 또는 사내 정적 호스팅도 함께 검토해야 합니다.

GitHub Actions는 앱 코드만 빌드합니다. 데이터 동기화는 관리자 브라우저 또는 별도 Edge Function이 Supabase Storage에 직접 반영하므로 매일 데이터 때문에 Pages를 재배포할 필요가 없습니다.

## File-first의 한계

- 본부 전국 TOP10/지역 통계는 모든 점포 파일을 다시 읽어야 하므로 별도 `hq-summary` 파일이 필요
- 상태 이력과 soft delete 판정을 위해 이전 파일 로드가 필요
- 두 관리자가 동시에 업로드할 때 manifest 낙관적 잠금 필요
- 점포 메모/확인 완료처럼 쓰기 데이터는 결국 DB 또는 별도 action API가 필요
- 파일 하나가 커지면 작은 변경에도 전체 파일을 다시 받음

따라서 파일은 **점포 조회용 materialized read model**로 쓰고, 동기화·이력·액션은 DB에 남기는 Hybrid가 가장 균형이 좋습니다.

## 공식 참고자료

- GitHub Pages limits: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- GitHub repository limits: https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits
- Supabase private buckets: https://supabase.com/docs/guides/storage/buckets/fundamentals
- Supabase Storage access control: https://supabase.com/docs/guides/storage/security/access-control
