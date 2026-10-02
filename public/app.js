import { APP_VERSION, OUTPUT, DEFAULT_SECTIONS, HUES, GENDERS, PERSON_KEYWORDS, FEEDBACK_CATEGORIES, SERVICES } from "./template.js";

const $ = (id) => document.getElementById(id);

const serviceSelectEl = $("serviceSelect");
const subjectInputEl = $("subjectInput");
const hueChipsEl = $("hueChips");
const genderChipsEl = $("genderChips");
const personChipsEl = $("personChips");
const personHintEl = $("personHint");
const referenceInputEl = $("referenceInput");
const referenceThumbEl = $("referenceThumb");
const referenceClearEl = $("referenceClear");
const countSelectEl = $("countSelect");
const qualitySelectEl = $("qualitySelect");
const modelSelectEl = $("modelSelect");
const generateBtn = $("generateBtn");
const errorMsgEl = $("errorMsg");
const versionSelectEl = $("versionSelect");
const loadVersionBtn = $("loadVersionBtn");
const sectionEditorsEl = $("sectionEditors");
const versionNoteEl = $("versionNote");
const saveVersionBtn = $("saveVersionBtn");
const promptPreviewEl = $("promptPreview");
const copyPromptBtn = $("copyPromptBtn");
const promptVersionEl = $("promptVersion");
const resultGridEl = $("resultGrid");
const boardTabsEl = $("boardTabs");
const categoryStatsEl = $("categoryStats");
const feedbackListEl = $("feedbackList");
const typeTabsEl = $("typeTabs");
const typeNameEl = $("typeName");
const typeDialogEl = $("typeDialog");
const typeNameInputEl = $("typeNameInput");
const typePromptInputEl = $("typePromptInput");
const typeParseHintEl = $("typeParseHint");
const typeErrorEl = $("typeError");
const typeCreateBtn = $("typeCreateBtn");
const typeManageEl = $("typeManage");

const BASE_VERSION = { version: "v1", sections: DEFAULT_SECTIONS, note: "기본 (ChatGPT 세션)" };

const state = {
  types: [{ id: "icon", name: "새틴 파스텔", builtIn: true }],
  typeId: "icon", // active tab
  versions: [BASE_VERSION],
  loadedVersion: "v1", // version the editors were loaded from
  sections: structuredClone(DEFAULT_SECTIONS),
  assets: {}, // per-version images, e.g. { characterReference: "/images/..." }
  dirty: false, // editors changed since load/save
  hueMode: "random",
  hueCursor: Math.floor(Math.random() * HUES.length),
  personMode: "none", // none | auto
  personSuggested: "none", // what the SUBJECT keywords suggest; a manual pick lasts until this changes
  personKeyword: null,
  genderMode: "random",
  genderCursor: Math.floor(Math.random() * GENDERS.length),
  referenceImage: null,
  models: [],
  results: [],
  feedback: [],
  boardTab: "bad",
  categoryFilter: null,
};

// --- Helpers -----------------------------------------------------------------

function redirectIfUnauthorized(res) {
  if (res.status === 401) {
    window.location.href = "/login.html";
    return true;
  }
  return false;
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (redirectIfUnauthorized(res)) throw new Error("로그인이 필요해요.");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "요청에 실패했어요.");
  return data;
}

