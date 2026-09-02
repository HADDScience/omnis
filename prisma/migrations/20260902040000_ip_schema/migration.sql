-- 지식재산권(ip-platform) 스키마를 Supabase 에서 Omnis DB 로 옮긴다.
--
-- 왜 옮기나: ip-platform 은 Supabase Auth 로 로그인하고 RLS 로 권한을 걸었다.
-- 사내 로그인을 Omnis 자체계정으로 모으면 그 RLS 가 설 자리가 없다. Supabase 의
-- 서드파티 인증은 Clerk·Firebase·Auth0·Cognito·WorkOS 로 한정돼 Omnis 를 발급자로
-- 끼워 넣을 수 없기 때문이다.
--
-- 왜 그대로 옮기나: 이 스키마의 값어치는 표가 아니라 plpgsql 에 있다.
-- apply_progress_entry 는 "더 최신 기록만 시계를 움직인다", "값 정정(edit)은 단계만
-- 반영하고 날짜는 두다", "빈 문자열은 지우기이고 NULL 은 그대로 두기" 같은 규칙으로
-- 출원일·등록일을 정한다. 법정 기한이 걸린 계산이라 TypeScript 로 옮겨 적으면
-- 바로 그 자리에서 사고가 난다. 그래서 함수 본문은 한 글자도 바꾸지 않았다.
--
-- 무엇만 바뀌었나: auth.uid() → ip.current_actor(). 그게 전부다.
--   - 사용자 참조 컬럼은 uuid 에서 text 로 바뀐다 (Omnis User.id 가 text 다)
--   - RLS 와 그 보조 함수(is_member/can_write/is_owner)는 뺀다.
--     권한은 이제 Omnis API 가 세션을 보고 판단한다 — Prisma 는 소유자로 접속하므로
--     RLS 를 켜 둬도 어차피 통과한다. 있는 척하는 방어막은 두지 않는다.
--   - 셀프 가입(access_requests)과 사전 허용 목록(allowed_emails)은 옮기지 않는다.
--     계정을 관리자가 만드는 Omnis 계정 하나로 모았으므로, 누구인지 확인하는 절차가
--     계정 발급 시점으로 앞당겨졌다.
--
-- 아직 안 옮긴 것: oauth_* 와 mcp_tokens, mcp_guide_reads.
-- 이들은 Supabase 엣지 함수(ip-mcp)가 쓰는 표다. 함수와 표를 따로 옮기면 한쪽만
-- 살아 있는 상태가 되므로 그 둘은 같이 옮겨야 한다. 별도 단계로 남긴다.

CREATE SCHEMA IF NOT EXISTS ip;

-- ─── 현재 사용자 ─────────────────────────────────────────────────────
--
-- auth.uid() 를 대신한다. Omnis API 가 요청마다 트랜잭션 안에서
--   SELECT set_config('app.user_id', $1, true)
-- 로 심어 두면, 트리거가 그걸 읽어 감사 기록의 주체를 남긴다.
--
-- 두 번째 인자 true 는 "설정이 없으면 오류 대신 NULL" 이라는 뜻이다.
-- 심지 않고 들어오는 경로(수동 SQL, 배치)에서도 쓰기가 막히면 안 된다 —
-- 그때는 주체를 모르는 채로 기록될 뿐이고, 그건 예전 Supabase 에서도 같았다.
CREATE OR REPLACE FUNCTION ip.current_actor() RETURNS text
  LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$;

-- ─── 표 ──────────────────────────────────────────────────────────────

CREATE TABLE ip.status_options (
    kind              text    NOT NULL,
    value             text    NOT NULL,
    sort_order        integer NOT NULL,
    tone              text    NOT NULL DEFAULT 'neutral',
    is_open           boolean NOT NULL DEFAULT true,
    wants_app_no      boolean NOT NULL DEFAULT false,
    wants_reg_no      boolean NOT NULL DEFAULT false,
    wants_probability boolean NOT NULL DEFAULT false,
    wants_due         boolean NOT NULL DEFAULT false,
    selectable        boolean NOT NULL DEFAULT true,
    CONSTRAINT status_options_pkey PRIMARY KEY (kind, value),
    CONSTRAINT status_options_kind_check CHECK (kind = ANY (ARRAY['trademark','patent']))
);

CREATE TABLE ip.members (
    user_id      text NOT NULL,
    email        text NOT NULL,
    display_name text,
    role         text NOT NULL DEFAULT 'editor',
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT members_pkey PRIMARY KEY (user_id),
    CONSTRAINT members_email_key UNIQUE (email),
    CONSTRAINT members_role_check CHECK (role = ANY (ARRAY['owner','editor','viewer'])),
    CONSTRAINT members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."User"(id) ON DELETE CASCADE
);

