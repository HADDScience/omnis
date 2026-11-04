-- 지식재산권의 「단계」를 「상태」(도달한 지점) 5개와 「사건」(그 사이에 일어난 일)으로 나눈다.
-- 계획: mydocs/plans/2026-10-29-ip-status-and-event.md
--
-- 왜
--  옛 단계 12개에는 도달한 지점(출원·등록)과 그 사이의 사건(의견제출통지·보정서제출)이
--  섞여 있었다. 「심사중」이 어느 지점인지 알 수 없어 PT-10 에 우선심사신청을 기록하며
--  단계를 「심사중」으로 바꿨다가 「출원」으로 되돌린 일이 있었다(2026-10-29).
--
-- 무엇이 바뀌나
--  * ip.status_options — 상태 5개(출원전·출원·등록·거절·포기)만 남는다. 대장의 status 가 이 값이다.
--  * ip.event_options  — 옛 단계 값 전부와 새 사건. progress_entries.stage 가 여기를 가리킨다.
--    칸 이름은 stage 로 두었다 — 지금 돌고 있는 코드가 그 이름을 읽는다. 뜻은 「사건」이다.
--  * progress_entries.status — 이 기록이 상태를 어디로 옮겼는지(명시값). NULL 이면 사건의
--    moves_to 와 번호 자동 전환 규칙(ip.entry_status)에 맡긴다. 옛 기록은 옛 단계를 표대로 옮겨 채운다.
--  * opening_state.status — 출발선의 상태. stage(넘겨받을 때 적힌 옛 단계)는 그대로 둔다.
--
-- 옛 기록의 stage 값은 하나도 지우지 않는다. 이력이 그대로 「사건」으로 남는다.

-- ─── 1. 옛 단계에 걸린 외래키를 잠시 푼다 ─────────────────────────────

ALTER TABLE ip.trademarks       DROP CONSTRAINT trademarks_kind_status_fkey;
ALTER TABLE ip.patents          DROP CONSTRAINT patents_kind_status_fkey;
ALTER TABLE ip.progress_entries DROP CONSTRAINT progress_entries_entity_kind_stage_fkey;

-- ─── 2. 사건 ─────────────────────────────────────────────────────────

CREATE TABLE ip.event_options (
    kind              text    NOT NULL,
    value             text    NOT NULL,
    sort_order        integer NOT NULL,
    tone              text    NOT NULL DEFAULT 'neutral',
    -- 이 사건이 일어나면 상태가 여기로 옮겨 간다. NULL 이면 상태를 바꾸지 않는 사건이다.
    moves_to          text,
    -- 옛 단계였던 값이 어느 상태에 해당했는지. 옛 값으로 들어오는 호출을 번역할 때 쓴다.
    legacy_status     text,
    wants_app_no      boolean NOT NULL DEFAULT false,
    wants_reg_no      boolean NOT NULL DEFAULT false,
    wants_probability boolean NOT NULL DEFAULT false,
    wants_due         boolean NOT NULL DEFAULT false,
    selectable        boolean NOT NULL DEFAULT true,
    note              text    NOT NULL DEFAULT '',
    CONSTRAINT event_options_pkey PRIMARY KEY (kind, value),
    CONSTRAINT event_options_kind_check CHECK (kind = ANY (ARRAY['trademark','patent']))
);

INSERT INTO ip.event_options
  (kind, value, sort_order, tone, moves_to, legacy_status,
   wants_app_no, wants_reg_no, wants_probability, wants_due, selectable, note)