function showError(message) {
  errorMsgEl.hidden = !message;
  errorMsgEl.textContent = message ?? "";
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function hueLabel(id) {
  return HUES.find((h) => h.id === id)?.label ?? id;
}

// confirm()/prompt() are auto-dismissed in some embedded browsers (e.g. the
// Claude app's browser pane), so destructive actions use a second click on
// the same button instead: the first click arms it for a few seconds.
function confirmByClick(btn, armedText, action) {
  if (btn.dataset.armed === "1") {
    clearTimeout(Number(btn.dataset.timer));
    btn.dataset.armed = "";
    btn.textContent = btn.dataset.label;
    return action();
  }
  btn.dataset.label = btn.textContent;
  btn.dataset.armed = "1";
  btn.textContent = armedText;
  btn.dataset.timer = String(
    setTimeout(() => {
      btn.dataset.armed = "";
      btn.textContent = btn.dataset.label;
    }, 3000)
  );
}

// Same idea for "you have unsaved edits": warn once, go ahead on the next try.
let unsavedWarnedAt = 0;
function okToDiscardEdits() {
  if (!state.dirty || Date.now() - unsavedWarnedAt < 5000) return true;
  unsavedWarnedAt = Date.now();
  showError("저장 안 한 프롬프트 수정이 있어요. 그래도 넘어가려면 한 번 더 눌러주세요. (저장하려면 '새 버전으로 저장')");
  return false;
}

function currentType() {
  return state.types.find((t) => t.id === state.typeId) ?? state.types[0];
}

// Feedback saved before tabs existed has no type — it belongs to the icon tab.
function feedbackForType() {
  return state.feedback.filter((f) => (f.type ?? "icon") === state.typeId);
}

function currentVersionLabel() {
  return state.dirty ? `${state.loadedVersion} + 수정중` : state.loadedVersion;
}

// --- Prompt building ---------------------------------------------------------

function activeFeedbackLines() {
  return feedbackForType()
    .filter((f) => f.rating === "bad" && f.active && f.memo)
    .map((f) => {
      const cats = f.categories
        .map((c) => FEEDBACK_CATEGORIES.find((fc) => fc.id === c)?.en)
        .filter(Boolean)
        .join(", ");
      return `- ${cats ? `${cats}: ` : ""}${f.memo}`;
    });
}

// Tells the model which attached image is which; numbering matches the order
// the server appends them (variation source, style reference, human reference).
function attachmentsNote(variation) {
  const items = [];
  if (variation) items.push("previous result to vary — follow [VARIATION]");
  if (state.referenceImage) items.push("style reference — use it as described in [REFERENCE RULE]");
  if (state.assets.characterReference && state.personMode !== "none") {
    const label = state.sections.find((s) => s.id === "character")?.label ?? "HUMAN ILLUSTRATION";
    items.push(`human reference — use it only as described in [${label}]`);
  }
  if (!items.length) return null;
  return `[ATTACHED IMAGES]\n${items.map((t, i) => `Image ${i + 1}: ${t}.`).join("\n")}`;
}

// 🔁 배리에이션 modes. The object/icon design from the source image is kept;
// only what the mode names is allowed to change.
const VARIATION_MODES = [
  {
    id: "color",
    label: "🎨 컬러",
    text: "Keep the main object exactly the same as the previous result — same symbol, shapes, silhouette, proportions, angle, composition and materials. Change only the color treatment: use the background hue specified below and re-harmonize the object's colors to match it.",
  },
  {
    id: "composition",
    label: "📐 구도·각도",
    text: "Keep the same main object design as the previous result — same symbol, shapes, details, materials and color palette. Vary only the viewing angle, slight rotation, scale or the arrangement of supporting elements, keeping it one centered icon.",
  },
  {
    id: "custom",
    label: "✍️ 직접",
    text: "Keep the main object design from the previous result — same symbol, shapes and materials. Apply only the change described below.",
  },
];

// 인물 chips. Long human rules in every prompt nudge the model into adding
// people, so the default drops them entirely and "auto" leans hard toward
// objects.
const PERSON_MODES = [
  { id: "none", label: "🙅 사람 없이" },
  { id: "auto", label: "🧑 사람 포함" },
];

const NO_PEOPLE_BLOCK = `[NO PEOPLE — PRIORITY]
Do not depict any people, faces, heads, hands, silhouettes or human figures. Communicate SUBJECT with objects, devices and symbols only.`;

function personLines(gender) {
  const g = GENDERS.find((x) => x.id === gender) ?? GENDERS[0];
  const who = `depict ${g.en}; for several people, make ${g.en} the main person. Use the human reference only for drawing style, never for gender, age or appearance.`;
  // Only reached when the user turned people on (or a face/photo keyword did),
  // so this asks for a person rather than merely allowing one.
  return `People are allowed for this SUBJECT. If SUBJECT involves people — faces, photos, personality, cheering, or users interacting with the service — include one person as a clear part of the icon, combined with the main symbol. Keep it to a single person unless the concept needs more. ${who[0].toUpperCase()}${who.slice(1)}`;
}

function buildPrompt(subject, hue, variation = null, gender = previewGender()) {
  const blocks = state.sections
    .filter((s) => !(state.personMode === "none" && s.id === "character"))
    .map((s) => {
      const text = s.text.replaceAll("{{SUBJECT}}", subject || "(SUBJECT)").replaceAll("{{BACKGROUND_HUE}}", hue);
      return `[${s.label}]\n${text}${s.id === "character" ? `\n${personLines(gender)}` : ""}`;
    });
  if (state.personMode === "none") blocks.push(NO_PEOPLE_BLOCK);
  else if (!state.sections.some((s) => s.id === "character")) blocks.push(`[PERSON]\n${personLines(gender)}`);
  if (variation) {
    const mode = VARIATION_MODES.find((m) => m.id === variation.mode) ?? VARIATION_MODES[0];
    let extra = variation.memo ? `\nChange requested: ${variation.memo}` : "";
    // 🎨 on a tab without a hue slot: there's no "background hue specified below" to point at.
    if (mode.id === "color" && !hue) extra = `\nPick a clearly different color palette from the previous result, following the color rules below.${extra}`;
    blocks.unshift(`[VARIATION — HIGHEST PRIORITY]\nThe first attached image is a previous result the user liked. ${mode.text}${extra}`);
  }
  const note = attachmentsNote(variation);
  if (note) blocks.push(note);
  const lines = activeFeedbackLines();
  if (lines.length) {
    blocks.push(`[FEEDBACK — FIX THESE ISSUES SEEN IN PREVIOUS RESULTS]\n${lines.join("\n")}`);
  }
  return blocks.join("\n");
}

function previewGender() {
  return state.genderMode === "random" ? GENDERS[state.genderCursor].id : state.genderMode;
}

function nextGender() {
  if (state.genderMode !== "random") return state.genderMode;
  const gender = GENDERS[state.genderCursor].id;
  state.genderCursor = (state.genderCursor + 1) % GENDERS.length;
  return gender;
}

function previewHue() {
  return state.hueMode === "random" ? HUES[state.hueCursor].id : state.hueMode;
}

// Tabs whose prompt picks its own background (no {{BACKGROUND_HUE}} slot)
// hide the hue chips and don't record a hue on results.
function usesHue() {
  return state.sections.some((s) => s.text.includes("{{BACKGROUND_HUE}}"));
}

function nextHue() {
  if (!usesHue()) return null;
  if (state.hueMode !== "random") return state.hueMode;
  const hue = HUES[state.hueCursor].id;
  state.hueCursor = (state.hueCursor + 1) % HUES.length;
  return hue;
}

function updatePreview() {
  hueChipsEl.closest(".field").hidden = !usesHue();
  promptPreviewEl.value = buildPrompt(subjectInputEl.value.trim(), previewHue());
  promptVersionEl.textContent = currentVersionLabel();
  typeNameEl.textContent = currentType().name;
}

// --- Inputs ------------------------------------------------------------------

function renderServices() {
  // Optional shortcut only — SUBJECT is free text and new services show up all the time.
  serviceSelectEl.append(el("option", { value: "", textContent: "📋 기존 서비스 목록에서 불러오기 (선택)" }));
  SERVICES.forEach((s, i) => serviceSelectEl.append(el("option", { value: String(i), textContent: `${i + 1}. ${s.name}` })));
  serviceSelectEl.addEventListener("change", () => {
    const s = SERVICES[Number(serviceSelectEl.value)];
    if (serviceSelectEl.value !== "" && s) subjectInputEl.value = `${s.name} — ${s.desc}`;
    serviceSelectEl.value = "";
    suggestPersonMode();
    updatePreview();
  });
  subjectInputEl.addEventListener("input", () => {
    suggestPersonMode();
    updatePreview();
  });
}

function renderHues() {
  hueChipsEl.innerHTML = "";
  const options = [{ id: "random", label: "🎲 랜덤 순환" }, ...HUES];
  options.forEach((h) => {
    const chip = el("button", { type: "button", className: `chip${state.hueMode === h.id ? " selected" : ""}` });
    if (h.swatch) chip.append(el("span", { className: "swatch", style: `background:${h.swatch}` }));
    chip.append(h.label);
    chip.addEventListener("click", () => {
      state.hueMode = h.id;
      renderHues();
      updatePreview();
    });
    hueChipsEl.appendChild(chip);
  });
}

// Re-evaluated on every SUBJECT edit, but only overrides the chips when the
// suggestion itself flips — so a manual pick isn't undone while typing.
function suggestPersonMode() {
  const subject = subjectInputEl.value.toLowerCase();
  const keyword = PERSON_KEYWORDS.find((k) => subject.includes(k.toLowerCase())) ?? null;
  const suggested = keyword ? "auto" : "none";
  state.personKeyword = keyword;
  if (suggested !== state.personSuggested) {
    state.personSuggested = suggested;
    state.personMode = suggested;
  }
  renderGenders();
}

function renderGenders() {
  personHintEl.hidden = !(state.personKeyword && state.personMode === "auto");
  personHintEl.textContent = `SUBJECT에 "${state.personKeyword}"이(가) 있어서 자동으로 '사람 포함'으로 바꿨어요.`;
  personChipsEl.innerHTML = "";
  PERSON_MODES.forEach((m) => {
    const chip = el("button", { type: "button", className: `chip${state.personMode === m.id ? " selected" : ""}`, textContent: m.label });
    chip.addEventListener("click", () => {
      state.personMode = m.id;
      renderGenders();
      updatePreview();
    });
    personChipsEl.appendChild(chip);
  });
  genderChipsEl.hidden = state.personMode === "none";
  genderChipsEl.innerHTML = "";
  [{ id: "random", label: "🎲 번갈아" }, ...GENDERS].forEach((g) => {
    const chip = el("button", { type: "button", className: `chip${state.genderMode === g.id ? " selected" : ""}`, textContent: g.label });
    chip.addEventListener("click", () => {
      state.genderMode = g.id;
      renderGenders();
      updatePreview();
    });
    genderChipsEl.appendChild(chip);
  });
}

function setupReference() {
  referenceInputEl.addEventListener("change", () => {
    const file = referenceInputEl.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.referenceImage = reader.result;
      referenceThumbEl.src = reader.result;
      referenceThumbEl.hidden = false;
      referenceClearEl.hidden = false;
      updatePreview();
    };
    reader.readAsDataURL(file);
  });
  referenceClearEl.addEventListener("click", () => {
    state.referenceImage = null;
    referenceInputEl.value = "";
    referenceThumbEl.hidden = true;
    referenceClearEl.hidden = true;
    updatePreview();
  });
}