CREATE TABLE ip.trademarks (
    id            text NOT NULL,
    name          text NOT NULL,
    name_ko       text NOT NULL DEFAULT '',
    classes       text[] NOT NULL DEFAULT '{}',
    goods         text,
    app_no        text,
    reg_no        text,
    ref_date      date,
    filed_on      date,
    registered_on date,
    holder        text,
    status        text NOT NULL,
    probability   integer,
    note          text NOT NULL DEFAULT '',
    kind          text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    updated_by    text,
    CONSTRAINT trademarks_pkey PRIMARY KEY (id),
    CONSTRAINT trademarks_probability_check CHECK (probability >= 0 AND probability <= 100),
    CONSTRAINT trademarks_kind_status_fkey FOREIGN KEY (kind, status) REFERENCES ip.status_options(kind, value),
    CONSTRAINT trademarks_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public."User"(id) ON DELETE SET NULL
);

CREATE TABLE ip.patents (
    id            text NOT NULL,
    title         text NOT NULL,
    app_no        text,
    reg_no        text,
    ref_date      date,
    applicant     text NOT NULL DEFAULT '',
    status        text NOT NULL,
    note          text NOT NULL DEFAULT '',
    kind          text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    updated_by    text,
    filed_on      date,
    registered_on date,
    CONSTRAINT patents_pkey PRIMARY KEY (id),
    CONSTRAINT patents_kind_status_fkey FOREIGN KEY (kind, status) REFERENCES ip.status_options(kind, value),
    CONSTRAINT patents_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public."User"(id) ON DELETE SET NULL
);

CREATE TABLE ip.progress_entries (
    id          uuid NOT NULL DEFAULT gen_random_uuid(),
    occurred_on date NOT NULL,
    entity_kind text NOT NULL,
    entity_id   text NOT NULL,
    stage       text NOT NULL,
    direction   text,
    counterpart text NOT NULL DEFAULT '',
    next_turn   text NOT NULL DEFAULT 'none',
    due_on      date,
    app_no      text,
    reg_no      text,
    probability integer,
    note        text NOT NULL DEFAULT '',
    source      text NOT NULL DEFAULT 'manual',
    raw         text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  text,
    name        text,
    holder      text,
    CONSTRAINT progress_entries_pkey PRIMARY KEY (id),
    CONSTRAINT progress_entries_direction_check CHECK (direction = ANY (ARRAY['송신','수신'])),
    CONSTRAINT progress_entries_entity_kind_check CHECK (entity_kind = ANY (ARRAY['trademark','patent'])),
    CONSTRAINT progress_entries_next_turn_check CHECK (next_turn = ANY (ARRAY['us','firm','none'])),
    CONSTRAINT progress_entries_probability_check CHECK (probability >= 0 AND probability <= 100),
    CONSTRAINT progress_entries_source_check CHECK (source = ANY (ARRAY['manual','mail','excel','edit'])),
    CONSTRAINT progress_entries_entity_kind_stage_fkey FOREIGN KEY (entity_kind, stage) REFERENCES ip.status_options(kind, value),
    CONSTRAINT progress_entries_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public."User"(id) ON DELETE SET NULL
);

CREATE TABLE ip.communications (
    id               uuid NOT NULL DEFAULT gen_random_uuid(),
    occurred_on      date NOT NULL,
    direction        text NOT NULL,
    from_name        text NOT NULL,
    to_name          text NOT NULL,
    target           text NOT NULL,
    subject          text NOT NULL,
    body             text NOT NULL DEFAULT '',
    attachments      text[] NOT NULL DEFAULT '{}',
    follow_up        text NOT NULL DEFAULT '',
    is_open          boolean NOT NULL DEFAULT false,
    gmail_thread_id  text,
    gmail_message_id text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    updated_by       text,
    CONSTRAINT communications_pkey PRIMARY KEY (id),
    CONSTRAINT communications_direction_check CHECK (direction = ANY (ARRAY['발신','수신'])),
    CONSTRAINT communications_target_check CHECK (target = ANY (ARRAY['상표','특허','관리'])),
    CONSTRAINT communications_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public."User"(id) ON DELETE SET NULL
);

CREATE TABLE ip.communication_links (
    communication_id uuid NOT NULL,
    entity_kind      text NOT NULL,
    entity_id        text NOT NULL,
    CONSTRAINT communication_links_pkey PRIMARY KEY (communication_id, entity_kind, entity_id),
    CONSTRAINT communication_links_entity_kind_check CHECK (entity_kind = ANY (ARRAY['trademark','patent'])),
    CONSTRAINT communication_links_communication_id_fkey FOREIGN KEY (communication_id) REFERENCES ip.communications(id) ON DELETE CASCADE
);

