---
kind: snapshot
status: active
canonical: mydocs/plans/2026-09-07-website-deck-translate.md
last_verified: 2026-09-07
---

# 2026-09-07 — 카드뉴스 덱 번역 API · 작업 결과

계획서의 "Omnis 가 할 일" 표 중 앞 두 줄(`translateDeck` · `POST /api/website/translate`)을 했다.
세 번째 줄(`scripts/rebuild-cardnews.ts`)은 손대지 않았다.

## 만든 것

| 파일 | 무엇 |
|---|---|
| `lib/website-translate.ts` | `translateDeck(deck, from, to, userId?)` 추가 (+ `CardDeck`·`CardDeckSchema` import) |
| `app/api/website/translate/route.ts` | `POST` · `OPTIONS`. SSO. `{ from, to, locale, deck? }` → `{ locale, deck? }` |

### 왜 덱을 통째로 넘기지 않았나

모델에게 덱 JSON 을 주고 "글자만 바꿔라" 라고 하면 레이아웃 · 배지 · 사진 경로 · 카드 순서를
모델이 지킬지 말지가 매 호출마다 운이 된다. 기사 번역(`translateLocale`)이 블록 수와 이미지 src 를
원문에서 가져오는 것과 같은 이유로, 여기서는 **번역할 문자열만 `{ id, text }` 로 뽑아** 한 번에
보내고 같은 id 로 되꽂는다. 모델이 만질 수 있는 것은 문자열의 내용뿐이고, 그 외 필드는
애초에 모델에게 보이지도 않는다.

id 는 `{카드 번호}.{필드}` (`0.title`, `6.stats.1.unit`, `7.items.0.desc`). 응답의 개수가 다르거나
id 가 하나라도 빠지면 에러로 던진다. 되꽂은 뒤 `CardDeckSchema.parse` 로 한 번 더 거른다.

번역하는 칸: cover 의 `title`·`cta`, quote 의 `quote`·`attrib`, chapter 의 `headline`·`subtitle`·
`body`·`footnote`, stat 의 `stats[].label`·`unit`, list 의 `items[].title`·`desc`.
그대로 두는 칸: `type` · `layout` · `badge` · `handle` · `image` · `imageFit` · `headlineSize` ·
`marker` · `emoji` · 카드 순서와 개수.

프롬프트에는 기존 `SYSTEM`(ADDGEL · LiVEGEL · organoid 용어 규칙)을 그대로 깔고 카드뉴스 규칙을
얹었다 — `<b>…</b>` 와 `\n` 은 그 자리에 그대로(강조와 카드 레이아웃이다), 이모지는 제목에서도 유지,
단위는 자연스러운 영문 단위(배 → x, 개월 → months), 그리고 **"keep it as short as the Korean —
a card has little room"**. 카드는 넘치면 그대로 깨지므로 길이가 품질 요건이다.

## 검증

서버를 띄우지 않고 라우트 핸들러를 직접 불렀다(다른 세션이 `next dev` 를 쓰고 있어 건드리지 않았다).
임시 P-256 키로 SSO 세션 토큰을 발급해 `website-admin-dev` 앱으로 호출했다.
실제 Gemini 를 한 번 불렀다(`websiteTranslateDeck` · `websiteTranslate` 각 1회).

```
$ SSO_SIGNING_KEY="$(cat /tmp/sso-key.json)" npx tsx scripts/_x.ts
사용자: 허채정 (34ac7cd6-e97b-4859-bfed-25f9a2dc3c75)

[a] 토큰 없음 → 401 {"error":"invalid_session"}

[b] 잘못된 덱 → 400 {"error":"invalid_body","issues":["deck.cards.0: Invalid input"]}

[b2] from === to → 400 {"error":"invalid_body","issues":["from 과 to 가 같습니다"]}

[c] 정상 → 200
```

`[c]` 는 9장짜리 덱(cover · standard · image-top · split · overlay · text · stat · list · quote)을
ko→en 으로 보냈다. 응답 전문 중 확인 지점만 옮긴다.