const MODEL_LABELS = {
  "gpt-image-2.5-sunburst": "GPT Image 2.5 Sunburst — 디테일 (ChatGPT 최신)",
  "gpt-image-2.5-flare": "GPT Image 2.5 Flare — 빠름",
  "gpt-image-2": "GPT Image 2",
  "gpt-image-1": "gpt-image-1 (구버전)",
};

function renderQualities() {
  const model = state.models.find((m) => m.id === modelSelectEl.value);
  const prev = qualitySelectEl.value || "auto";
  qualitySelectEl.innerHTML = "";
  (model?.qualities ?? ["auto"]).forEach((q) => qualitySelectEl.append(el("option", { value: q, textContent: q })));
  qualitySelectEl.value = model?.qualities.includes(prev) ? prev : "auto";
}

function renderModels(models, defaultModel) {
  state.models = models;
  modelSelectEl.innerHTML = "";
  models.forEach((m) => modelSelectEl.append(el("option", { value: m.id, textContent: MODEL_LABELS[m.id] ?? m.id })));
  modelSelectEl.value = defaultModel;
  renderQualities();
}

// --- Prompt editor + versions ------------------------------------------------

function renderEditors() {
  sectionEditorsEl.innerHTML = "";
  state.sections.forEach((s) => {
    const textarea = el("textarea", { className: "input", rows: Math.min(8, s.text.split("\n").length + 2), value: s.text });
    textarea.addEventListener("input", () => {
      s.text = textarea.value;
      state.dirty = true;
      updatePreview();
    });
    sectionEditorsEl.append(el("label", { className: "label", textContent: `[${s.label}]` }, [textarea]));
    if (s.id === "character") sectionEditorsEl.append(renderCharacterReference());
  });
}

