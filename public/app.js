import { APP_VERSION, OUTPUT, DEFAULT_SECTIONS, HUES, FEEDBACK_CATEGORIES, SERVICES } from "./template.js";

const $ = (id) => document.getElementById(id);

const serviceSelectEl = $("serviceSelect");
const subjectInputEl = $("subjectInput");
const hueChipsEl = $("hueChips");
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

const BASE_VERSION = { version: "v1", sections: DEFAULT_SECTIONS, note: "기본 (ChatGPT 세션)" };

const state = {
  versions: [BASE_VERSION],
  loadedVersion: "v1", // version the editors were loaded from
  sections: structuredClone(DEFAULT_SECTIONS),
  assets: {}, // per-version images, e.g. { characterReference: "/images/..." }
  dirty: false, // editors changed since load/save
  hueMode: "random",
  hueCursor: Math.floor(Math.random() * HUES.length),
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

function currentVersionLabel() {
  return state.dirty ? `${state.loadedVersion} + 수정중` : state.loadedVersion;
}

// --- Prompt building ---------------------------------------------------------

function activeFeedbackLines() {
  return state.feedback
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
// the server appends them (style reference first, then character reference).
function attachmentsNote() {
  const items = [];
  if (state.referenceImage) items.push("style reference — use it as described in [REFERENCE RULE]");
  if (state.assets.characterReference) {
    const label = state.sections.find((s) => s.id === "character")?.label ?? "HUMAN ILLUSTRATION";
    items.push(`human reference — use it only as described in [${label}]`);
  }
  if (!items.length) return null;
  return `[ATTACHED IMAGES]\n${items.map((t, i) => `Image ${i + 1}: ${t}.`).join("\n")}`;
}

function buildPrompt(subject, hue) {
  const blocks = state.sections.map(
    (s) => `[${s.label}]\n${s.text.replaceAll("{{SUBJECT}}", subject || "(SUBJECT)").replaceAll("{{BACKGROUND_HUE}}", hue)}`
  );
  const note = attachmentsNote();
  if (note) blocks.push(note);
  const lines = activeFeedbackLines();
  if (lines.length) {
    blocks.push(`[FEEDBACK — FIX THESE ISSUES SEEN IN PREVIOUS RESULTS]\n${lines.join("\n")}`);
  }
  return blocks.join("\n");
}

function previewHue() {
  return state.hueMode === "random" ? HUES[state.hueCursor].id : state.hueMode;
}

function nextHue() {
  if (state.hueMode !== "random") return state.hueMode;
  const hue = HUES[state.hueCursor].id;
  state.hueCursor = (state.hueCursor + 1) % HUES.length;
  return hue;
}

function updatePreview() {
  promptPreviewEl.value = buildPrompt(subjectInputEl.value.trim(), previewHue());
  promptVersionEl.textContent = currentVersionLabel();
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
    updatePreview();
  });
  subjectInputEl.addEventListener("input", updatePreview);
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
      body: JSON.stringify({ sections: state.sections, assets: state.assets, note: versionNoteEl.value }),
    });
    state.versions = [BASE_VERSION, ...data.versions];
    state.loadedVersion = data.versions.at(-1).version;
    state.dirty = false;
    versionNoteEl.value = "";
    renderVersionSelect();
    updatePreview();
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
  showError(null);

  const count = Number(countSelectEl.value) || 1;
  const quality = qualitySelectEl.value;
  const model = modelSelectEl.value;
  const promptVersion = currentVersionLabel();
  const batch = Array.from({ length: count }, () => {
    const hue = nextHue();
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      status: "loading",
      subject,
      hue,
      promptVersion,
      model,
      prompt: buildPrompt(subject, hue),
    };
  });
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
            referenceImage: state.referenceImage,
            characterReference: state.assets.characterReference,
            quality,
            model,
          }),
        });
        Object.assign(r, await cropOutput(data.image), { status: "done" });
      } catch (err) {
        Object.assign(r, { status: "error", error: err.message });
      }
      renderResults();
    })
  );
  generateBtn.disabled = false;
}

function download(r) {
  const a = el("a", { href: r.output, download: `${r.subject.split("—")[0].trim()}-${r.hue}-${OUTPUT.width}x${OUTPUT.height}.png` });
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
    body: JSON.stringify({ rating, categories, memo, subject: r.subject, hue: r.hue, promptVersion: r.promptVersion, model: r.model, image: r.output }),
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

function renderResults() {
  resultGridEl.innerHTML = "";
  if (!state.results.length) {
    resultGridEl.append(el("p", { className: "placeholder", textContent: "생성하면 여기에 표시돼요." }));
    return;
  }
  state.results.forEach((r) => {
    const card = el("div", { className: "card" });
    if (r.status === "loading") card.append(el("div", { className: "card-loading", textContent: "생성 중..." }));
    else if (r.status === "error") card.append(el("div", { className: "card-loading", textContent: `실패: ${r.error}` }));
    else card.append(el("img", { className: "card-image", src: r.full, alt: r.subject }));

    const body = el("div", { className: "card-body" });
    const swatch = HUES.find((h) => h.id === r.hue)?.swatch;
    body.append(
      el("div", { className: "card-meta" }, [
        el("span", { className: "swatch", style: `background:${swatch}` }),
        `${hueLabel(r.hue)} · ${r.promptVersion} · ${r.model.replace("gpt-image-", "")} · ${r.subject.split("—")[0].trim()}`,
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
      body.append(el("div", { className: "card-actions" }, [good, bad, copy, dl]));
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
  if (!confirm("이 피드백을 삭제할까요?")) return;
  const data = await api(`/api/feedback/${encodeURIComponent(id)}`, { method: "DELETE" });
  state.feedback = data.feedback;
  renderBoard();
  updatePreview();
}

function renderBoard() {
  const bad = state.feedback.filter((f) => f.rating === "bad");
  const good = state.feedback.filter((f) => f.rating === "good");

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
    foot.append(el("span", { textContent: [f.promptVersion, f.model?.replace("gpt-image-", ""), hueLabel(f.hue)].filter(Boolean).join(" · ") }));
    const del = el("button", { type: "button", className: "link-btn", textContent: "삭제" });
    del.addEventListener("click", () => deleteFeedback(f.id).catch((e) => showError(e.message)));
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
  setupReference();
  renderEditors();
  renderResults();

  generateBtn.addEventListener("click", generate);
  modelSelectEl.addEventListener("change", renderQualities);
  loadVersionBtn.addEventListener("click", () => loadVersion(versionSelectEl.value));
  saveVersionBtn.addEventListener("click", saveVersion);
  copyPromptBtn.addEventListener("click", () => navigator.clipboard.writeText(promptPreviewEl.value));

  try {
    const [templates, feedback, models] = await Promise.all([api("/api/template"), api("/api/feedback"), api("/api/models")]);
    renderModels(models.models, models.defaultModel);
    state.versions = [BASE_VERSION, ...templates.versions];
    state.feedback = feedback.feedback;
    // Start on the newest saved version so tuning picks up where it left off.
    loadVersion(state.versions.at(-1).version);
  } catch (err) {
    showError(err.message);
  }
  renderVersionSelect();
  renderBoard();
  updatePreview();
}

init();