SELECT k.kind, e.value, e.sort_order, e.tone, e.moves_to, e.legacy_status,
       e.app, e.reg, e.prob, e.due, e.selectable, e.note
  FROM (VALUES ('trademark'), ('patent')) AS k(kind)
  CROSS JOIN (VALUES
    ('아이디어',     10, 'violet',  NULL,   '출원전', false, false, false, false, true,  '', NULL),
    ('검토요청',     20, 'sky',     NULL,   '출원전', false, false, false, false, true,  '', NULL),
    ('검토의견',     30, 'amber',   NULL,   '출원전', false, false, true,  false, true,  '', NULL),
    ('출원준비',     40, 'indigo',  NULL,   '출원전', false, false, false, false, true,  '', NULL),
    ('출원',         50, 'indigo',  '출원', '출원',   true,  false, false, false, true,  '출원번호가 생겼다(출원번호통지서). 이 기록의 날짜가 출원일이 된다', NULL),
    ('우선심사신청', 55, 'sky',     NULL,   NULL,     false, false, false, false, true,  '', NULL),
    ('심사청구',     57, 'sky',     NULL,   NULL,     false, false, false, false, true,  '', 'patent'),
    ('PCT출원',      58, 'sky',     NULL,   NULL,     false, false, false, false, true,  'PCT 국제출원 보고. 국내 건의 상태는 바꾸지 않는다', 'patent'),
    ('출원공고',     60, 'sky',     NULL,   '출원',   false, false, false, false, true,  '', NULL),
    ('의견제출통지', 70, 'red',     NULL,   '출원',   false, false, false, true,  true,  '대응 기한을 함께 적는다', NULL),
    ('보정서제출',   80, 'amber',   NULL,   '출원',   false, false, false, false, true,  '', NULL),
    ('심사중',       90, 'amber',   NULL,   '출원',   false, false, false, false, false, '옛 단계. 새 기록에는 쓰지 않는다', NULL),
    ('특허결정',     92, 'emerald', NULL,   NULL,     false, false, false, true,  true,  '등록번호가 나오기 전까지 상태는 출원이다. 등록료 납부 기한을 적는다', 'patent'),
    ('거절결정',     94, 'red',     NULL,   NULL,     false, false, false, true,  true,  '다투는 동안 상태는 출원이다. 불복 기한을 적는다', NULL),
    ('등록료납부',   96, 'sky',     NULL,   NULL,     false, false, false, false, true,  '', NULL),
    ('등록',        100, 'emerald', '등록', '등록',   false, true,  false, false, true,  '등록번호가 생겼다(설정등록). 이 기록의 날짜가 등록일이 된다', NULL),
    ('거절확정',    110, 'red',     '거절', '거절',   false, false, false, false, true,  '거절결정에 불복하지 않아 확정됐다', NULL),
    ('포기',        120, 'muted',   '포기', NULL,     false, false, false, false, true,  '출원 전 중단 · 취하 · 등록료 미납 소멸 · 다른 건으로 대체', NULL),
    ('포기·중단',   121, 'muted',   '포기', '포기',   false, false, false, false, false, '옛 단계. 새 기록에는 「포기」를 쓴다', NULL),
    ('값 정정',     130, 'muted',   NULL,   NULL,     false, false, false, false, false, '잘못 적혀 있던 값을 고친 기록', NULL)
  ) AS e(value, sort_order, tone, moves_to, legacy_status, app, reg, prob, due, selectable, note, only_kind)
 WHERE e.only_kind IS NULL OR e.only_kind = k.kind;

-- ─── 3. 기록·출발선에 상태를 붙인다 ───────────────────────────────────

ALTER TABLE ip.progress_entries ADD COLUMN status text;
ALTER TABLE ip.progress_entries ALTER COLUMN stage DROP NOT NULL;

-- 옛 기록은 그때 단계가 가리키던 상태를 명시값으로 갖는다. 그래야 재계산이 지금 대장을
-- 표대로 옮긴 결과와 같아진다. 트리거를 끄지 않으면 이 UPDATE 가 대장을 다시 쓴다.
ALTER TABLE ip.progress_entries DISABLE TRIGGER progress_entries_apply;
ALTER TABLE ip.progress_entries DISABLE TRIGGER progress_entries_touch;
UPDATE ip.progress_entries pe
   SET status = eo.legacy_status
  FROM ip.event_options eo
 WHERE eo.kind = pe.entity_kind AND eo.value = pe.stage;
ALTER TABLE ip.progress_entries ENABLE TRIGGER progress_entries_touch;
ALTER TABLE ip.progress_entries ENABLE TRIGGER progress_entries_apply;

ALTER TABLE ip.opening_state ADD COLUMN status text;
UPDATE ip.opening_state os
   SET status = eo.legacy_status
  FROM ip.event_options eo
 WHERE eo.kind = os.entity_kind AND eo.value = os.stage;