// Re-encodes as PNG so the server can store/forward it with a known type.
async function toPngDataUrl(file) {
  const src = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const img = await loadImage(src);
  const canvas = el("canvas", { width: img.naturalWidth, height: img.naturalHeight });
  canvas.getContext("2d").drawImage(img, 0, 0);
  return canvas.toDataURL("image/png");
}

function renderCharacterReference() {
  const url = state.assets.characterReference;
  const input = el("input", { type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true });
  const pick = el("button", { type: "button", className: "ghost-btn", textContent: url ? "바꾸기" : "사람 레퍼런스 올리기" });
  pick.addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const data = await api("/api/assets", { method: "POST", body: JSON.stringify({ image: await toPngDataUrl(file) }) });
      state.assets = { ...state.assets, characterReference: data.url };
      state.dirty = true;
      renderEditors();
      updatePreview();
    } catch (err) {
      showError(err.message);
    }
  });

  const row = el("div", { className: "reference-row" }, [el("span", { className: "label", textContent: "🧑 사람 레퍼런스" }), pick, input]);
  if (url) {
    const clear = el("button", { type: "button", className: "link-btn", textContent: "지우기" });
    clear.addEventListener("click", () => {
      const { characterReference, ...rest } = state.assets;
      state.assets = rest;
      state.dirty = true;
      renderEditors();
      updatePreview();
    });
    row.append(el("img", { className: "reference-thumb", src: url, alt: "사람 레퍼런스" }), clear);
  }
  return el("div", { className: "character-ref" }, [row]);
}

function renderVersionSelect() {
  versionSelectEl.innerHTML = "";
  [...state.versions].reverse().forEach((v) => {
    versionSelectEl.append(el("option", { value: v.version, textContent: `${v.version}${v.note ? ` — ${v.note}` : ""}` }));
  });
  versionSelectEl.value = state.loadedVersion;
}

function loadVersion(version) {
  const v = state.versions.find((x) => x.version === version);
  if (!v) return;
  state.sections = structuredClone(v.sections);
  state.assets = { ...(v.assets ?? {}) };
  state.loadedVersion = v.version;
  state.dirty = false;
  renderEditors();
  renderVersionSelect();
  updatePreview();
}

async function saveVersion() {
  try {
    const data = await api("/api/template", {
      method: "POST",
      body: JSON.stringify({ type: state.typeId, sections: state.sections, assets: state.assets, note: versionNoteEl.value }),
    });
    state.versions = withBase(data.versions);
    state.loadedVersion = data.versions.at(-1).version;
    state.dirty = false;
    versionNoteEl.value = "";
    renderVersionSelect();
    updatePreview();
  } catch (err) {
    showError(err.message);
  }
}

// --- Image type tabs ---------------------------------------------------------

function withBase(versions) {
  return currentType().builtIn ? [BASE_VERSION, ...versions] : versions;
}

function renderTypeTabs() {
  typeTabsEl.innerHTML = "";
  state.types.forEach((t) => {
    const tab = el("button", { type: "button", className: `type-tab${t.id === state.typeId ? " selected" : ""}`, textContent: t.name });
    tab.addEventListener("click", () => switchType(t.id));
    typeTabsEl.appendChild(tab);
  });
  const add = el("button", { type: "button", className: "type-tab add", textContent: "+ 새 타입" });
  add.addEventListener("click", openTypeDialog);
  typeTabsEl.appendChild(add);
  $("deleteTypeBtn").hidden = !!currentType().builtIn; // built-in tabs can be renamed, not deleted
}

async function switchType(id, { force = false } = {}) {
  if (!force && id === state.typeId) return;
  if (!force && !okToDiscardEdits()) return;
  showError(null);
  state.typeId = id;
  state.boardTab = "bad";
  state.categoryFilter = null;
  renderTypeTabs();
  try {
    const data = await api(`/api/template?type=${encodeURIComponent(id)}`);
    state.versions = withBase(data.versions);
    loadVersion(state.versions.at(-1).version);
  } catch (err) {
    showError(err.message);
  }
  renderResults();
  renderBoard();
  updatePreview();
}