```json
{
  "locale": {
    "title": "HADD Science at the US West Coast Biotech Valley",
    "summary": "HADD Science pitched its 3D culture platform on the Symbiosyx stage at Aquillius in San Diego.",
    "translatedFrom": "6829125c29bc46db"
  },
  "deck": {
    "handle": "@haddscience",
    "cards": [
      { "type": "cover", "title": "Aquillius ‘Symbiosyx’ Pitching 🎤",
        "cta": "Learn more about HADD Science", "handle": "@haddscience" },
      { "type": "chapter", "badge": "chapter 01", "layout": "standard", "headlineSize": "lg",
        "headline": "Aquillius ‘Symbiosyx’ Pitching 🎤",
        "subtitle": "HADD Science Visits the San Diego Bio Hub",
        "image": { "src": "/omnis/api/website/media/aquillius/01.webp" },
        "body": "<b>HADD Science</b> visits the San Diego Bio Hub",
        "footnote": "👇 Check out the West Coast scene" },
      { "type": "chapter", "badge": "chapter 02", "layout": "image-top",
        "headline": "To the Heart of the US West Coast Biotech Valley 🌉",
        "image": { "src": "/omnis/api/website/media/aquillius/02.webp" },
        "body": "San Diego, a global biotech valley,\nand Aquillius, an incubating hub at its center.\nHADD Science took the stage directly at 'Symbiosyx',\nconnecting verified experts and startups." },
      { "type": "chapter", "badge": "chapter 03", "layout": "split", "imageFit": "cover",
        "headline": "ADDGEL & LiVEGEL, Standing on the US West Coast 🧫",
        "image": { "src": "/omnis/api/website/media/aquillius/03.webp" },
        "body": "CEO Heo Chae-jeong personally pitched the company.\n\nShe introduced the nucleic acid-based 3D culture materials\n<b>ADDGEL</b> and <b>LiVEGEL</b> to the US West Coast bio scene." },
      { "type": "chapter", "badge": "chapter 04", "layout": "overlay",
        "headline": "3D Stem Cell and Organoid Platform 🔬",
        "image": { "src": "/omnis/api/website/media/aquillius/04.webp" },
        "footnote": "'Human-like' Evaluation Model to Replace Animal Testing" },
      { "type": "chapter", "badge": "chapter 05", "layout": "text",
        "headline": "Into the Global Leader Group 🚀",
        "body": "Networking followed the pitching.\nThrough verified matching with local investors and experts, HADD Science\nadvances into the <b>leader group for 3D culture platform development</b>." },
      { "type": "chapter", "badge": "chapter 06", "layout": "stat",
        "headline": "The Scene in Numbers 📊",
        "stats": [ { "value": "3", "unit": "days", "label": "Trip Duration" },
                   { "value": "12", "unit": "companies", "label": "Investors Met" },
                   { "value": "2", "unit": "x", "label": "Culture Efficiency Improvement" } ],
        "body": "These are what we confirmed during the short trip." },
      { "type": "chapter", "badge": "chapter 07", "layout": "list", "marker": "emoji",
        "headline": "What Was Gained ✅",
        "items": [ { "title": "Local Network", "desc": "Directly connected with investors and experts.", "emoji": "🤝" },
                   { "title": "Technology Validation", "desc": "Confirmed competitiveness within local research infrastructure.", "emoji": "🧪" },
                   { "title": "Market Entry Foothold", "desc": "Planned next steps for the US West Coast market.", "emoji": "🌏" } ] },
      { "type": "quote", "badge": "대표 한마디 💬",
        "quote": "“Announcing HADD Science's platform in the US West”",
        "attrib": "Heo Chae-jeong, CEO of HADD Science",
        "image": { "src": "/omnis/api/website/media/aquillius/05.webp" } }
    ]
  }
}
```

스크립트가 원문과 대조한 결과:

```
카드 수: 원문 9 · 번역 9 → 같음
type · layout · badge · image.src 동일: true
handle: @haddscience (원문 @haddscience)
locale.title: HADD Science at the US West Coast Biotech Valley
translatedFrom: 6829125c29bc46db (16자)
```

`<b>…</b>` 는 chapter 01 · 03 · 05 에서, `\n` 은 chapter 02 · 03 · 04 · 05 에서 원문과 같은 자리에
남았다. `stats[].value`(3 · 12 · 2)와 `items[].emoji`(🤝 🧪 🌏)는 애초에 모델에게 보내지 않았고
그대로다. 단위는 일 → days, 개사 → companies, 배 → x 로 나왔다.

검증 스크립트(`scripts/_x.ts`)와 임시 키(`/tmp/sso-key.json`)는 지웠다.

## 품질 게이트

```
$ npx tsc --noEmit
tsc exit=0
$ npx eslint lib/website-translate.ts app/api/website/translate/route.ts
eslint exit=0
```

`npm run build` 는 돌리지 않았다 — 다른 세션의 `next dev` 가 같은 `.next` 를 쓰고 있다.

## 남은 것

- **quote 카드의 `badge` 가 한국어로 남는다.** 위 출력의 마지막 카드 `"badge": "대표 한마디 💬"` 가
  영문 덱에도 그대로 있다. 지시는 badge 를 번역 대상에서 빼는 것이었고(chapter 01 같은 영문 라벨을
  건드리지 않기 위해서다) 그대로 따랐지만, quote 카드의 badge 는 영문 라벨이 아니라 한국어 문구다.
  영문 카드에 한국어가 한 줄 남는 것이 맞는지는 작업지시자 판단이 필요하다.
- **모델이 이모지 위치를 옮긴다.** 원문 `🎤 Aquillius ‘Symbiosyx’ 피칭` → `Aquillius ‘Symbiosyx’
  Pitching 🎤`. 이모지는 유지되지만 앞뒤가 바뀐다. 카드 디자인상 문제가 되면 프롬프트에 위치까지
  못박아야 한다.
- 계획서의 `scripts/rebuild-cardnews.ts` 는 이 작업 범위가 아니다 — 다른 세션이 만들고 있다(커밋하지 않음).
- 편집기 쪽(사이트 저장소)에서 이 라우트를 부르는 코드는 아직 없다. 지금은 서버만 서 있다.