-- 옛 단계에 없던 값이 남아 있으면 여기서 멈춘다. 추측으로 채우지 않는다.
ALTER TABLE ip.opening_state ALTER COLUMN status SET NOT NULL;

-- ─── 4. 대장을 표대로 옮긴다 ─────────────────────────────────────────

UPDATE ip.trademarks t
   SET status = eo.legacy_status
  FROM ip.event_options eo
 WHERE eo.kind = 'trademark' AND eo.value = t.status;
UPDATE ip.patents p
   SET status = eo.legacy_status
  FROM ip.event_options eo
 WHERE eo.kind = 'patent' AND eo.value = p.status;

-- ─── 5. 상태 5개 ─────────────────────────────────────────────────────

DELETE FROM ip.status_options;
INSERT INTO ip.status_options (kind, value, sort_order, tone, is_open, selectable)
SELECT k.kind, s.value, s.sort_order, s.tone, s.is_open, true
  FROM (VALUES ('trademark'), ('patent')) AS k(kind)
  CROSS JOIN (VALUES
    ('출원전', 10, 'sky',     true),
    ('출원',   20, 'indigo',  true),
    ('등록',   30, 'emerald', false),
    ('거절',   40, 'red',     false),
    ('포기',   50, 'muted',   false)
  ) AS s(value, sort_order, tone, is_open);

-- ─── 6. 외래키 ───────────────────────────────────────────────────────

ALTER TABLE ip.trademarks ADD CONSTRAINT trademarks_kind_status_fkey
  FOREIGN KEY (kind, status) REFERENCES ip.status_options(kind, value);
ALTER TABLE ip.patents ADD CONSTRAINT patents_kind_status_fkey
  FOREIGN KEY (kind, status) REFERENCES ip.status_options(kind, value);
ALTER TABLE ip.progress_entries ADD CONSTRAINT progress_entries_entity_kind_status_fkey
  FOREIGN KEY (entity_kind, status) REFERENCES ip.status_options(kind, value);
ALTER TABLE ip.progress_entries ADD CONSTRAINT progress_entries_entity_kind_stage_fkey
  FOREIGN KEY (entity_kind, stage) REFERENCES ip.event_options(kind, value);
ALTER TABLE ip.opening_state ADD CONSTRAINT opening_state_entity_kind_status_fkey
  FOREIGN KEY (entity_kind, status) REFERENCES ip.status_options(kind, value);
ALTER TABLE ip.event_options ADD CONSTRAINT event_options_moves_to_fkey
  FOREIGN KEY (kind, moves_to) REFERENCES ip.status_options(kind, value);
ALTER TABLE ip.event_options ADD CONSTRAINT event_options_legacy_status_fkey
  FOREIGN KEY (kind, legacy_status) REFERENCES ip.status_options(kind, value);
-- 상태도 사건도 없는 기록은 아무 말도 하지 않는다.
ALTER TABLE ip.progress_entries ADD CONSTRAINT progress_entries_status_or_stage_check
  CHECK (status IS NOT NULL OR stage IS NOT NULL);

-- ─── 7. 함수 ─────────────────────────────────────────────────────────

-- 기록 한 줄이 상태를 어디로 옮기는가. NULL 이면 그대로 둔다.
-- apply_progress_entry 와 rebuild_ledger 가 같은 판단을 하도록 한 곳에 둔다.
--
--  1. 기록에 상태를 적었으면 그것.
--  2. 사건이 상태를 옮기는 것(출원·등록·거절확정·포기)이면 그 상태.
--  3. 등록번호가 처음 생겼으면 등록, 출원번호가 처음 생겼으면 출원.
--     번호 형식이 맞을 때만 — 「사건번호: PJC…」 같은 값이 출원번호 칸에 들어간 일이 있다.
--     이 전환은 출원일·등록일을 채우지 않는다. 메일 기록의 날짜는 출원일이 아니다
--     (2026-10-28 PT-05·06 출원일이 메일 날짜로 채워진 일과 같은 함정).
CREATE OR REPLACE FUNCTION ip.entry_status(
  p_kind text, p_status text, p_event text,
  p_cur_status text, p_cur_app text, p_cur_reg text,
  p_app text, p_reg text
) RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'ip', 'pg_catalog'
AS $function$
declare
  v text;
