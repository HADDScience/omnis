-- 지식재산권 건의 이미지(상표 도안 · 로고 · 시안, 특허 대표 도면) — 2026-11-11. 표 추가만, 빈 표로 시작한다.
-- 실물은 기존 첨부(public."File" · NAS/R2)를 그대로 쓰고, 여기는 「어느 건의 어떤 이미지인가」 만 둔다.
-- 건 표(trademarks · patents)에 외래키를 걸지 않는다 — 건 삭제는 「되돌리기」(audit_log)로 되살릴 수 있어
-- 이미지 연결이 같이 지워지면 되살린 건에 이미지가 없다. 화면은 건이 있는 것만 그린다.

CREATE TABLE ip.case_images (
    id          uuid        NOT NULL DEFAULT gen_random_uuid(),
    entity_kind text        NOT NULL,
    entity_id   text        NOT NULL,
    file_id     text        NOT NULL,
    memo        text        NOT NULL DEFAULT '',
    taken_on    date,
    is_primary  boolean     NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  text,
    CONSTRAINT case_images_pkey PRIMARY KEY (id),
    CONSTRAINT case_images_kind_check CHECK (entity_kind IN ('trademark', 'patent')),
    CONSTRAINT case_images_file_fkey FOREIGN KEY (file_id) REFERENCES public."File"(id) ON DELETE CASCADE,
    CONSTRAINT case_images_created_by_fkey FOREIGN KEY (created_by) REFERENCES public."User"(id) ON DELETE SET NULL
);

CREATE INDEX case_images_entity_idx ON ip.case_images (entity_kind, entity_id, created_at);
-- 대표 이미지는 건마다 하나
CREATE UNIQUE INDEX case_images_one_primary ON ip.case_images (entity_kind, entity_id) WHERE is_primary;
-- 같은 파일을 같은 건에 두 번 걸지 않는다
CREATE UNIQUE INDEX case_images_entity_file_key ON ip.case_images (entity_kind, entity_id, file_id);
