# 썸네일 + 심볼 자동 생성 — 개발 전달 문서

서비스 설명 한 줄로 **썸네일(502×310)** 과 **심볼(120×120, 투명/배경색)** 을 자동 생성하는 방법입니다.
이 저장소의 웹사이트(Zone Thumbnail Generator)는 프롬프트를 다듬는 작업용 도구이고,
실제 서비스에서는 아래 흐름만 구현하면 됩니다.

> **가장 빠른 길:** [`scripts/generate.js`](scripts/generate.js)가 전체 흐름을 그대로 구현한 예제입니다.
> 이 코드를 기준으로 옮기면 사이트와 같은 결과가 나옵니다.

```bash
npm install
cp .env.example .env        # OPENAI_API_KEY 입력
node scripts/generate.js "룰렛 — 브랜드 콘셉트에 맞게 커스터마이징 가능한 즉석 보상형 룰렛 이벤트"
# → out/<timestamp>/thumbnail-502x310.png, symbol-120-transparent.png, symbol-120.png, prompt.txt, meta.json
```

옵션: `--hue peach` `--people none|include` `--gender man|woman` `--quality low|medium|high|auto` `--out <dir>`

---

## 1. 전체 흐름

```
서비스 설명 (SUBJECT)
   │
   ├─ ① 썸네일 프롬프트 조립   prompts/thumbnail.json + 규칙(배경색·사람)
   ├─ ② 썸네일 생성            POST /v1/images/generations  1296×800
   ├─ ③ 썸네일 후처리          502×310으로 리사이즈(cover)
   ├─ ④ 심볼 생성              POST /v1/images/edits  (썸네일 이미지 + prompts/symbol.txt), 1024×1024, 투명 배경
   └─ ⑤ 심볼 후처리            120×120 투명 / 썸네일 배경색을 깐 120×120
```

심볼은 **반드시 ② 결과 이미지를 입력으로** 만들어야 합니다. 썸네일과 같은 오브젝트가 나오게 하기 위해서입니다.

## 2. 파일

| 파일 | 내용 |
|---|---|
| `prompts/thumbnail.json` | 썸네일 프롬프트(섹션별 원문), 모델·사이즈·배경색 목록·사람 규칙. **새틴 파스텔 v8** (운영 데이터에서 추출) |
| `prompts/symbol.txt` | 심볼 프롬프트 원문 |
| `scripts/generate.js` | 위 두 파일을 읽어 ①~⑤를 수행하는 예제 |

프롬프트가 바뀌면 이 두 파일만 교체하면 됩니다.

## 3. 썸네일 프롬프트 조립 (①)

`thumbnail.json`의 `sections`를 순서대로 `"[LABEL]\n" + text` 형태로 이어 붙입니다(섹션 사이 줄바꿈 1개).
조립할 때 아래 값을 채웁니다.

| 자리 | 넣는 값 |
|---|---|
| `{{SUBJECT}}` | 서비스 이름 + 설명. **이름만 넣지 말고 설명까지** 넣어야 해석이 정확합니다. 예: `인터랙티브 방명록 — 나의 한마디가 공간을 채우는, 디지털 방명 체험 서비스` |
| `{{BACKGROUND_HUE}}` | `backgroundHues` 7개 중 하나(`id` 값, 예: `peach`). 매번 랜덤 또는 순환. **모델에게 "알아서 골라"라고 맡기면 같은 색만 나와서** 코드에서 골라 넣습니다. |

### 사람 규칙

모델은 그대로 두면 사람을 너무 자주 그리고, 그릴 땐 대부분 여성으로 그립니다. 그래서 코드에서 정합니다.

1. SUBJECT에 `people.keywords`(얼굴, 페이스, 사진, 포토, 셀카, 피부, 인물, 관상 …) 중 하나가 있으면 **사람 포함**, 없으면 **사람 없이**.
2. **사람 없이:** id가 `people.peopleSectionIds`(`character`, `character-face`)인 섹션을 **빼고**, 맨 끝에 `people.noPeopleBlock`을 붙입니다.
3. **사람 포함:** 두 섹션을 그대로 두고, `character` 섹션 텍스트 끝에 줄바꿈 + `people.includeLine`을 붙입니다.
   `{{GENDER}}`에는 `people.genders` 중 하나(남/여)를 랜덤으로 넣습니다.

## 4. API 호출

모델: **`gpt-image-2.5-sunburst`**, quality: **`auto`** (테스트는 `low`로 싸게)

**② 썸네일** — `POST https://api.openai.com/v1/images/generations` (JSON)
```json
{ "model": "gpt-image-2.5-sunburst", "prompt": "<조립한 프롬프트>", "size": "1296x800", "quality": "auto", "n": 1 }
```
`size`는 502×310과 같은 비율(251:155)의 16의 배수입니다. 응답 `data[0].b64_json`이 PNG입니다.

**④ 심볼** — `POST https://api.openai.com/v1/images/edits` (multipart/form-data)
```
model       = gpt-image-2.5-sunburst
prompt      = <prompts/symbol.txt 내용 그대로>
size        = 1024x1024
quality     = auto
background  = transparent
image[]     = <② 썸네일 PNG>
```

긴 생성은 가끔 연결이 끊깁니다(ETIMEDOUT). **네트워크 오류와 429/5xx는 2초 후 1회 재시도**를 권장합니다.
보통 한 장에 30초~1분 이상 걸립니다.

## 5. 후처리 (③ ⑤)

- **썸네일:** 1296×800 → 502×310, 가운데 기준 cover 리사이즈.
- **심볼 투명:** 1024×1024 → 120×120 (알파 유지).
- **심볼 배경색:** 썸네일 **네 모서리 픽셀 평균색**(= 단색 파스텔 배경)을 120×120 투명 심볼 뒤에 깔아서 합성.
  API를 한 번 더 부르지 않으므로 두 심볼의 오브젝트가 완전히 같습니다.

## 6. 사이트와 다른 점

- 사이트는 👎 피드백 메모를 프롬프트 끝 `[FEEDBACK]` 섹션으로 덧붙이는데, 이건 프롬프트를 다듬는 중에만 쓰는 임시 메모라 **전달용 프롬프트에는 넣지 않았습니다.**
- 사이트의 성별은 "번갈아"지만, 서버 호출은 이전 결과를 모르기 때문에 **랜덤**으로 고릅니다.
