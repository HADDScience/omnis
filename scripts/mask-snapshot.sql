-- 로컬 스냅샷 마스킹. `pnpm db:snapshot` 이 받아온 직후 로컬 DB 에만 돈다.
--
-- 목적은 **글자 수와 모양을 유지한 채 내용만 지우는 것**이다. 스냅샷을 받는 이유가
-- 「업무 421건이 있어야 목록이 어떻게 보이는지, 채팅 9천 건이 있어야 스크롤이 어떤지」
-- 를 보는 것이라, 분량과 길이만 같으면 레이아웃·스크롤·성능 검증에는 차이가 없다.
--
-- 이슈 재현처럼 실제 값이 필요하면 `pnpm db:snapshot --raw` 로 받는다.
-- 그때는 노트북에 운영 원문이 그대로 남는다는 것을 알고 쓰는 것이다.
--
-- 유니크 칼럼(CrmOrg.name·bizRegNo, Task.slug)은 id 에서 뽑은 값을 붙여 충돌을 피한다.
-- 길이 유지보다 유니크 유지가 먼저다.
--
-- 가리지 않는 것: 사람 이름(User.name·StaffProfile.name — 사내 이름이고 화면·E2E 가
-- 이름으로 찾는다), 금액, passwordHash, 날짜, 상태값. 이유는 각 절의 주석에 적었다.

\set ON_ERROR_STOP on
begin;

-- ─── 도우미 ────────────────────────────────────────────────

-- 같은 글자 수의 한글 채움 문자열. 길이가 보존돼야 줄바꿈·말줄임이 원본과 같이 나온다.
create or replace function pg_temp.mask_text(t text) returns text
  language sql immutable as $$
  select case
    when t is null then null
    when length(t) = 0 then t
    else left(repeat('가나다라마바사아자차카타파하', ceil(length(t) / 14.0)::int), length(t))
  end
$$;