begin
  if p_status is not null then
    return p_status;
  end if;

  select moves_to into v from ip.event_options where kind = p_kind and value = p_event;
  if v is not null then
    return v;
  end if;

  if p_cur_reg is null and p_reg ~ '^\d{2}-\d{7}(\D|$)'
     and p_cur_status in ('출원전', '출원') then
    return '등록';
  end if;
  if p_cur_app is null and p_app ~ '^\d{2}-\d{4}-\d{7}'
     and p_cur_status = '출원전' then
    return '출원';
  end if;

  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION ip.apply_progress_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ip', 'pg_catalog'
AS $function$
declare
  newer boolean;
  -- 값 정정은 시계를 움직이지 않는다. 상태는 반영하되 날짜는 그대로 둔다.
  moves boolean := new.source <> 'edit';
  cur record;
  target text;
begin
  if new.entity_kind = 'trademark' then
    select t.status, t.ref_date, t.app_no, t.reg_no into cur from ip.trademarks t where t.id = new.entity_id;
  else
    select p.status, p.ref_date, p.app_no, p.reg_no into cur from ip.patents p where p.id = new.entity_id;
  end if;
  if not found then return new; end if;

  newer := coalesce(cur.ref_date, '1900-01-01'::date) <= new.occurred_on;
  target := ip.entry_status(new.entity_kind, new.status, new.stage,
                            cur.status, cur.app_no, cur.reg_no, new.app_no, new.reg_no);

  if new.entity_kind = 'trademark' then
    -- SET 의 오른쪽에서 status·ref_date 는 갱신 전 값이다. latch 조건이 그것을 본다.
    update ip.trademarks set
      status        = case when newer and target is not null then target else status end,
      ref_date      = case when newer and moves then new.occurred_on else ref_date end,
      name          = case when newer then coalesce(nullif(new.name, ''), name) else name end,
      holder        = case
                        when not newer then coalesce(holder, nullif(new.holder, ''))
                        when new.holder is null then holder
                        when new.holder = '' then null
                        else new.holder
                      end,
      app_no        = case
                        when not newer then coalesce(app_no, nullif(new.app_no, ''))
                        when new.app_no is null then app_no
                        when new.app_no = '' then null
                        else new.app_no
                      end,
      reg_no        = case
                        when not newer then coalesce(reg_no, nullif(new.reg_no, ''))
                        when new.reg_no is null then reg_no
                        when new.reg_no = '' then null
                        else new.reg_no
                      end,
      probability   = coalesce(new.probability, probability),
      -- 출원일·등록일은 「출원」·「등록」 사건에 들어간 기록의 날짜로만 채운다.
      -- 상태만 옮긴 기록(명시값·번호 자동 전환)은 날짜를 모른다.
      filed_on      = case
                        when new.filed_on = '' then null
                        when new.filed_on is not null then new.filed_on::date
                        when moves and new.stage = '출원'
                           and (status is distinct from '출원' or new.occurred_on <= coalesce(ref_date, new.occurred_on))
                          then coalesce(filed_on, new.occurred_on)
                        else filed_on
                      end,
      registered_on = case
                        when new.registered_on = '' then null
                        when new.registered_on is not null then new.registered_on::date
                        when moves and new.stage = '등록'
                           and (status is distinct from '등록' or new.occurred_on <= coalesce(ref_date, new.occurred_on))
                          then coalesce(registered_on, new.occurred_on)
                        else registered_on
                      end
    where id = new.entity_id;
  else
    update ip.patents set
      status        = case when newer and target is not null then target else status end,
      ref_date      = case when newer and moves then new.occurred_on else ref_date end,
      title         = case when newer then coalesce(nullif(new.name, ''), title) else title end,
      -- applicant 는 not null 이라 비우면 빈 문자열이 된다.
      applicant     = case
                        when not newer then coalesce(nullif(applicant, ''), new.holder, applicant)
                        when new.holder is null then applicant
                        else new.holder
                      end,
      app_no        = case
                        when not newer then coalesce(app_no, nullif(new.app_no, ''))
                        when new.app_no is null then app_no
                        when new.app_no = '' then null
                        else new.app_no
                      end,
      reg_no        = case
                        when not newer then coalesce(reg_no, nullif(new.reg_no, ''))
                        when new.reg_no is null then reg_no
                        when new.reg_no = '' then null
                        else new.reg_no
                      end,
      filed_on      = case
                        when new.filed_on = '' then null
                        when new.filed_on is not null then new.filed_on::date
                        when moves and new.stage = '출원'
                           and (status is distinct from '출원' or new.occurred_on <= coalesce(ref_date, new.occurred_on))
                          then coalesce(filed_on, new.occurred_on)
                        else filed_on
                      end,
      registered_on = case
                        when new.registered_on = '' then null
                        when new.registered_on is not null then new.registered_on::date
                        when moves and new.stage = '등록'
                           and (status is distinct from '등록' or new.occurred_on <= coalesce(ref_date, new.occurred_on))
                          then coalesce(registered_on, new.occurred_on)
                        else registered_on
                      end
    where id = new.entity_id;
  end if;

  return new;