CREATE TABLE ip.actions (
    id           text NOT NULL,
    target       text NOT NULL,
    subject      text NOT NULL,
    requested_at date,
    requester    text,
    todo         text NOT NULL,
    owner_name   text NOT NULL DEFAULT '',
    priority     text NOT NULL,
    note         text NOT NULL DEFAULT '',
    state        text NOT NULL DEFAULT 'open',
    resolution   text,
    resolved_at  timestamptz,
    resolved_by  text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    updated_by   text,
    CONSTRAINT actions_pkey PRIMARY KEY (id),
    CONSTRAINT actions_priority_check CHECK (priority = ANY (ARRAY['높음','보통','낮음'])),
    CONSTRAINT actions_state_check CHECK (state = ANY (ARRAY['open','done','dropped'])),
    CONSTRAINT actions_target_check CHECK (target = ANY (ARRAY['상표','특허','관리'])),
    CONSTRAINT actions_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public."User"(id) ON DELETE SET NULL,
    CONSTRAINT actions_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public."User"(id) ON DELETE SET NULL
);

CREATE TABLE ip.integrity_flags (
    id          uuid NOT NULL DEFAULT gen_random_uuid(),
    entity_kind text NOT NULL,
    entity_id   text,
    message     text NOT NULL,
    source      text NOT NULL DEFAULT 'note',
    state       text NOT NULL DEFAULT 'open',
    resolution  text,
    resolved_at timestamptz,
    resolved_by text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT integrity_flags_pkey PRIMARY KEY (id),
    CONSTRAINT integrity_flags_entity_kind_check CHECK (entity_kind = ANY (ARRAY['trademark','patent','action','general'])),
    CONSTRAINT integrity_flags_source_check CHECK (source = ANY (ARRAY['note','detector','manual'])),
    CONSTRAINT integrity_flags_state_check CHECK (state = ANY (ARRAY['open','resolved','dismissed'])),
    CONSTRAINT integrity_flags_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public."User"(id) ON DELETE SET NULL
);

-- 권리를 넘겨받은 시점의 상태. 대장을 처음부터 다시 계산할 때의 출발선이라
-- (rebuild_ledger) 진행 기록이 아무리 쌓여도 이 표는 갱신하지 않는다.
CREATE TABLE ip.opening_state (
    entity_kind   text NOT NULL,
    entity_id     text NOT NULL,
    stage         text NOT NULL,
    ref_date      date,
    name          text NOT NULL,
    holder        text,
    app_no        text,
    reg_no        text,
    filed_on      date,
    registered_on date,
    probability   integer,
    name_ko       text NOT NULL DEFAULT '',
    classes       text[] NOT NULL DEFAULT '{}',
    goods         text,
    note          text NOT NULL DEFAULT '',
    taken_over_on date NOT NULL DEFAULT CURRENT_DATE,
    source_note   text NOT NULL DEFAULT '',
    CONSTRAINT opening_state_pkey PRIMARY KEY (entity_kind, entity_id),
    CONSTRAINT opening_state_entity_kind_check CHECK (entity_kind = ANY (ARRAY['trademark','patent']))
);

CREATE TABLE ip.org_meta (
    id         integer NOT NULL DEFAULT 1,
    org        text NOT NULL,
    owner_name text NOT NULL,
    firm       jsonb NOT NULL DEFAULT '{}',
    note       text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT org_meta_pkey PRIMARY KEY (id),
    CONSTRAINT org_meta_id_check CHECK (id = 1)
);

CREATE TABLE ip.audit_log (
    id          bigserial NOT NULL,
    at          timestamptz NOT NULL DEFAULT now(),
    actor       text,
    actor_email text,
    op          text NOT NULL,
    entity      text NOT NULL,
    entity_id   text NOT NULL,
    before      jsonb,
    after       jsonb,
    CONSTRAINT audit_log_pkey PRIMARY KEY (id),
    CONSTRAINT audit_log_op_check CHECK (op = ANY (ARRAY['insert','update','delete'])),
    CONSTRAINT audit_log_actor_fkey FOREIGN KEY (actor) REFERENCES public."User"(id) ON DELETE SET NULL
);

CREATE TABLE ip.member_prefs (
    user_id          text NOT NULL,
    stage_order      jsonb NOT NULL DEFAULT '{}',
    updated_at       timestamptz NOT NULL DEFAULT now(),
    tutorial_seen_at timestamptz,
    CONSTRAINT member_prefs_pkey PRIMARY KEY (user_id),
    CONSTRAINT member_prefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."User"(id) ON DELETE CASCADE
);

