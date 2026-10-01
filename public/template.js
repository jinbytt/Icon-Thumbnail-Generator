// Icon Thumbnail Generator — prompt data
//
// DEFAULT_SECTIONS is prompt v1 (from the ChatGPT session). Sections can be
// edited in the UI and saved as new versions; this file stays the baseline.
//
// Placeholders filled in by app.js at generation time:
//   {{SUBJECT}}         — the service name + description being iconized
//   {{BACKGROUND_HUE}}  — the pastel hue picked for this image (random or fixed)

export const APP_VERSION = "v1.0";

export const OUTPUT = { width: 502, height: 310 }; // 251:155

export const DEFAULT_SECTIONS = [
  { id: "subject", label: "SUBJECT", text: "{{SUBJECT}}" },
  {
    id: "concept",
    label: "CONCEPT → ICON",
    text: `Interpret SUBJECT as a concept, function or service. Identify its core meaning and select a familiar visual symbol that communicates it immediately.
Choose an associated object, action or metaphor rather than automatically reproducing the complete physical equipment. Use one main symbol and, only when necessary, one supporting element. Combine them into a single cohesive icon. Choose one interpretation and output one image.`,
  },
  {
    id: "form",
    label: "ICON FORM",
    text: `Create a compact stylized 3D UI icon that remains recognizable at small size. Use a few bold shapes, clean curved surfaces, precise silhouettes and softly rounded edges without inflating the forms. Retain essential identifying features while simplifying repetitive parts and tiny details.`,
  },
  {
    id: "style",
    label: "STYLE & TEXTURE",
    text: `Polished graphic 3D rendering with satin surfaces, broad soft highlights and subtle edge reflections. Visible but delicate fine surface grain, a lightly powder-coated finish and subtle micro-roughness. Fine monochromatic speckling should be especially noticeable in midtones and shadows. Preserve clean edges and smooth overall forms.
Use blue and lavender accents with soft off-white neutral surfaces. Controlled shading, clear dimensional depth and gently colored shadows.`,
  },
  {
    id: "background",
    label: "BACKGROUND",
    text: `Opaque, uniform solid pastel background filling the entire canvas edge to edge. Choose a pastel hue that complements the icon and provides clear separation. Keep the background visibly colored. Soft localized shadows beneath the icon. No gradient, white background, transparency, horizon line or visible floor transition.`,
  },
  {
    id: "color",
    label: "COLOR VARIATION — PRIORITY",
    text: `Use a very pale {{BACKGROUND_HUE}} as the solid pastel background hue.
Adapt the object colors to harmonize with the selected background, using two or three coordinated colors with richer mid-tone accents and soft neutral surfaces. Maintain clear separation through differences in lightness and saturation.
This color variation instruction takes priority over the blue and lavender color specification above and any fixed colors in the reference image. Preserve all existing shape, texture, lighting and composition instructions.
Keep the background very pale, high in lightness and low in saturation, as if the selected pastel hue is mixed with plenty of white. The color should be softly visible without becoming vivid, intense or visually dominant. Avoid medium-tone or saturated backgrounds. Keep the objects richer in color than the background so the icon remains the main focus.`,
  },
  {
    id: "size",
    label: "SIZE & COMPOSITION",
    text: `One landscape image, 502 pixels wide × 310 pixels high, aspect ratio 251:155. Center the complete icon with balanced, generous margins. Keep all elements fully visible. No border or collage.`,
  },
  {
    id: "character",
    label: "HUMAN ILLUSTRATION — CONDITIONAL PRIORITY",
    text: `Apply only when a person is needed to communicate SUBJECT. Do not add people unnecessarily.
Depict people as clean, flat editorial vector-style illustrations matching the attached human reference, not as 3D dolls or mascots. Use simple solid-color shapes, graphic silhouettes, modestly stylized adult proportions, a visible neck, simplified shoulders and naturally flowing limbs.
Use tiny flat dark oval eyes, a minimal or omitted nose and mouth, and flat geometric hair shapes. No glossy eyes, sculpted facial features, inflated cheeks, oversized spherical heads, baby-like proportions or toy-like bodies.
Keep skin, hair and clothing primarily flat, with no outlines and at most minimal tonal shading. Do not apply 3D satin highlights, rounded sculptural volume or powder-coated surface texture to people. If grain is used, apply only delicate two-dimensional graphic grain.
Express actions through clear, simple poses. Choose a bust or fuller figure according to the concept; do not default to a floating head.
Coordinate the person's clothing and colors with the selected pale pastel background and surrounding objects. Keep non-human objects in the existing 3D icon style. Maintain one compact, cohesive icon composition rather than a full illustrated scene.
These human-specific rules override the general 3D material and shape instructions only for people. Preserve all existing concept, background and 502 × 310 size instructions.
Use the human reference for illustration style only. Do not copy its text, layout, props or background.`,
  },
  {
    id: "avoid",
    label: "AVOID",
    text: `Detailed equipment replicas, realistic product photography, complex scenes, unnecessary decorations, tiny hardware, text, leather grain, fabric weave, coarse bumps, heavy grunge, exaggerated thickness, heavy brown shadows, glow or bloom.`,
  },
  {
    id: "reference",
    label: "REFERENCE RULE",
    text: `If a style reference is attached, use it only for shape language, material finish, lighting and color treatment. Derive the icon's subject and symbols from SUBJECT. Follow the background and size instructions independently of the reference.`,
  },
];