// Splits a pasted prompt on "[SECTION NAME]" heading lines. ChatGPT copies
// sometimes end lines with a stray backslash, so those are stripped.
function parsePrompt(text) {
  const sections = [];
  text
    .replace(/\\\s*$/gm, "")
    .split("\n")
    .forEach((line) => {
      const heading = /^\s*\[(.+?)\]\s*$/.exec(line);
      if (heading) sections.push({ label: heading[1].trim(), lines: [] });
      else if (sections.length) sections.at(-1).lines.push(line);
    });
  return sections.map(({ label, lines }) => {
    const upper = label.toUpperCase();
    const id = upper === "SUBJECT" ? "subject" : upper.includes("HUMAN") ? "character" : upper.replace(/[^A-Z0-9]+/g, "-").toLowerCase();
    // SUBJECT is filled per generation, so whatever was pasted there was an example.
    return { id, label, text: id === "subject" ? "{{SUBJECT}}" : lines.join("\n").trim() };
  });
}

function sectionsForNewType() {
  if (typeSource() === "copy") return structuredClone(state.sections);
  const sections = parsePrompt(typePromptInputEl.value);
  if (sections.length && !sections.some((s) => s.id === "subject")) {
    sections.unshift({ id: "subject", label: "SUBJECT", text: "{{SUBJECT}}" });
  }
  return sections;
}

function typeSource() {
  return typeDialogEl.querySelector('input[name="typeSource"]:checked').value;
}

function updateTypeDialog() {
  const paste = typeSource() === "paste";
  typePromptInputEl.hidden = !paste;
  typeParseHintEl.hidden = !paste;
  if (paste) {
    const sections = sectionsForNewType();
    const hasHue = sections.some((s) => s.text.includes("{{BACKGROUND_HUE}}"));
    typeParseHintEl.textContent = sections.length
      ? `섹션 ${sections.length}개: ${sections.map((s) => s.label).join(" · ")}${hasHue ? "" : " — 배경 컬러를 넣을 자리({{BACKGROUND_HUE}})가 없어서 컬러 선택은 적용 안 돼요."}`
      : "[대괄호 제목] 줄을 못 찾았어요. 예: [SUBJECT], [STYLE & TEXTURE]";
  }
}

function openTypeDialog() {
  typeNameInputEl.value = "";
  typePromptInputEl.value = "";
  typeErrorEl.hidden = true;
  typeDialogEl.querySelector('input[value="copy"]').checked = true;
  updateTypeDialog();
  typeDialogEl.showModal();
  typeNameInputEl.focus();
}

async function createType() {
  const name = typeNameInputEl.value.trim();
  const sections = sectionsForNewType();
  const fail = (msg) => {
    typeErrorEl.textContent = msg;
    typeErrorEl.hidden = false;
  };
  if (!name) return fail("탭 이름을 입력해주세요.");
  if (!sections.length) return fail("프롬프트를 붙여넣어주세요. [대괄호 제목] 기준으로 섹션이 나뉘어요.");
  if (state.dirty && Date.now() - unsavedWarnedAt > 5000) {
    unsavedWarnedAt = Date.now();
    return fail("지금 탭에 저장 안 한 수정이 있어요. 새 탭으로 넘어가면 사라져요. 괜찮으면 '만들기'를 한 번 더 눌러주세요.");
  }

  typeCreateBtn.disabled = true;
  try {
    const data = await api("/api/types", { method: "POST", body: JSON.stringify({ name, sections }) });
    state.types = data.types;
    typeDialogEl.close();
    state.dirty = false;
    await switchType(data.type.id, { force: true });
  } catch (err) {
    fail(err.message);
  } finally {
    typeCreateBtn.disabled = false;
  }
}

// Inline rename field (prompt() isn't reliable in embedded browsers).
function renameType() {
  const btn = $("renameTypeBtn");
  if (typeManageEl.querySelector("input")) return;
  const input = el("input", { className: "input small", value: currentType().name, maxLength: 30 });
  const save = el("button", { type: "button", className: "ghost-btn", textContent: "저장" });
  const done = () => {
    input.remove();
    save.remove();
    btn.hidden = false;
  };
  save.addEventListener("click", async () => {
    await submitRename(input.value.trim());
    done();
  });
  input.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      await submitRename(input.value.trim());
      done();
    } else if (e.key === "Escape") done();
  });
  btn.hidden = true;
  typeManageEl.prepend(input, save);
  input.focus();
  input.select();
}

async function submitRename(name) {
  if (!name || name === currentType().name) return;
  try {
    const data = await api(`/api/types/${state.typeId}`, { method: "PATCH", body: JSON.stringify({ name }) });
    state.types = data.types;
    renderTypeTabs();
    updatePreview();
  } catch (err) {
    showError(err.message);
  }
}

function deleteType() {
  confirmByClick($("deleteTypeBtn"), "한 번 더 누르면 탭 삭제", removeType);
}

// Saved prompt versions and feedback stay in storage; only the tab goes away.
async function removeType() {
  try {
    const data = await api(`/api/types/${state.typeId}`, { method: "DELETE" });
    state.types = data.types;
    state.dirty = false;
    await switchType("icon", { force: true });
  } catch (err) {
    showError(err.message);
  }
}

// --- Generation --------------------------------------------------------------

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("이미지를 불러오지 못했어요."));
    img.src = src;
  });
}