-- ─── 인덱스 ──────────────────────────────────────────────────────────

CREATE INDEX actions_state_idx ON ip.actions USING btree (state);
CREATE INDEX audit_log_at_idx ON ip.audit_log USING btree (at DESC);
CREATE INDEX audit_log_entity_idx ON ip.audit_log USING btree (entity, entity_id, at DESC);
CREATE INDEX communication_links_entity_idx ON ip.communication_links USING btree (entity_kind, entity_id);
CREATE UNIQUE INDEX communications_gmail_message_idx ON ip.communications USING btree (gmail_message_id) WHERE (gmail_message_id IS NOT NULL);
CREATE INDEX communications_occurred_on_idx ON ip.communications USING btree (occurred_on DESC);
CREATE INDEX communications_open_idx ON ip.communications USING btree (is_open) WHERE is_open;
CREATE INDEX integrity_flags_state_idx ON ip.integrity_flags USING btree (state);
CREATE INDEX patents_app_no_idx ON ip.patents USING btree (app_no) WHERE (app_no IS NOT NULL);
CREATE INDEX progress_entries_date_idx ON ip.progress_entries USING btree (occurred_on DESC);
CREATE INDEX progress_entries_entity_idx ON ip.progress_entries USING btree (entity_kind, entity_id, occurred_on DESC);
CREATE INDEX progress_entries_turn_idx ON ip.progress_entries USING btree (next_turn) WHERE (next_turn <> 'none');

-- ─── 함수 ────────────────────────────────────────────────────────────
--
-- 아래 세 함수는 Supabase 에 있던 본문 그대로다. auth.uid() 자리만
-- ip.current_actor() 로 바뀌었고, 그 밖에는 공백 하나 손대지 않았다.

CREATE OR REPLACE FUNCTION ip.touch_row()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  new.updated_by := ip.current_actor();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION ip.write_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ip', 'pg_catalog'
AS $function$
declare
  actor_mail text;
  rec_id     text;
begin
  select m.email into actor_mail from ip.members m where m.user_id = ip.current_actor();

  if tg_op = 'DELETE' then
    rec_id := (to_jsonb(old) ->> 'id');
    insert into ip.audit_log (actor, actor_email, op, entity, entity_id, before, after)
    values (ip.current_actor(), actor_mail, 'delete', tg_table_name, rec_id, to_jsonb(old), null);
    return old;
  end if;

  rec_id := (to_jsonb(new) ->> 'id');
  insert into ip.audit_log (actor, actor_email, op, entity, entity_id, before, after)
  values (
    ip.current_actor(),
    actor_mail,
    lower(tg_op),
    tg_table_name,
    rec_id,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new)
  );
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION ip.normalize_progress_source()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.direction is not null and new.source = 'manual' then
    new.source := 'mail';
  end if;
  return new;
end;
$function$;

-- 진행 기록 한 줄을 대장(상표·특허)에 반영한다.
--
-- 이 저장소에서 가장 손대면 안 되는 함수다. Supabase 원본과 한 글자도 다르지 않다.
-- "더 최신 기록만 시계를 움직인다"(newer), "값 정정은 단계만 반영하고 날짜는 둔다"(moves),
-- "빈 문자열은 지우기, NULL 은 그대로 두기" 세 규칙이 출원일·등록일을 정한다.
CREATE OR REPLACE FUNCTION ip.apply_progress_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ip', 'pg_catalog'
AS $function$
declare
  newer boolean;
  -- 값 정정은 시계를 움직이지 않는다. 단계는 반영하되 날짜는 그대로 둔다.
  moves boolean := new.source <> 'edit';