// SUBJECTs containing any of these switch 인물 to "꼭 필요할 때만" automatically
// (people stay off by default because the model adds them far too often).
export const PERSON_KEYWORDS = ["얼굴", "페이스", "face", "사진", "포토", "photo", "셀카", "셀피", "selfie", "피부", "인물", "관상"];

// Person gender, picked by the site (like the hue) because the model left to
// itself almost always draws a woman. Alternated in "random" mode.
export const GENDERS = [
  { id: "man", label: "👨 남성", en: "a man (male)" },
  { id: "woman", label: "👩 여성", en: "a woman (female)" },
];

// Rotated so consecutive images don't land on the same hue.
export const HUES = [
  { id: "sky blue", label: "스카이블루", swatch: "#DCEBFA" },
  { id: "mint", label: "민트", swatch: "#DDF3EA" },
  { id: "lavender", label: "라벤더", swatch: "#E8E3F7" },
  { id: "blush pink", label: "블러시핑크", swatch: "#F8E3E8" },
  { id: "peach", label: "피치", swatch: "#FBE7DA" },
  { id: "butter yellow", label: "버터옐로", swatch: "#FAF2D6" },
  { id: "pale aqua", label: "페일아쿠아", swatch: "#DDF2F4" },
];

// 👎 checklist. `en` is what goes into the prompt's feedback section.
export const FEEDBACK_CATEGORIES = [
  { id: "composition", label: "구도", en: "Composition" },
  { id: "shape", label: "형태", en: "Shape / form" },
  { id: "mood", label: "느낌", en: "Overall feel / style" },
  { id: "color", label: "색감", en: "Color" },
  { id: "background", label: "배경", en: "Background" },
  { id: "texture", label: "질감", en: "Material / texture" },
  { id: "concept", label: "컨셉 해석", en: "Concept interpretation" },
  { id: "other", label: "기타", en: "Other" },
];

