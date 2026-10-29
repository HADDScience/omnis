-- 출원일·등록일 규칙 두 가지를 고친다. 계획: mydocs/plans/2026-10-28-ip-explicit-dates.md
--
-- 1. latch 는 그 단계에 「들어간」 기록에서만 걸린다.
--    예전에는 단계가 '출원'인 기록이면 이미 출원 단계인 건의 후속 메일 기록도 비어 있는
--    출원일을 채웠다. 개시 스냅샷이 「출원 · 출원일 없음」으로 시작한 PT-05·06 에
--    2026-10-26 메일 기록이 들어가자 출원일이 2026-10-26 이 됐다(실제 2025-10-17).
--
--    들어간 기록 = 단계가 바뀌는 기록, 또는 같은 단계라도 기준일(ref_date) 이하인 기록.
--    이미 그 단계인 건은 기준일 이전에 그 단계로 들어갔으므로, 기준일보다 늦은 같은 단계
--    기록은 후속 기록일 수밖에 없다. 기준일 이하를 남겨 두는 이유는 TM-07 이다 —
--    개시 스냅샷이 이미 「등록」(기준일 2025-12-18)이고, 그 날짜 「등록」 기록(엑셀 근거)이
--    등록일을 채운다. 「단계가 바뀔 때만」으로 좁히면 이 등록일이 재계산에서 사라진다.
--    기준일을 모르면(NULL) 후속 기록이라고 말할 근거가 없으므로 들어간 기록으로 본다.
--
-- 2. 기록이 출원일·등록일을 명시할 수 있다(값 정정).
--    날짜를 고칠 길이 없었다. app_no·reg_no 와 같은 약속을 쓴다 —
--    NULL=그대로, ''=비움, 'YYYY-MM-DD'=그 값. date 칸에는 빈 문자열이 없어
--    「비우기」를 표현할 수 없으므로 text 로 두고 형식은 CHECK 로 막는다.
--    명시값은 사람이 근거(출원번호통지서·등록증)를 보고 적은 것이라 newer·moves 와
--    무관하게 언제나 반영한다.

ALTER TABLE ip.progress_entries
  ADD COLUMN filed_on      text,
  ADD COLUMN registered_on text,
  ADD CONSTRAINT progress_entries_filed_on_check
    CHECK (filed_on = '' OR (filed_on ~ '^\d{4}-\d{2}-\d{2}$' AND filed_on::date IS NOT NULL)),
  ADD CONSTRAINT progress_entries_registered_on_check
    CHECK (registered_on = '' OR (registered_on ~ '^\d{4}-\d{2}-\d{2}$' AND registered_on::date IS NOT NULL));

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

    -- SET 의 오른쪽에서 status·ref_date 는 갱신 전 값이다. latch 조건이 그것을 본다.
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
      filed_on      = case
                        when new.filed_on = '' then null
                        when new.filed_on is not null then new.filed_on::date
                        when moves and new.stage = '출원'
                           and (status is distinct from new.stage or new.occurred_on <= coalesce(ref_date, new.occurred_on))
                          then coalesce(filed_on, new.occurred_on)
                        else filed_on
                      end,
      registered_on = case
                        when new.registered_on = '' then null
                        when new.registered_on is not null then new.registered_on::date
                        when moves and new.stage = '등록'
                           and (status is distinct from new.stage or new.occurred_on <= coalesce(ref_date, new.occurred_on))
                          then coalesce(registered_on, new.occurred_on)
                        else registered_on
                      end
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
      filed_on      = case
                        when new.filed_on = '' then null
                        when new.filed_on is not null then new.filed_on::date
                        when moves and new.stage = '출원'
                           and (status is distinct from new.stage or new.occurred_on <= coalesce(ref_date, new.occurred_on))
                          then coalesce(filed_on, new.occurred_on)
                        else filed_on
                      end,
      registered_on = case
                        when new.registered_on = '' then null
                        when new.registered_on is not null then new.registered_on::date
                        when moves and new.stage = '등록'
                           and (status is distinct from new.stage or new.occurred_on <= coalesce(ref_date, new.occurred_on))
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
  v_stage text;
  v_prev text;
  v_prev_ref date;
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
      -- 이 기록 전의 단계와 기준일. latch 조건이 본다(맨 위 1 참고).
      v_prev := v_stage;
      v_prev_ref := v_ref;

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

      if e.filed_on = '' then
        v_filed := null;
      elsif e.filed_on is not null then
        v_filed := e.filed_on::date;
      elsif v_moves and e.stage = '출원'
            and (v_prev is distinct from e.stage or e.occurred_on <= coalesce(v_prev_ref, e.occurred_on)) then
        v_filed := coalesce(v_filed, e.occurred_on);
      end if;
      if e.registered_on = '' then
        v_registered := null;
      elsif e.registered_on is not null then
        v_registered := e.registered_on::date;
      elsif v_moves and e.stage = '등록'
            and (v_prev is distinct from e.stage or e.occurred_on <= coalesce(v_prev_ref, e.occurred_on)) then
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
