-- MCP 서버(ip-mcp)가 쓰는 표와 함수. ip 스키마 이사의 마지막 조각이다.
--
-- 왜 지금까지 남겨 뒀나: 이 표들은 Supabase 엣지 함수가 쓴다. 표만 먼저 옮기면
-- 함수는 여전히 Supabase 를 보고, 웹앱은 Omnis 를 보게 되어 두 사본이 갈라진다.
-- 그래서 함수를 Omnis 로 옮기는 지금 함께 옮긴다.
--
-- 원본과 달라진 것:
--   * 사용자 참조가 uuid → text (Omnis User.id 가 text 다)
--   * auth.uid() → ip.current_actor()
--   * reissue_mcp_token 은 옮기지 않는다. pgcrypto 의 gen_random_bytes·digest 에
--     기대고 있는데, 그 확장이 있는지는 배포처마다 다르다. 난수와 해시는
--     애플리케이션이 이미 잘 하는 일이라 TypeScript 로 옮겼다(lib/ip-mcp.ts).

-- ─── 개인 토큰 ───────────────────────────────────────────────────────
--
-- CLI 는 커맨드 한 줄이 간단하다. `hadd_` 접두사는 어디서 발급된 값인지
-- 눈으로 알아보게 한다. 원문은 발급 순간 말고는 어디에도 없다 — 해시만 저장한다.
CREATE TABLE ip.mcp_tokens (
    id           uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id      text NOT NULL,
    name         text NOT NULL DEFAULT '',
    token_hash   text NOT NULL,
    prefix       text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz,
    revoked_at   timestamptz,
    CONSTRAINT mcp_tokens_pkey PRIMARY KEY (id),
    CONSTRAINT mcp_tokens_token_hash_key UNIQUE (token_hash),
    CONSTRAINT mcp_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."User"(id) ON DELETE CASCADE
);
CREATE INDEX mcp_tokens_user_idx ON ip.mcp_tokens USING btree (user_id);

-- 이 사람에게 사용 지침을 언제 보여줬는지. 쓰기 게이트가 본다.
CREATE TABLE ip.mcp_guide_reads (
    user_id  text NOT NULL,
    ack      text NOT NULL,
    shown_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT mcp_guide_reads_pkey PRIMARY KEY (user_id),
    CONSTRAINT mcp_guide_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."User"(id) ON DELETE CASCADE
);

-- ─── OAuth 2.1 ───────────────────────────────────────────────────────
--
-- ChatGPT 처럼 정적 토큰을 커넥터 설정에 박을 수 없는 클라이언트를 위해 둔다.
-- 공개 클라이언트만 받으므로 비밀번호가 없고, PKCE(S256)가 그 자리를 대신한다.

CREATE TABLE ip.oauth_clients (
    client_id     text NOT NULL,
    client_name   text NOT NULL DEFAULT '',
    redirect_uris text[] NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT oauth_clients_pkey PRIMARY KEY (client_id)
);

-- 승인 화면으로 넘어가기 전에 잠시 들고 있는 요청. 10분이면 만료된다.
CREATE TABLE ip.oauth_requests (
    id             uuid NOT NULL DEFAULT gen_random_uuid(),
    client_id      text NOT NULL,
    redirect_uri   text NOT NULL,
    state          text,
    code_challenge text NOT NULL,
    resource       text,
    scope          text NOT NULL DEFAULT '',
    created_at     timestamptz NOT NULL DEFAULT now(),
    expires_at     timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
    CONSTRAINT oauth_requests_pkey PRIMARY KEY (id),
    CONSTRAINT oauth_requests_client_id_fkey FOREIGN KEY (client_id) REFERENCES ip.oauth_clients(client_id) ON DELETE CASCADE
);

-- 인가 코드. 한 번만 쓸 수 있다 — used_at 이 그 표시다.
CREATE TABLE ip.oauth_codes (
    code_hash      text NOT NULL,
    client_id      text NOT NULL,
    user_id        text NOT NULL,
    redirect_uri   text NOT NULL,
    code_challenge text NOT NULL,
    resource       text,
    expires_at     timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
    used_at        timestamptz,
    CONSTRAINT oauth_codes_pkey PRIMARY KEY (code_hash),
    CONSTRAINT oauth_codes_client_id_fkey FOREIGN KEY (client_id) REFERENCES ip.oauth_clients(client_id) ON DELETE CASCADE,
    CONSTRAINT oauth_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."User"(id) ON DELETE CASCADE
);

-- 액세스·갱신 토큰. 갱신할 때마다 옛 것을 죽인다(회전).
CREATE TABLE ip.oauth_tokens (
    id           uuid NOT NULL DEFAULT gen_random_uuid(),
    access_hash  text NOT NULL,
    refresh_hash text,
    client_id    text NOT NULL,
    user_id      text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    last_used_at timestamptz,
    revoked_at   timestamptz,
    CONSTRAINT oauth_tokens_pkey PRIMARY KEY (id),
    CONSTRAINT oauth_tokens_access_hash_key UNIQUE (access_hash),
    CONSTRAINT oauth_tokens_refresh_hash_key UNIQUE (refresh_hash),
    CONSTRAINT oauth_tokens_client_id_fkey FOREIGN KEY (client_id) REFERENCES ip.oauth_clients(client_id) ON DELETE CASCADE,
    CONSTRAINT oauth_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."User"(id) ON DELETE CASCADE
);
CREATE INDEX oauth_tokens_user_idx ON ip.oauth_tokens USING btree (user_id);

-- ─── 토큰 → 사람 ─────────────────────────────────────────────────────
--
-- 원본 그대로다(uuid → text 만 바뀜). 마지막 사용 시각 갱신과 조회를 한 번에
-- 하는 것이 요점이라 애플리케이션으로 쪼개지 않았다 — 두 번 왕복하면 그 사이에
-- 폐기된 토큰이 통과할 틈이 생긴다.

CREATE OR REPLACE FUNCTION ip.resolve_mcp_token(p_hash text)
 RETURNS TABLE(user_id text, email text, display_name text, role text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ip', 'pg_catalog'
AS $function$
begin
  update ip.mcp_tokens t
     set last_used_at = now()
   where t.token_hash = p_hash
     and t.revoked_at is null;

  return query
    select m.user_id, m.email, m.display_name, m.role
      from ip.mcp_tokens t
      join ip.members m on m.user_id = t.user_id
     where t.token_hash = p_hash
       and t.revoked_at is null;
end;
$function$;

CREATE OR REPLACE FUNCTION ip.resolve_oauth_token(p_hash text)
 RETURNS TABLE(user_id text, email text, display_name text, role text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ip', 'pg_catalog'
AS $function$
begin
  update ip.oauth_tokens t
     set last_used_at = now()
   where t.access_hash = p_hash
     and t.revoked_at is null
     and t.expires_at > now();

  return query
    select m.user_id, m.email, m.display_name, m.role
      from ip.oauth_tokens t
      join ip.members m on m.user_id = t.user_id
     where t.access_hash = p_hash
       and t.revoked_at is null
       and t.expires_at > now();
end;
$function$;

-- 만료된 요청·코드 청소. 쌓여도 해롭진 않지만 재사용 판정에 쓸모가 없다.
CREATE OR REPLACE FUNCTION ip.sweep_oauth()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'ip', 'pg_catalog'
AS $function$
  delete from ip.oauth_requests where expires_at < now();
  delete from ip.oauth_codes where expires_at < now() - interval '1 day';
$function$;
