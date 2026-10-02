# Zone Thumbnail Generator

서비스 설명(SUBJECT)으로 파스텔 배경 + 3D UI 아이콘 썸네일(502×310)을 생성하고, 결과를 보면서 👎 피드백(구도/형태/느낌 등)으로 프롬프트를 깎는 작업용 사이트입니다.

## 시작하기

```bash
npm install
cp .env.example .env   # OPENAI_API_KEY 입력
npm start              # http://localhost:3001
```

## 구조

- `public/template.js` — 기본 프롬프트(v1) 섹션, 배경 파스텔 컬러, 피드백 항목, 서비스 목록
- `public/app.js` — 프롬프트 조합/생성/피드백 UI
- `server.js` — OpenAI 이미지 API 호출, 프롬프트 버전·피드백 API
- `lib/store.js` — 저장소 (GitHub 데이터 저장소 또는 로컬 `data/`)

## 프롬프트 깎는 흐름

1. 서비스 선택 → 생성
2. 별로면 👎 → 항목 체크 + 메모. 메모가 있는 항목은 다음 생성부터 프롬프트 끝의 `[FEEDBACK]` 섹션에 자동으로 들어감
3. "프롬프트 편집"에서 섹션을 직접 고치고 → "새 버전으로 저장" (v2, v3…)
4. 고쳐서 해결된 피드백은 보드에서 "반영"을 끔

피드백마다 어떤 프롬프트 버전에서 나온 결과인지 기록됩니다.

## 배포 (Render)

Render 대시보드 → **New → Blueprint** → 이 저장소 선택 → `OPENAI_API_KEY`, `SITE_PASSWORD` 입력.
`SITE_PASSWORD`는 꼭 채워주세요 — 이미지 생성은 OpenAI 과금이 발생합니다.

무료 플랜은 재시작/재배포 때마다 디스크가 초기화돼요. 그래서 배포 환경에서는 피드백·프롬프트 버전·이미지를
비공개 GitHub 저장소 [`jinbytt/icon-thumbnail-data`](https://github.com/jinbytt/icon-thumbnail-data)에 저장합니다
(`lib/store.js`, 쓰기 1번 = 커밋 1개). Render 환경변수에 `GITHUB_TOKEN`을 넣어주세요 — 그 저장소에만
Contents 읽기/쓰기 권한을 준 fine-grained token이면 됩니다. 토큰이 없으면 로컬 `data/` 폴더를 씁니다.