begin
  if new.entity_kind = 'trademark' then
    select coalesce(t.ref_date, '1900-01-01'::date) <= new.occurred_on
      into newer from ip.trademarks t where t.id = new.entity_id;
    if not found then return new; end if;

    update ip.trademarks set
      status        = case when newer then new.stage else status end,
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
      filed_on      = case when moves and new.stage = '출원' then coalesce(filed_on, new.occurred_on) else filed_on end,
      registered_on = case when moves and new.stage = '등록' then coalesce(registered_on, new.occurred_on) else registered_on end
    where id = new.entity_id;
  else
    select coalesce(p.ref_date, '1900-01-01'::date) <= new.occurred_on
      into newer from ip.patents p where p.id = new.entity_id;
    if not found then return new; end if;

    update ip.patents set
      status        = case when newer then new.stage else status end,
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
      filed_on      = case when moves and new.stage = '출원' then coalesce(filed_on, new.occurred_on) else filed_on end,
      registered_on = case when moves and new.stage = '등록' then coalesce(registered_on, new.occurred_on) else registered_on end
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
  v_stage text;
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
    v_stage := o.stage;
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

      if v_newer then
        v_stage := e.stage;
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

      if v_moves and e.stage = '출원' then
        v_filed := coalesce(v_filed, e.occurred_on);
      end if;
      if v_moves and e.stage = '등록' then
        v_registered := coalesce(v_registered, e.occurred_on);
      end if;
    end loop;

    if o.entity_kind = 'trademark' then
      update ip.trademarks set
        status = v_stage, ref_date = v_ref, name = v_name, holder = v_holder,
        app_no = v_app, reg_no = v_reg, filed_on = v_filed,
        registered_on = v_registered, probability = v_prob,
        note = o.note
      where ip.trademarks.id = o.entity_id;
    else
      update ip.patents set
        status = v_stage, ref_date = v_ref, title = v_name,
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

-- 대장에 없는 건을 새로 만든다. 번호는 지운 건이 있어도 되쓰지 않는다.
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
begin
  if p_kind not in ('trademark', 'patent') then
    raise exception '알 수 없는 부류입니다: %', p_kind;
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception '이름이 비어 있습니다.';
  end if;

  -- 단계는 반드시 정의된 것이어야 한다. 대장이 임의의 문자열을 갖게 두면
  -- 배지 색도 정렬 순서도 없는 유령 단계가 생긴다.
  if not exists (
    select 1 from ip.status_options
     where kind = p_kind and value = p_stage
  ) then
    raise exception '% 에 없는 단계입니다: %', p_kind, p_stage;
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
    values (v_id, btrim(p_name), p_stage, coalesce(p_note, ''));
  else
    insert into ip.patents (id, title, status, note)
    values (v_id, btrim(p_name), p_stage, coalesce(p_note, ''));
  end if;

  insert into ip.opening_state (
    entity_kind, entity_id, stage, ref_date, name, taken_over_on, source_note
  ) values (
    p_kind, v_id, p_stage, null, btrim(p_name), current_date,
    '이 자리에서 새로 만든 건입니다. 넘겨받은 것이 아니라 여기서 시작했습니다'
  );

  return v_id;
end;
$function$;

-- ─── 트리거 ──────────────────────────────────────────────────────────

CREATE TRIGGER trademarks_touch BEFORE UPDATE ON ip.trademarks FOR EACH ROW EXECUTE FUNCTION ip.touch_row();
CREATE TRIGGER trademarks_audit AFTER INSERT OR DELETE OR UPDATE ON ip.trademarks FOR EACH ROW EXECUTE FUNCTION ip.write_audit();

CREATE TRIGGER patents_touch BEFORE UPDATE ON ip.patents FOR EACH ROW EXECUTE FUNCTION ip.touch_row();
CREATE TRIGGER patents_audit AFTER INSERT OR DELETE OR UPDATE ON ip.patents FOR EACH ROW EXECUTE FUNCTION ip.write_audit();

CREATE TRIGGER progress_entries_normalize_source BEFORE INSERT OR UPDATE ON ip.progress_entries FOR EACH ROW EXECUTE FUNCTION ip.normalize_progress_source();
CREATE TRIGGER progress_entries_touch BEFORE UPDATE ON ip.progress_entries FOR EACH ROW EXECUTE FUNCTION ip.touch_row();
CREATE TRIGGER progress_entries_apply AFTER INSERT OR UPDATE ON ip.progress_entries FOR EACH ROW EXECUTE FUNCTION ip.apply_progress_entry();
CREATE TRIGGER progress_entries_audit AFTER INSERT OR DELETE OR UPDATE ON ip.progress_entries FOR EACH ROW EXECUTE FUNCTION ip.write_audit();

CREATE TRIGGER communications_touch BEFORE UPDATE ON ip.communications FOR EACH ROW EXECUTE FUNCTION ip.touch_row();
CREATE TRIGGER communications_audit AFTER INSERT OR DELETE OR UPDATE ON ip.communications FOR EACH ROW EXECUTE FUNCTION ip.write_audit();

CREATE TRIGGER actions_touch BEFORE UPDATE ON ip.actions FOR EACH ROW EXECUTE FUNCTION ip.touch_row();
CREATE TRIGGER actions_audit AFTER INSERT OR DELETE OR UPDATE ON ip.actions FOR EACH ROW EXECUTE FUNCTION ip.write_audit();