-- JSON 은 구조를 남기고 문자열 값만 가린다. type·kind·id·status 는 화면이 분기에
-- 쓰므로 건드리지 않는다 — 가리면 카드 섹션이 렌더링되지 않는다(lib/omnis-types migrateContent).
-- 재귀라서 plpgsql 이다. SQL 함수는 생성 시점에 본문을 검사해 자기 자신을 못 부른다.
create or replace function pg_temp.mask_jsonb(j jsonb) returns jsonb
  language plpgsql immutable as $$
  begin
    return case jsonb_typeof(j)
      when 'string' then to_jsonb(pg_temp.mask_text(j #>> '{}'))
      when 'array'  then coalesce((select jsonb_agg(pg_temp.mask_jsonb(e)) from jsonb_array_elements(j) e), '[]'::jsonb)
      when 'object' then coalesce((
        select jsonb_object_agg(k, case when k in ('type','kind','id','status') then v else pg_temp.mask_jsonb(v) end)
        from jsonb_each(j) as t(k, v)), '{}'::jsonb)
      else j
    end;
  end
$$;

-- 확장자는 남긴다. 아이콘·미리보기 분기가 확장자를 본다.
create or replace function pg_temp.mask_filename(f text) returns text
  language sql immutable as $$
  select case
    when f is null then null
    when position('.' in reverse(f)) = 0 then pg_temp.mask_text(f)
    else pg_temp.mask_text(left(f, length(f) - position('.' in reverse(f))))
         || substr(f, length(f) - position('.' in reverse(f)) + 1)
  end
$$;

-- ─── 채팅 ──────────────────────────────────────────────────
-- 시스템 메시지(__ 로 시작)는 그대로 둔다. 화면이 그 문자열로 분기한다.
update "ChatMessage"
   set content = pg_temp.mask_text(content)
 where kind = 'NORMAL' and content not like '\_\_%';

-- ─── 업무 · 보고 · 카드 ────────────────────────────────────
update "Task"
   set name             = pg_temp.mask_text(name),
       slug             = 'task-' || substr(id, 1, 8),
       background       = pg_temp.mask_text(background),
       "expectedResult" = pg_temp.mask_text("expectedResult"),
       "sourceMessages" = pg_temp.mask_jsonb("sourceMessages");

update "Checklist"     set name    = pg_temp.mask_text(name),
                           memo    = pg_temp.mask_text(memo);
update "WeeklyReport"  set title   = pg_temp.mask_text(title),
                           content = pg_temp.mask_jsonb(content);
update "OmnisCard"     set title   = pg_temp.mask_text(title),
                           content = pg_temp.mask_jsonb(content);
update "OmnisCardVersion" set content = pg_temp.mask_jsonb(content);

-- ─── 검색 색인 ─────────────────────────────────────────────
-- 벡터는 지운다. `pnpm db:embed` 로 언제든 다시 만들 수 있고, 덤프에서 가장 큰 덩어리다.
update "EmbeddingChunk"
   set title     = pg_temp.mask_text(title),
       content   = pg_temp.mask_text(content),
       embedding = null;

-- ─── 세금계산서 ────────────────────────────────────────────
-- 금액은 남긴다. 거래처가 가려지면 금액만으로는 식별되지 않고, 회사 Context 화면의
-- 매출 집계가 실제 모양으로 보여야 한다. 금액까지 가리려면 이 주석을 지우고 아래에 추가한다.
update "TaxInvoice"
   set "supplierName"  = '공급자' || substr(md5(id), 1, 6),
       "buyerName"     = '공급받는자' || substr(md5(id), 1, 6),
       "supplierBizNo" = '000-00-' || lpad(abs(hashtext(id || 's') % 100000)::text, 5, '0'),
       "buyerBizNo"    = '000-00-' || lpad(abs(hashtext(id || 'b') % 100000)::text, 5, '0'),
       "fileName"      = pg_temp.mask_filename("fileName");

update "TaxInvoiceItem" set name = pg_temp.mask_text(name), spec = pg_temp.mask_text(spec);
update "CrmPayment"     set note = pg_temp.mask_text(note);

-- ─── 거래처 · 담당자 ───────────────────────────────────────
update "CrmOrg"
   set name       = '거래처' || substr(md5(id), 1, 6),
       "bizRegNo" = case when "bizRegNo" is null then null
                         else '000-00-' || lpad(abs(hashtext(id) % 100000)::text, 5, '0') end,
       address    = pg_temp.mask_text(address),
       note       = pg_temp.mask_text(note);

update "CrmContact"
   set name  = '담당자' || substr(md5(id), 1, 4),
       title = pg_temp.mask_text(title),
       phone = case when phone is null then null
                    else '010-0000-' || lpad(abs(hashtext(id) % 10000)::text, 4, '0') end,
       email = case when email is null then null else 'contact' || substr(md5(id), 1, 6) || '@example.com' end,
       note  = pg_temp.mask_text(note);

-- ─── 사람 ──────────────────────────────────────────────────
-- User.name 은 채팅·업무 화면 전반에 나오고 시드·E2E 가 이름으로 찾는다. 사내 이름이라
-- 외부 유출 시 민감도는 낮아 남긴다. passwordHash 도 남긴다 — 바꾸면 로컬 로그인이 막힌다.
update "User" set email = case when email is null then null else 'user' || substr(md5(id), 1, 6) || '@example.com' end;

update "StaffProfile"
   set email     = case when email is null then null else 'staff' || substr(md5(id), 1, 6) || '@example.com' end,
       phone     = case when phone is null then null
                        else '010-0000-' || lpad(abs(hashtext(id) % 10000)::text, 4, '0') end,
       "ntisNo"  = case when "ntisNo" is null then null else lpad(abs(hashtext(id) % 100000000)::text, 8, '0') end,
       education = pg_temp.mask_text(education),
       major     = pg_temp.mask_text(major),
       duties    = pg_temp.mask_text(duties),
       note      = pg_temp.mask_text(note),
       "birthDate" = case when "birthDate" is null then null else date_trunc('year', "birthDate") end;

-- ─── 파일 이름 ─────────────────────────────────────────────
-- 실물은 NAS 에 있고 로컬에는 키만 있다. 이름에 「특허 명세서」 같은 내용이 들어간다.
update "File"       set name = pg_temp.mask_filename(name);
update "StaffAsset" set "fileName" = pg_temp.mask_filename("fileName");

commit;