// Center-crops to 251:155. Returns a full-res crop for viewing and the exact
// 502×310 deliverable.
async function cropOutput(dataUrl) {
  const img = await loadImage(dataUrl);
  const aspect = OUTPUT.width / OUTPUT.height;
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (w / h > aspect) w = Math.round(h * aspect);
  else h = Math.round(w / aspect);
  const sx = Math.round((img.naturalWidth - w) / 2);
  const sy = Math.round((img.naturalHeight - h) / 2);

  const draw = (cw, ch) => {
    const canvas = el("canvas", { width: cw, height: ch });
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, w, h, 0, 0, cw, ch);
    return canvas.toDataURL("image/png");
  };
  return { full: draw(w, h), output: draw(OUTPUT.width, OUTPUT.height) };
}

async function generate() {
  const subject = subjectInputEl.value.trim();
  if (!subject) {
    showError("SUBJECT를 입력해주세요.");
    return;
  }
  const count = Number(countSelectEl.value) || 1;
  const promptVersion = currentVersionLabel();
  await runBatch(
    Array.from({ length: count }, () => {
      const hue = nextHue();
      const gender = nextGender();
      return { subject, hue, gender, promptVersion, prompt: buildPrompt(subject, hue, null, gender) };
    })
  );
}

// Same object, new take: sends the liked result back as the first image.
async function generateVariations(source, mode, memo, count) {
  const variation = { mode, memo: memo.trim() };
  const modeLabel = VARIATION_MODES.find((m) => m.id === mode)?.label ?? mode;
  await runBatch(
    Array.from({ length: count }, () => {
      let hue = source.hue;
      if (mode === "color") {
        hue = nextHue();
        if (hue === source.hue) hue = nextHue();
      }
      return {
        subject: source.subject,
        hue,
        gender: source.gender,
        promptVersion: `${currentVersionLabel()} · ${modeLabel}`,
        prompt: buildPrompt(source.subject, hue, variation, source.gender),
        sourceImage: source.full,
        parentId: source.id,
      };
    })
  );
}

async function runBatch(items) {
  showError(null);
  const quality = qualitySelectEl.value;
  const model = modelSelectEl.value;
  const batch = items.map((item) => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    status: "loading",
    model,
    typeId: state.typeId,
    ...item,
  }));
  state.results = [...batch, ...state.results];
  renderResults();
  updatePreview();

  generateBtn.disabled = true;
  await Promise.all(
    batch.map(async (r) => {
      try {
        const data = await api("/api/generate", {
          method: "POST",
          body: JSON.stringify({
            prompt: r.prompt,
            sourceImage: r.sourceImage,
            referenceImage: state.referenceImage,
            characterReference: state.personMode === "none" ? undefined : state.assets.characterReference,
            quality,
            model,
          }),
        });
        Object.assign(r, await cropOutput(data.image), { status: "done" });
      } catch (err) {
        Object.assign(r, { status: "error", error: err.message });
      }
      delete r.sourceImage; // don't keep a second copy of the parent image around
      renderResults();
    })
  );
  generateBtn.disabled = false;
}

function download(r) {
  const a = el("a", { href: r.output, download: `${[r.subject.split("—")[0].trim(), r.hue].filter(Boolean).join("-")}-${OUTPUT.width}x${OUTPUT.height}.png` });
  a.click();
}

// Copies the 502×310 deliverable (same file as the download button).
// The blob is handed over as a Promise so clipboard.write() runs right inside
// the click — Safari rejects the write if anything is awaited before it.
async function copyImage(r, btn) {
  try {
    const blob = fetch(r.output).then((res) => res.blob());
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    btn.textContent = "복사됨!";
  } catch (err) {
    btn.textContent = "복사 실패";
    showError(`이미지 복사가 막혔어요 (${err.name}). 이미지를 우클릭 → "이미지 복사"로 복사하거나 ⬇ 다운로드를 써주세요.`);
  }
  setTimeout(() => (btn.textContent = "📋 복사"), 1400);
}

// --- Result cards --------------------------------------------------------------

async function sendFeedback(r, rating, categories = [], memo = "") {
  const data = await api("/api/feedback", {
    method: "POST",
    body: JSON.stringify({
      rating,
      categories,
      memo,
      subject: r.subject,
      hue: r.hue,
      promptVersion: r.promptVersion,
      model: r.model,
      type: r.typeId,
      image: r.output,
    }),
  });
  state.feedback = data.feedback;
  r.rating = rating;
  renderResults();
  renderBoard();
  updatePreview();
}

function renderBadForm(r, container) {
  const picked = new Set();
  const chips = el("div", { className: "chips" });
  FEEDBACK_CATEGORIES.forEach((c) => {
    const chip = el("button", { type: "button", className: "chip bad", textContent: c.label });
    chip.addEventListener("click", () => {
      picked.has(c.id) ? picked.delete(c.id) : picked.add(c.id);
      chip.classList.toggle("selected");
    });
    chips.appendChild(chip);
  });
  const memo = el("textarea", {
    className: "input",
    rows: 2,
    placeholder: "뭐가 별로였어? (예: 아이콘이 너무 작고 여백이 과함 / 룰렛이 너무 사실적)",
  });
  const save = el("button", { type: "button", className: "ghost-btn full", textContent: "👎 저장" });
  save.addEventListener("click", async () => {
    if (!picked.size && !memo.value.trim()) return;
    save.disabled = true;
    try {
      await sendFeedback(r, "bad", [...picked], memo.value);
    } catch (err) {
      save.disabled = false;
      showError(err.message);
    }
  });
  container.append(el("div", { className: "bad-form" }, [chips, memo, save]));
  memo.focus();
}

