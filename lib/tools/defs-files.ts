// 묶음 7(#248) — 파일 · NAS. 내가 볼 수 있는 최근 파일, 시놀로지 NAS 폴더 열람, NAS 파일을 옴니스 첨부로 잇기. 데이터만 둔다.
// 실행은 lib/tools/plan-files.ts. 권한은 화면과 같다(파일은 visibleFileWhere, NAS 는 HADD Science 공유폴더 안만).
import { CONFIRM_PROP } from "./planned"

export const FILE_TOOLS = [
  {
    name: "list_files",
    description: "내가 볼 수 있는 최근 첨부 파일 50개(최근 것부터) — 화면의 파일 고르기와 같다. 내용은 read_file 에 파일 ID.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "browse_nas",
    description: "사내 시놀로지 NAS(HADD Science 공유폴더)의 폴더를 열거나 파일 정보를 본다 — 화면의 NAS 와 같다. 파일 내용을 읽으려면 link_nas_file 로 첨부로 이은 뒤 read_file.",
    inputSchema: { type: "object", properties: { path: { type: "string", description: "NAS 경로 — 예: /HADD Science/... (윈도 Z:\\ 경로도 된다)" } }, required: ["path"] },
  },
  {
    name: "link_nas_file",
    description: "NAS 파일을 옴니스 첨부로 잇는다(복사하지 않는다) — 화면의 「NAS 파일 연결」 과 같다. 돌려받은 파일 ID 를 post_message 의 files 에 넣거나 read_file 로 읽는다. private=true 면 나만 보는 파일(단톡방 · 1:1 에 붙일 때).",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, private: { type: "boolean" }, confirm: CONFIRM_PROP },
      required: ["path"],
    },
  },
] as const

export const FILE_READ_NAMES = ["list_files", "browse_nas"] as const
export type FileReadName = (typeof FILE_READ_NAMES)[number]
export type FileWriteName = Exclude<(typeof FILE_TOOLS)[number]["name"], FileReadName>
