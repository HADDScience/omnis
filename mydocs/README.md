---
kind: canonical
status: active
canonical: mydocs/README.md
last_verified: 2026-09-04
---

# mydocs — 이 저장소의 문서 규약

사람과 AI 가 같은 문서를 읽고 같은 결론에 닿게 하려고 둔 규약이다.
[edwardkim/rhwp 의 mydocs](https://github.com/edwardkim/rhwp/tree/main/mydocs) 방식을 따랐다.

## 왜 이렇게 두는가

AI 와 함께 일할 때 가장 비싼 실수는 **없는 사실을 지어내는 것**이 아니라
**낡은 사실을 그대로 믿는 것**이다. 반년 전 결정이 적힌 문서와 지난주에 뒤집힌
결정이 적힌 문서가 나란히 있으면, 어느 쪽이 지금 유효한지 알 방법이 없다.
그래서 모든 문서가 자기 역할(`kind`)과 생존 상태(`status`)를 스스로 선언한다.

목차 파일을 따로 두지 않는 이유도 같다. 목차는 반드시 실제와 어긋나고,
어긋난 목차는 없는 것보다 나쁘다.

## frontmatter

`mydocs/` 아래 모든 마크다운은 다음 네 칸을 갖는다.

| 칸 | 뜻 | 값 |
|---|---|---|
| `kind` | 이 문서의 역할 | `canonical` `guide` `reference` `investigation` `decision` `snapshot` `memory` |
| `status` | 지금도 유효한가 | `active` `historical` `superseded` |
| `canonical` | 이 문서가 따르는 권위 문서의 경로 | 저장소 기준 상대경로 (자기 자신이 권위면 자기 경로) |
| `last_verified` | 위 세 칸과 본문의 사실이 맞는지 마지막으로 확인한 날 | `YYYY-MM-DD` |

`kind` 고르는 법:

- `canonical` — 이 주제의 최종 권위. 충돌하면 이쪽이 이긴다.
- `guide` — 절차. "이렇게 하라".
- `reference` — 값·표·목록. 판단이 없는 사실.
- `investigation` — 조사 중. 결론이 아직 없다.
- `decision` — 무엇을 왜 골랐는지. 뒤집히면 `superseded`.
- `snapshot` — 특정 시점의 상태. 낡는 것이 정상.
- `memory` — 지난 피드백·맥락.

## 디렉터리

지속되는 문서 — 이 저장소의 지식:

| 경로 | 담는 것 |
|---|---|
| `mydocs/tech/` | 구조와 계약. "무엇이 어떻게 생겼는가" |
| `mydocs/troubleshootings/` | 걸렸던 문제와 푼 방법. "왜 이렇게 됐는가" |
| `mydocs/manual/` | 절차. "무엇을 어떤 순서로" |

타스크 사이클이 만드는 문서 — 흐르는 기록
([`AGENTS.md`](../AGENTS.md) 의 "타스크 사이클"):

| 경로 | kind | 담는 것 |
|---|---|---|
| `mydocs/orders/{yyyymmdd}.md` | snapshot | 그날 할 일과 상태 |
| `mydocs/plans/` | decision | 수행 계획서. 끝나면 `plans/archives/` 로 |
| `mydocs/working/` | snapshot | 단계별·최종 결과와 실측 출력 |
| `mydocs/feedback/` | memory | 사람이 쓴 피드백. AI 가 채우지 않는다 |

## 규칙

1. **문서를 옮기는 커밋은 옮기기만 한다.** 내용 수정과 섞으면 무엇이 바뀐 건지 보이지 않는다.
2. **뒤집힌 결정은 지우지 않는다.** `status: superseded` 로 바꾸고 `canonical` 을 새 문서로 돌린다.
   지워 버리면 "왜 그때 그렇게 했나"를 다시 물을 때 답할 것이 없다.
3. **`last_verified` 는 읽었다고 갱신하지 않는다.** 본문의 사실을 실제로 확인했을 때만 올린다.
4. **본문에는 판단의 근거를 적는다.** 무엇을 했는지는 git 이 안다. 문서가 할 일은 왜 그랬는지다.

## 지금 있는 문서

| 경로 | kind | 무엇 |
|---|---|---|
| [tech/auth-architecture.md](tech/auth-architecture.md) | canonical | 사내 도구 인증 구조 — Omnis 가 발급자 |
| [tech/ip-schema.md](tech/ip-schema.md) | canonical | 지식재산권 스키마와 그 안의 도메인 규칙 |
| [troubleshootings/supabase-limits.md](troubleshootings/supabase-limits.md) | canonical | Supabase 에서 무엇이 막혔고 어떻게 풀었나 |
| [troubleshootings/migration-traps.md](troubleshootings/migration-traps.md) | reference | 이 작업에서 실제로 밟은 함정들 |
| [troubleshootings/client-error-visibility.md](troubleshootings/client-error-visibility.md) | canonical | 화면이 흰 채로 죽는데 아무도 모르던 문제와 그 배관 |
| [tech/stack-and-conventions.md](tech/stack-and-conventions.md) | canonical | 스택·base-vega 관례·Gemini 함정 |
| [manual/ai-pairing.md](manual/ai-pairing.md) | guide | AI 와 함께 이 저장소에서 일하는 법 |
| [manual/ux-rules.md](manual/ux-rules.md) | canonical | UI·구조 규칙 11~30 · viewport 책임 표 · 데모 환경 |
| [manual/hyper-waterfall.md](manual/hyper-waterfall.md) | decision | 이 저장소가 AI 와 일하는 방식 |

작업 규약 자체는 저장소 루트의 [`AGENTS.md`](../AGENTS.md) 가 정본이다 —
`mydocs/` 아래가 아니라 루트에 두는 이유는, 저장소를 처음 여는 도구가
루트부터 읽기 때문이다.