function renderVariationForm(r, container) {
  let mode = "color";
  const chips = el("div", { className: "chips" });
  VARIATION_MODES.forEach((m) => {
    const chip = el("button", { type: "button", className: `chip${m.id === mode ? " selected" : ""}`, textContent: m.label });
    chip.addEventListener("click", () => {
      mode = m.id;
      chips.querySelectorAll(".chip").forEach((c) => c.classList.toggle("selected", c === chip));
    });
    chips.appendChild(chip);
  });
  const memo = el("textarea", {
    className: "input",
    rows: 2,
    placeholder: "추가로 바꿀 점 (선택, ✍️ 직접은 필수) 예: 포인터를 위쪽으로, 좀 더 귀엽게",
  });
  const count = el("select", { className: "input small" }, ["1", "2", "4"].map((n) => el("option", { value: n, textContent: `${n}장` })));
  count.value = "2";
  const go = el("button", { type: "button", className: "ghost-btn", textContent: "🔁 만들기" });
  go.addEventListener("click", () => {
    if (mode === "custom" && !memo.value.trim()) {
      memo.focus();
      return;
    }
    form.remove();
    generateVariations(r, mode, memo.value, Number(count.value));
  });
  const form = el("div", { className: "bad-form" }, [chips, memo, el("div", { className: "variation-actions" }, [count, go])]);
  container.append(form);
}

function removeResult(r) {
  state.results = state.results.filter((x) => x !== r);
  renderResults();
}

function renderResults() {
  resultGridEl.innerHTML = "";
  const results = state.results.filter((r) => r.typeId === state.typeId);
  if (!results.length) {
    resultGridEl.append(el("p", { className: "placeholder", textContent: "생성하면 여기에 표시돼요." }));
    return;
  }
  results.forEach((r) => {
    const card = el("div", { className: "card" });
    if (r.status !== "loading") {
      // Only clears it from the screen; 👍/👎 records on the board stay.
      const remove = el("button", { type: "button", className: "card-remove", textContent: "✕", title: "화면에서 지우기" });
      remove.addEventListener("click", () => removeResult(r));
      card.append(remove);
    }
    if (r.status === "loading") card.append(el("div", { className: "card-loading", textContent: "생성 중..." }));
    else if (r.status === "error") card.append(el("div", { className: "card-loading", textContent: `실패: ${r.error}` }));
    else card.append(el("img", { className: "card-image", src: r.full, alt: r.subject }));

    const body = el("div", { className: "card-body" });
    const swatch = HUES.find((h) => h.id === r.hue)?.swatch;
    body.append(
      el("div", { className: "card-meta" }, [
        ...(swatch ? [el("span", { className: "swatch", style: `background:${swatch}` })] : []),
        [r.hue && hueLabel(r.hue), r.promptVersion, r.model.replace("gpt-image-", ""), r.subject.split("—")[0].trim()].filter(Boolean).join(" · "),
      ])
    );

    if (r.status === "done") {
      const good = el("button", { type: "button", className: `ghost-btn${r.rating === "good" ? " done" : ""}`, textContent: "👍 좋아" });
      const bad = el("button", { type: "button", className: `ghost-btn${r.rating === "bad" ? " done-bad" : ""}`, textContent: "👎 별로" });
      const dl = el("button", { type: "button", className: "ghost-btn", textContent: "⬇ 502×310" });
      good.disabled = bad.disabled = !!r.rating;
      good.addEventListener("click", () => sendFeedback(r, "good").catch((e) => showError(e.message)));
      bad.addEventListener("click", () => {
        bad.disabled = true;
        renderBadForm(r, body);
      });
      dl.addEventListener("click", () => download(r));
      const copy = el("button", { type: "button", className: "ghost-btn", textContent: "📋 복사" });
      copy.addEventListener("click", () => copyImage(r, copy));
      const vary = el("button", { type: "button", className: "ghost-btn vary-btn", textContent: "🔁 배리에이션" });
      vary.addEventListener("click", () => {
        if (body.querySelector(".bad-form")) return;
        renderVariationForm(r, body);
      });
      body.append(el("div", { className: "card-actions" }, [good, bad, copy, dl]), vary);
    }
    card.append(body);
    resultGridEl.appendChild(card);
  });
}

// --- Feedback board ------------------------------------------------------------