// Service list from the ChatGPT session — click one to fill SUBJECT.
export const SERVICES = [
  ["이벤트", "다섯 지점을 돌며 스탬프를 모으면 완료되는 이벤트 참여 페이지입니다."],
  ["AI 응원존", "AI가 얼굴을 분석해 응원 스타일 캐릭터를 매칭하고 응원 메시지를 대형 스크린에 실시간 송출"],
  ["휴머노이드 로봇 렌탈", "팝업스토어·전시부스 집객에 강한 휴머노이드 로봇을 커스텀 동작·키오스크 연동까지 상담으로 렌탈하는 장비연동 존입니다."],
  ["AI 드로잉", "드로잉 → AI 3D 변환 → 미디어월 전송 체험"],
  ["AI 도슨트 스탬프 투어", "QR → 모바일 투어 → AI 도슨트 청취 → 자동 스탬프 → 완료 시 AI End Card 생성."],
  ["스탬프 투어", "걸음을 옮길 때마다 경험이 쌓이는, 체험형 스탬프 투어"],
  ["브랜드 블러 퀴즈", "브랜드 힌트를 해독하며 정답을 찾는 이미지 기반 참여형 퀴즈 서비스"],
  ["유형 테스트 퀴즈", "높은 몰입도를 바탕으로 브랜드 메시지를 확산시키며 참여자의 취향 데이터를 정교하게 확보할 수 있습니다."],
  ["AI 페이스 스캔 진단", "카메라 스캔으로 피부 상태를 확인하고 최적의 제품을 제안하는 스마트 진단 이벤트"],
  ["공간 예약", "원하는 공간을 선택하고 바로 예약할 수 있는 실시간 공간 관리 서비스"],
  ["AI 스토리 필름", "선택 키워드로 즉시 완성되는 AI 시네마틱 스토리 영상"],
  ["투표하기", "현장에서 즉시 참여하고 결과를 확인하는 실시간 인터랙티브 투표 서비스"],
  ["랜덤 빙고", "예측 불가한 랜덤 숫자로 즐기는 즉석 참여형 게임 서비스"],
  ["AI 뮤직메이커", "감성과 선택으로 완성되는, 나만의 AI 뮤직 체험"],
  ["사진찍고 덕담받기", "사진 한 장으로 덕담 메시지를 전하는 감성형 인터랙티브 포토 서비스"],
  ["AI 포춘 쿠키", "AI가 오늘의 행운을 예측하여 운세를 전해주는 포춘쿠키 서비스"],
  ["AI 성격분석", "AI가 얼굴 이미지를 분석해 성격 유형을 예측하는 인터랙티브 체험형 콘텐츠"],
  ["무인사물함", "비대면으로 짐을 맡기고 찾는, 현장 운영을 스마트하게 바꾸는 셀프 보관 서비스"],
  ["커스텀 굿즈 만들기", "직접 꾸미고 완성하는, 나만의 굿즈 만들기 체험 서비스"],
  ["SNS 인증", "참여와 홍보가 동시에 이루어지는 자발적 확산형 SNS 인증 서비스"],
  ["AI 부적 만들기", "소원을 선택하면 AI가 디자인과 덕담을 함께 그려주는 생성형 부적 서비스"],
  ["인터랙티브 방명록", "나의 한마디가 공간을 채우는, 디지털 방명 체험 서비스"],
  ["룰렛", "브랜드 콘셉트에 맞게 커스터마이징 가능한 즉석 보상형 룰렛 이벤트"],
  ["스크래치 카드", "손끝으로 긁는 순간, 즉시 반응하는 참여형 스크래치 이벤트 모듈"],
  ["출석체크", "매일의 클릭이 쌓여 리워드로 돌아오는, 지속 참여형 출석 관리 서비스"],
  ["사전 등록", "한 번의 등록으로 참여를 시작하는 간편형 사전 예약 서비스"],
  ["카드 뒤집기 게임", "기억의 즐거움 속에서 브랜드가 자연스럽게 각인되는 인터랙티브 카드 매칭 게임"],
  ["숨은 그림 찾기", "찾는 즐거움 속에 브랜드를 자연스럽게 각인시키는 인터랙티브 미니게임"],
  ["스피드 터치", "순간의 집중과 반응으로 즐거움을 만드는 타이밍형 인터랙티브 미니게임"],
  ["뽑기 머신", "한 번의 터치로 기대감과 즐거움을 동시에 선사하는 랜덤 추첨형 이벤트 모듈"],
  ["웨이팅 발급", "대기마저 즐겁게, 현장을 효율적으로 만드는 실시간 웨이팅 관리"],
  ["타로", "타로 한 장이 전하는 오늘의 영감과 감정, 인터랙티브로 만나는 순간"],
  ["O/X퀴즈", "한 번의 선택으로 즐겁게 배우는, 참여형 OX 퀴즈 콘텐츠"],
  ["퀴즈", "참여와 정답이 동시에 즐거움이 되는 인터랙티브 퀴즈형 이벤트"],
].map(([name, desc]) => ({ name, desc }));