end;
$function$;

-- 대장을 출발선부터 다시 계산한다. 위 규칙과 같은 규칙을 순서대로 되짚는다.
CREATE OR REPLACE FUNCTION ip.rebuild_ledger()
 RETURNS TABLE(kind text, id text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ip', 'pg_catalog'
AS $function$
declare
  o record;
  e record;
  v_status text;
  v_prev text;
  v_prev_ref date;
  v_target text;
  v_ref date;
  v_name text;
  v_holder text;
  v_app text;
  v_reg text;
  v_filed date;
  v_registered date;
  v_prob int;
  v_moves boolean;
  v_newer boolean;
begin
  for o in select * from ip.opening_state loop
    v_status := o.status;
    v_ref := o.ref_date;
    v_name := o.name;
    v_holder := o.holder;
    v_app := o.app_no;
    v_reg := o.reg_no;
    v_filed := o.filed_on;
    v_registered := o.registered_on;
    v_prob := o.probability;

    for e in
      select * from ip.progress_entries pe
       where pe.entity_kind = o.entity_kind
         and pe.entity_id = o.entity_id
       order by pe.occurred_on, pe.created_at
    loop
      v_moves := e.source <> 'edit';
      v_newer := coalesce(v_ref, date '1900-01-01') <= e.occurred_on;
      -- 이 기록 전의 상태와 기준일. latch 조건과 번호 자동 전환이 본다.
      v_prev := v_status;
      v_prev_ref := v_ref;
      v_target := ip.entry_status(o.entity_kind, e.status, e.stage,
                                  v_prev, v_app, v_reg, e.app_no, e.reg_no);

      if v_newer then
        if v_target is not null then
          v_status := v_target;
        end if;
        if v_moves then
          v_ref := e.occurred_on;
        end if;
        v_name := coalesce(nullif(e.name, ''), v_name);
        v_holder := case when e.holder is null then v_holder
                         when e.holder = '' then null
                         else e.holder end;
        v_app := case when e.app_no is null then v_app
                      when e.app_no = '' then null
                      else e.app_no end;
        v_reg := case when e.reg_no is null then v_reg
                      when e.reg_no = '' then null
                      else e.reg_no end;
      else
        v_holder := coalesce(v_holder, nullif(e.holder, ''));
        v_app := coalesce(v_app, nullif(e.app_no, ''));
        v_reg := coalesce(v_reg, nullif(e.reg_no, ''));
      end if;

      v_prob := coalesce(e.probability, v_prob);

      if e.filed_on = '' then
        v_filed := null;
      elsif e.filed_on is not null then
        v_filed := e.filed_on::date;
      elsif v_moves and e.stage = '출원'
            and (v_prev is distinct from '출원' or e.occurred_on <= coalesce(v_prev_ref, e.occurred_on)) then
        v_filed := coalesce(v_filed, e.occurred_on);
      end if;
      if e.registered_on = '' then
        v_registered := null;
      elsif e.registered_on is not null then
        v_registered := e.registered_on::date;
      elsif v_moves and e.stage = '등록'
            and (v_prev is distinct from '등록' or e.occurred_on <= coalesce(v_prev_ref, e.occurred_on)) then
        v_registered := coalesce(v_registered, e.occurred_on);
      end if;
    end loop;

    if o.entity_kind = 'trademark' then
      update ip.trademarks set
        status = v_status, ref_date = v_ref, name = v_name, holder = v_holder,
        app_no = v_app, reg_no = v_reg, filed_on = v_filed,
        registered_on = v_registered, probability = v_prob,
        note = o.note
      where ip.trademarks.id = o.entity_id;
    else
      update ip.patents set
        status = v_status, ref_date = v_ref, title = v_name,
        applicant = coalesce(v_holder, ''),
        app_no = v_app, reg_no = v_reg, filed_on = v_filed,
        registered_on = v_registered,
        note = o.note
      where ip.patents.id = o.entity_id;
    end if;

    kind := o.entity_kind;
    id := o.entity_id;
    return next;
  end loop;
end;
$function$;

-- 새 건. p_stage 에는 상태(출원전…)를 넣는다. 옛 단계 값(아이디어…)이 오면 표대로 상태로 옮기고,
-- 출발선의 stage 칸에는 받은 값을 그대로 남긴다.
CREATE OR REPLACE FUNCTION ip.create_case(p_kind text, p_name text, p_stage text, p_note text DEFAULT ''::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ip', 'pg_catalog'
AS $function$
declare
  v_prefix text;
  v_id     text;
  v_next   int;
  v_given  text := coalesce(nullif(btrim(p_stage), ''), '출원전');
  v_status text;
begin
  if p_kind not in ('trademark', 'patent') then
    raise exception '알 수 없는 부류입니다: %', p_kind;
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception '이름이 비어 있습니다.';
  end if;

  -- 상태는 반드시 정의된 것이어야 한다. 대장이 임의의 문자열을 갖게 두면
  -- 배지 색도 정렬 순서도 없는 유령 상태가 생긴다.
  select value into v_status from ip.status_options where kind = p_kind and value = v_given;
  if v_status is null then
    select legacy_status into v_status from ip.event_options
     where kind = p_kind and value = v_given;
  end if;
  if v_status is null then
    raise exception '% 에 없는 상태입니다: % (출원전·출원·등록·거절·포기 중 하나)', p_kind, v_given;
  end if;

  v_prefix := case when p_kind = 'trademark' then 'TM' else 'PT' end;

  -- 번호는 대장과 출발선 양쪽에서 가장 큰 것 다음. 지운 건이 있어도 번호를
  -- 되쓰지 않는다 — 옛 기록이 가리키던 번호가 다른 건이 되면 안 된다.
  select coalesce(max(n), 0) + 1 into v_next
    from (
      select (regexp_replace(id, '^[A-Z]+-', ''))::int as n
        from ip.trademarks where p_kind = 'trademark'
      union all
      select (regexp_replace(id, '^[A-Z]+-', ''))::int
        from ip.patents where p_kind = 'patent'
      union all
      select (regexp_replace(entity_id, '^[A-Z]+-', ''))::int
        from ip.opening_state where entity_kind = p_kind
    ) s;

  v_id := v_prefix || '-' || lpad(v_next::text, 2, '0');

  if p_kind = 'trademark' then
    insert into ip.trademarks (id, name, status, note)
    values (v_id, btrim(p_name), v_status, coalesce(p_note, ''));
  else
    insert into ip.patents (id, title, status, note)
    values (v_id, btrim(p_name), v_status, coalesce(p_note, ''));
  end if;

  insert into ip.opening_state (
    entity_kind, entity_id, stage, status, ref_date, name, taken_over_on, source_note
  ) values (
    p_kind, v_id, v_given, v_status, null, btrim(p_name), current_date,
    '이 자리에서 새로 만든 건입니다. 넘겨받은 것이 아니라 여기서 시작했습니다'
  );

  return v_id;
end;
$function$;