async function patchFeedback(id, patch) {
  const data = await api(`/api/feedback/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
  state.feedback = data.feedback;
  renderBoard();
  updatePreview();
}

async function deleteFeedback(id) {
  const data = await api(`/api/feedback/${encodeURIComponent(id)}`, { method: "DELETE" });
  state.feedback = data.feedback;
  renderBoard();
  updatePreview();
}

function renderBoard() {
  const bad = feedbackForType().filter((f) => f.rating === "bad");
  const good = feedbackForType().filter((f) => f.rating === "good");

  boardTabsEl.innerHTML = "";
  [
    ["bad", `👎 별로 (${bad.length})`],
    ["good", `👍 좋아 (${good.length})`],
  ].forEach(([id, label]) => {
    const chip = el("button", { type: "button", className: `chip${state.boardTab === id ? " selected" : ""}`, textContent: label });
    chip.addEventListener("click", () => {
      state.boardTab = id;
      state.categoryFilter = null;
      renderBoard();
    });
    boardTabsEl.appendChild(chip);
  });

  categoryStatsEl.innerHTML = "";
  if (state.boardTab === "bad") {
    FEEDBACK_CATEGORIES.forEach((c) => {
      const n = bad.filter((f) => f.categories.includes(c.id)).length;
      if (!n) return;
      const chip = el("button", {
        type: "button",
        className: `chip bad${state.categoryFilter === c.id ? " selected" : ""}`,
        textContent: `${c.label} ${n}`,
      });
      chip.addEventListener("click", () => {
        state.categoryFilter = state.categoryFilter === c.id ? null : c.id;
        renderBoard();
      });
      categoryStatsEl.appendChild(chip);
    });
  }

  let list = state.boardTab === "bad" ? bad : good;
  if (state.categoryFilter) list = list.filter((f) => f.categories.includes(state.categoryFilter));

  feedbackListEl.innerHTML = "";
  if (!list.length) {
    feedbackListEl.append(el("p", { className: "empty", textContent: "아직 없어요." }));
    return;
  }

  list.forEach((f) => {
    const card = el("div", { className: `fb-card${f.rating === "bad" && !f.active ? " inactive" : ""}` });
    if (f.image) card.append(el("img", { src: f.image, alt: f.subject, loading: "lazy" }));

    const body = el("div", { className: "fb-body" });
    body.append(el("div", { className: "fb-subject", textContent: f.subject, title: f.subject }));
    if (f.categories.length) {
      body.append(
        el(
          "div",
          { className: "fb-tags" },
          f.categories.map((c) => el("span", { className: "fb-tag", textContent: FEEDBACK_CATEGORIES.find((fc) => fc.id === c)?.label ?? c }))
        )
      );
    }
    if (f.memo) body.append(el("p", { className: "fb-memo", textContent: f.memo }));

    const foot = el("div", { className: "fb-foot" });
    if (f.rating === "bad") {
      const toggle = el("input", { type: "checkbox", checked: f.active, disabled: !f.memo });
      toggle.addEventListener("change", () => patchFeedback(f.id, { active: toggle.checked }).catch((e) => showError(e.message)));
      foot.append(el("label", { title: f.memo ? "" : "메모가 있어야 프롬프트에 들어가요" }, [toggle, "반영"]));
    }
    foot.append(el("span", { textContent: [f.promptVersion, f.model?.replace("gpt-image-", ""), f.hue && hueLabel(f.hue)].filter(Boolean).join(" · ") }));
    const del = el("button", { type: "button", className: "link-btn", textContent: "삭제" });
    del.addEventListener("click", () =>
      confirmByClick(del, "한 번 더 누르면 삭제", () => {
        del.disabled = true;
        del.textContent = "삭제 중...";
        return deleteFeedback(f.id).catch((e) => {
          del.disabled = false;
          del.textContent = "삭제";
          showError(e.message);
        });
      })
    );
    foot.append(del);
    body.append(foot);

    card.append(body);
    feedbackListEl.appendChild(card);
  });
}

// --- Init ------------------------------------------------------------------------

async function init() {
  $("appVersion").textContent = APP_VERSION;
  renderServices();
  renderHues();
  renderGenders();
  setupReference();
  renderEditors();
  renderResults();

  generateBtn.addEventListener("click", generate);
  modelSelectEl.addEventListener("change", renderQualities);
  loadVersionBtn.addEventListener("click", () => loadVersion(versionSelectEl.value));
  saveVersionBtn.addEventListener("click", saveVersion);
  copyPromptBtn.addEventListener("click", () => navigator.clipboard.writeText(promptPreviewEl.value));
  typeCreateBtn.addEventListener("click", createType);
  // Enter in the name field submits the dialog form — treat it as "만들기", not close.
  typeDialogEl.querySelector("form").addEventListener("submit", (e) => {
    if (e.submitter?.value === "cancel") return;
    e.preventDefault();
    createType();
  });
  typeDialogEl.querySelectorAll('input[name="typeSource"]').forEach((r) => r.addEventListener("change", updateTypeDialog));
  typePromptInputEl.addEventListener("input", updateTypeDialog);
  $("renameTypeBtn").addEventListener("click", renameType);
  $("deleteTypeBtn").addEventListener("click", deleteType);
  renderTypeTabs();

  try {
    const [types, feedback, models] = await Promise.all([api("/api/types"), api("/api/feedback"), api("/api/models")]);
    renderModels(models.models, models.defaultModel);
    state.types = types.types;
    state.feedback = feedback.feedback;
    // Opens the icon tab on its newest saved version so tuning picks up where it left off.
    await switchType("icon", { force: true });
  } catch (err) {
    showError(err.message);
  }
}

init();
