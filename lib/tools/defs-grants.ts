// 인증 · 국가과제 도구 정의(2026-11-25) — 화면 회사 정보 › 인증·가점, 아카이브 › 국가과제와 같은 일. 데이터만 둔다.
// 실행은 lib/tools/plan-grants.ts. 인증 조회(list_certifications)는 회사 도구(lib/omnis-mcp.ts)에 있다.
import { CONFIRM_PROP } from "./planned"

const TEXT = { type: "string" } as const
const YMD = {
  type: "string",
  description: "YYYY-MM-DD. 빈 문자열이면 지운다",
} as const
const STAGE = {
  type: "string",
  enum: ["REVIEW", "PREPARING", "SUBMITTED", "SELECTED", "REJECTED", "DROPPED"],
  description:
    "REVIEW 검토 · PREPARING 준비 · SUBMITTED 제출 · SELECTED 선정 · REJECTED 미선정 · DROPPED 불참",
} as const

export const GRANT_TOOLS = [
  // ─── 읽기 ───
  {
    name: "list_grant_decisions",
    description: [
      "국가과제 「우리 결정」 — 검토 · 준비 · 제출 · 선정 · 미선정 · 불참 단계, 담당자, 마감, 사유, 연결된 수집기 공고.",
      "「이번 달 마감 과제」「아리 박사님 담당 과제」「제출한 과제」 를 물으면 쓴다. 과제마다 NAS 폴더(신청서 · 제출 서류)와 이어진 공고의 첨부(공고문 · 양식)도 보인다. update_grant_decision 의 decision 을 여기서 고른다.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        stage: STAGE,
        owner: { type: "string", description: "담당자 정식 이름" },
        query: { type: "string", description: "과제명 일부" },
        due_within_days: {
          type: "integer",
          description: "오늘부터 이 날수 안에 마감인 것만(지난 것 제외)",
        },
      },
    },
  },
  {
    name: "search_grant_notices",
    description: [
      "과제 후보 — 수집기가 모은 지원사업 · R&D 공고(대표 공고)를 판정(해당 · 애매 · 비해당) · 마감 · 지역으로 찾는다.",
      "판정은 지금 사업자(개인) 기준이 기본이고 profile=corp 면 법인 기준이다. 「이번 달 마감 과제」「우리가 낼 만한 공고」 를 물으면 쓴다.",
      "공고마다 첨부(공고문 · 신청서 양식 — 이름 · 형식 · 크기 · 받는 곳)를 같이 준다. add_grant_decision 의 notice 를 여기서 고른다.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        verdict: {
          type: "string",
          enum: ["해당", "애매", "비해당"],
          description: "비우면 해당 · 애매",
        },
        deadline: {
          type: "string",
          enum: ["open", "week", "month", "all"],
          description:
            "open 접수 중(기본) · week 7일 안 · month 30일 안 · all 전체",
        },
        region: {
          type: "string",
          enum: ["national", "gyeonggi", "other"],
          description: "national 전국 · gyeonggi 경기 · other 그 밖",
        },
        query: { type: "string", description: "공고명 · 부처 · 기관 일부" },
        profile: {
          type: "string",
          enum: ["sole", "corp"],
          description:
            "판정 기준 — sole 지금(개인사업자, 기본) · corp 법인 전환 뒤",
        },
        limit: { type: "integer", description: "기본 30, 최대 100" },
      },
    },
  },
  // ─── 쓰기 ───
  {
    name: "update_certification",
    description:
      "인증 · 가점 한 줄을 고친다 — 상태(HELD 보유 · RENEWAL_DUE 갱신 필요 · EXPIRED 만료 · CANDIDATE 취득 후보 · NOT_ELIGIBLE 자격 안 됨) · 메모 · 취득일 · 유효기간. 준 칸만 바뀐다. 화면 회사 정보 › 인증·가점과 같다.",
    inputSchema: {
      type: "object",
      properties: {
        certification: {
          type: "string",
          description: "인증 id 또는 이름 일부(list_certifications)",
        },
        status: {
          type: "string",
          enum: ["HELD", "RENEWAL_DUE", "EXPIRED", "CANDIDATE", "NOT_ELIGIBLE"],
        },
        note: TEXT,
        acquired_on: YMD,
        valid_until: YMD,
        confirm: CONFIRM_PROP,
      },
      required: ["certification"],
    },
  },
  {
    name: "update_grant_decision",
    description: [
      "국가과제 결정 한 줄을 고친다 — 단계 · 사유 · 메모 · 마감 · 담당자 · 신청 업무 · 선정 과제 프로젝트. 준 칸만 바뀐다.",
      "owners 를 주면 담당자를 그 목록으로 바꾼다(정식 이름). task 는 업무 슬러그 또는 id, project 는 프로젝트 id 또는 이름, nas_folder 는 NAS 폴더 경로 — 빈 문자열이면 연결을 푼다.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        decision: {
          type: "string",
          description: "결정 id 또는 과제명 일부(list_grant_decisions)",
        },
        stage: STAGE,
        stage_reason: {
          type: "string",
          description: "불참 사유(자격 미달 · 접수 기간 지남) 등",
        },
        note: TEXT,
        deadline: YMD,
        owners: {
          type: "array",
          items: { type: "string" },
          description: "담당자 정식 이름 목록",
        },
        task: TEXT,
        project: TEXT,
        nas_folder: {
          type: "string",
          description:
            "NAS 「(2026) 예비 지원과제」 안의 이 과제 폴더 경로(/HADD Science/…, browse_nas 로 찾는다). 빈 문자열이면 연결을 푼다",
        },
        confirm: CONFIRM_PROP,
      },
      required: ["decision"],
    },
  },
  {
    name: "add_grant_decision",
    description:
      "과제 후보(공고)를 「우리 결정」 에 올린다 — 검토 단계로, 부른 사람이 담당. 같은 공고는 한 번만 올라간다. 화면 국가과제 › 과제 후보의 「올리기」 와 같다.",
    inputSchema: {
      type: "object",
      properties: {
        notice: {
          type: "string",
          description: "공고 id 또는 key(search_grant_notices)",
        },
        confirm: CONFIRM_PROP,
      },
      required: ["notice"],
    },
  },
] as const

export const GRANT_READ_NAMES = [
  "list_grant_decisions",
  "search_grant_notices",
] as const
export type GrantReadName = (typeof GRANT_READ_NAMES)[number]
export type GrantWriteName = Exclude<
  (typeof GRANT_TOOLS)[number]["name"],
  GrantReadName
>
