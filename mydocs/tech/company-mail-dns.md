---
kind: canonical
status: active
canonical: mydocs/tech/company-mail-dns.md
last_verified: 2026-09-21
---

# 회사 메일 DNS (haddscience.com)

회사 메일은 **네이버웍스**다. 도메인 DNS 는 **Vercel**(`ns1/ns2.vercel-dns.com`)이 갖고 있으므로
레코드는 `vercel dns` 로 넣고 뺀다. 등록기관(가비아)에서 할 일은 없다.

```
vercel dns ls haddscience.com
vercel dns add haddscience.com <이름> TXT "<값>"
```

**메일 레코드를 실수로 지우면 회사 메일이 죽는다.** DNS 를 만질 때 `vercel dns ls` 로 먼저 본다.

## 지금 들어 있는 것 (2026-09-21 실측)

| 종류 | 값 |
|---|---|
| MX | `10 kr1-aspmx1.worksmobile.com` · `20 kr1-aspmx2.worksmobile.com` |
| SPF (TXT `@`) | `v=spf1 include:spf.worksmobile.com include:_spf.daum.net ~all` |
| DKIM (TXT `naverworks._domainkey`) | `v=DKIM1;k=rsa;p=MIIBIjANBgkq…` (408자) |
| DMARC | **없음** |

`_spf.daum.net` 은 옛 메일 서비스의 흔적이다. 나가는 메일을 헤더로 확인했을 때는 전부
네이버웍스 서버(`125.209.209.50` · `.51`)였다 — 필요 없어 보이지만, 다음 계열로 보내는 경로가
정말 없는지 확인한 뒤에 뺀다.

## 확인하는 법 — 화면 말고 헤더

네이버웍스 관리자 화면의 「SPF레코드 연동 안 됨」 은 **옛 값을 보고 판정한 뒤 갱신되지 않은 것**일 수 있다.
실제로 9/18 에 화면은 빨간색이었지만, 받는 쪽(구글)은 이미 통과시키고 있었다.

```
# 1. 권위 서버에 직접
dig +short TXT haddscience.com @ns1.vercel-dns.com

# 2. 리졸버마다 (캐시가 갈린다 — KT 168.126.63.1 이 가장 늦게 바뀌었다)
for r in 168.126.63.1 168.126.63.2 8.8.8.8 1.1.1.1; do dig +short TXT haddscience.com @$r; done

# 3. 진짜 근거 — 받은 메일 헤더
#    Received-SPF: pass (… designates 125.209.209.50 as permitted sender)
#    Authentication-Results: … spf=pass … dkim=pass
```

9/18 실측: 회사 주소로 보낸 메일 두 통 모두 구글이 `spf=pass`. 9/21 에는 리졸버 7곳이 모두 새 값.

## DKIM (2026-09-21 등록)

네이버웍스 관리자 → 서비스 → 메일 → 송수신 설정 → 메일 인증(DKIM) 에서 셀렉터 `naverworks` 로
키를 발급하면 호스트명과 TXT 값을 준다. 그 값을 DNS 에 넣고 **「인증 시작」** 을 눌러야 상태가 바뀐다.

넣은 뒤 대조한다 — 값이 잘리거나 공백이 섞이면 인증이 안 된다.

```
dig +short TXT naverworks._domainkey.haddscience.com @8.8.8.8 | tr -d '" '
```

DKIM 이 붙으면 **우리 도메인 이름으로 서명**된다. 그전에는 네이버웍스 이름(`d=worksmobile.com`)으로만
서명돼 있어서, 받는 사람이 메일을 다른 주소로 전달하면 SPF 가 깨지고 기댈 것이 없었다.

## DMARC (아직)

```
이름: _dmarc   타입: TXT
값:  v=DMARC1; p=none; rua=mailto:<보고 받을 주소>
```

`p=none` 은 아무것도 막지 않고 보고만 받는다. 보고를 몇 주 보고 나서 `quarantine` → `reject` 로 올린다.
보고 받을 주소를 정하는 것이 먼저다(하루 몇 통씩 온다).
