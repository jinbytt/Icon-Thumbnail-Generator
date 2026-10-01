import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { USING_GITHUB, readJson, writeJson, saveImage, readImage, deleteImage } from "./lib/store.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Same family ChatGPT uses. gpt-image-2.x accepts custom sizes (multiples of
// 16, ≥655,360 px), so ask for 251:155 directly; gpt-image-1 only has fixed
// sizes and gets center-cropped client-side.
const MODELS = {
  "gpt-image-2.5-sunburst": { size: "1296x800", qualities: ["auto", "low", "medium", "high", "xhigh", "max"] },
  "gpt-image-2.5-flare": { size: "1296x800", qualities: ["auto", "low", "medium", "high", "xhigh", "max"] },
  "gpt-image-2": { size: "1296x800", qualities: ["auto", "low", "medium", "high"] },
  "gpt-image-1": { size: "1536x1024", qualities: ["auto", "low", "medium", "high"] },
};
const DEFAULT_MODEL = MODELS[process.env.IMAGE_MODEL] ? process.env.IMAGE_MODEL : "gpt-image-2.5-sunburst";

const app = express();
app.set("trust proxy", 1); // behind Render's proxy — lets the login rate limit see real client IPs
app.use(express.json({ limit: "25mb" }));
app.use(cookieParser());

// --- Shared-password gate -------------------------------------------------
// Leave SITE_PASSWORD unset to keep the site open (e.g. local dev).
const SITE_PASSWORD = process.env.SITE_PASSWORD;
const AUTH_COOKIE = "iconthumb_auth";

function signToken() {
  return crypto.createHmac("sha256", SITE_PASSWORD).update("authenticated").digest("hex");
}

function isAuthed(req) {
  if (!SITE_PASSWORD) return true;
  return req.cookies?.[AUTH_COOKIE] === signToken();
}

const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "시도가 너무 많아요. 잠시 후 다시 시도해주세요." },
});

app.post("/api/login", loginLimiter, (req, res) => {
  const { password } = req.body ?? {};
  if (!SITE_PASSWORD || password !== SITE_PASSWORD) {
    return res.status(401).json({ error: "비밀번호가 틀렸어요." });
  }
  res.cookie(AUTH_COOKIE, signToken(), { httpOnly: true, sameSite: "lax", maxAge: 30 * 24 * 60 * 60 * 1000 });
  res.json({ ok: true });
});

app.use((req, res, next) => {
  if (isAuthed(req) || req.path === "/api/login" || req.path === "/login.html") return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Unauthorized" });
  res.redirect("/login.html");
});

app.use(express.static(path.join(__dirname, "public")));

// Wraps async handlers so storage errors become a JSON 500 instead of a hang.
const route = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(err);
    res.status(500).json({ error: "저장소 오류가 났어요. 잠시 후 다시 시도해주세요." });
  });

const IMAGE_NAME_RE = /^[0-9]+-[0-9a-f]{6}\.png$/;

app.get(
  "/images/:name",
  route(async (req, res) => {
    if (!IMAGE_NAME_RE.test(req.params.name)) return res.status(404).end();
    const buffer = await readImage(req.params.name);
    if (!buffer) return res.status(404).end();
    res.type("png").set("Cache-Control", "private, max-age=31536000, immutable").send(buffer);
  })
);

function newId() {
  return `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

function parseDataUrl(dataUrl) {
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/.exec(dataUrl ?? "");
  if (!match) return null;
  return { mimeType: match[1], buffer: Buffer.from(match[2], "base64") };
}

async function storeImage(dataUrl) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  const name = `${newId()}.png`;
  await saveImage(name, parsed.buffer);
  return `/images/${name}`;
}

// --- Image types + prompt template versions -----------------------------------
// Each image type is a tab with its own prompt, versions and feedback. "icon"
// is built in (its v1 lives in public/template.js); custom types store their
// v1 as the first saved version. Every save becomes a new version so feedback
// can be traced back to the exact prompt that produced it.

const BUILT_IN_TYPES = [{ id: "icon", name: "3D 아이콘", builtIn: true }];
const TYPE_ID_RE = /^[a-z0-9]{1,20}$/;

async function listTypes() {
  return [...BUILT_IN_TYPES, ...(await readJson("types.json", []))];
}

async function resolveType(id) {
  const type = TYPE_ID_RE.test(id ?? "") ? (await listTypes()).find((t) => t.id === id) : null;
  return type ?? null;
}

function templateFile(typeId) {
  return typeId === "icon" ? "template-versions.json" : `templates/${typeId}.json`;
}

function cleanSections(sections) {
  if (!Array.isArray(sections)) return null;
  const clean = sections
    .filter((s) => s && typeof s.label === "string" && typeof s.text === "string")
    .map((s) => ({ id: typeof s.id === "string" ? s.id : s.label, label: s.label, text: s.text }));
  return clean.length ? clean : null;
}

app.get(
  "/api/types",
  route(async (req, res) => {
    res.json({ types: await listTypes() });
  })
);

app.post(
  "/api/types",
  route(async (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 30) : "";
    const sections = cleanSections(req.body?.sections);
    if (!name) return res.status(400).json({ error: "타입 이름을 입력해주세요." });
    if (!sections) return res.status(400).json({ error: "프롬프트 섹션이 비어 있어요." });

    const custom = await readJson("types.json", []);
    const type = { id: `t${Date.now().toString(36)}`, name, createdAt: new Date().toISOString() };
    await writeJson(
      templateFile(type.id),
      [{ version: "v1", sections, note: "처음 버전", assets: {}, createdAt: type.createdAt }],
      `Create type ${name}`
    );
    custom.push(type);
    await writeJson("types.json", custom, `Add type ${name}`);
    res.json({ types: await listTypes(), type });
  })
);

app.patch(
  "/api/types/:id",
  route(async (req, res) => {
    const custom = await readJson("types.json", []);
    const type = custom.find((t) => t.id === req.params.id);
    if (!type) return res.status(404).json({ error: "Not found." });
    const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 30) : "";
    if (!name) return res.status(400).json({ error: "타입 이름을 입력해주세요." });
    type.name = name;
    await writeJson("types.json", custom, `Rename type to ${name}`);
    res.json({ types: await listTypes() });
  })
);

// Only hides the tab — its prompt versions and feedback stay in storage.
app.delete(
  "/api/types/:id",
  route(async (req, res) => {
    const custom = await readJson("types.json", []);
    const next = custom.filter((t) => t.id !== req.params.id);
    if (next.length === custom.length) return res.status(404).json({ error: "Not found." });
    await writeJson("types.json", next, `Remove type ${req.params.id}`);
    res.json({ types: await listTypes() });
  })
);

app.get(
  "/api/template",
  route(async (req, res) => {
    const type = await resolveType(req.query.type ?? "icon");
    if (!type) return res.status(404).json({ error: "Unknown image type." });
    res.json({ versions: await readJson(templateFile(type.id), []) });
  })
);

app.post(
  "/api/template",
  route(async (req, res) => {
    const { note, assets } = req.body ?? {};
    const type = await resolveType(req.body?.type ?? "icon");
    if (!type) return res.status(404).json({ error: "Unknown image type." });
    const sections = cleanSections(req.body?.sections);
    if (!sections) return res.status(400).json({ error: "sections is required." });

    const versions = await readJson(templateFile(type.id), []);
    const version = {
      version: `v${versions.length + (type.builtIn ? 2 : 1)}`, // built-in v1 isn't stored
      sections,
      note: typeof note === "string" ? note.trim() : "",
      assets: assets && typeof assets === "object" ? assets : {},
      createdAt: new Date().toISOString(),
    };
    versions.push(version);
    await writeJson(templateFile(type.id), versions, `Save ${type.name} ${version.version}${version.note ? `: ${version.note}` : ""}`);
    res.json({ versions });
  })
);

// Images that belong to a prompt version (e.g. the human reference) are
// uploaded once and referenced by URL, so versions stay small.
app.post(
  "/api/assets",
  route(async (req, res) => {
    const url = await storeImage(req.body?.image);
    if (!url) return res.status(400).json({ error: "Image is required." });
    res.json({ url });
  })
);

async function readSavedImage(url) {
  if (typeof url !== "string" || !url.startsWith("/images/")) return null;
  const name = path.basename(url);
  if (!IMAGE_NAME_RE.test(name)) return null;
  const buffer = await readImage(name);
  return buffer ? { mimeType: "image/png", buffer } : null;
}

// --- Feedback --------------------------------------------------------------
// 👎 entries carry categories + memo; `active` ones are folded into the
// prompt's feedback section. 👍 entries are kept as good examples.

app.get(
  "/api/feedback",
  route(async (req, res) => {
    res.json({ feedback: await readJson("feedback.json", []) });
  })
);

app.post(
  "/api/feedback",
  route(async (req, res) => {
    const { rating, categories, memo, subject, hue, promptVersion, model, image, type } = req.body ?? {};
    if (rating !== "good" && rating !== "bad") return res.status(400).json({ error: "rating must be good or bad." });
    const entry = {
      id: newId(),
      rating,
      categories: Array.isArray(categories) ? categories.filter((c) => typeof c === "string") : [],
      memo: typeof memo === "string" ? memo.trim() : "",
      subject: typeof subject === "string" ? subject : "",
      hue: typeof hue === "string" ? hue : "",
      promptVersion: typeof promptVersion === "string" ? promptVersion : "",
      model: typeof model === "string" ? model : "",
      type: TYPE_ID_RE.test(type ?? "") ? type : "icon",
      image: await storeImage(image),
      active: rating === "bad",
      createdAt: new Date().toISOString(),
    };
    const list = await readJson("feedback.json", []);
    list.unshift(entry);
    await writeJson("feedback.json", list, `${rating === "good" ? "👍" : "👎"} ${entry.subject.slice(0, 40)}`);
    res.json({ feedback: list });
  })
);

app.patch(
  "/api/feedback/:id",
  route(async (req, res) => {
    const list = await readJson("feedback.json", []);
    const entry = list.find((f) => f.id === req.params.id);
    if (!entry) return res.status(404).json({ error: "Not found." });
    if (typeof req.body?.active === "boolean") entry.active = req.body.active;
    if (typeof req.body?.memo === "string") entry.memo = req.body.memo.trim();
    await writeJson("feedback.json", list, `Update feedback ${entry.id}`);
    res.json({ feedback: list });
  })
);

app.delete(
  "/api/feedback/:id",
  route(async (req, res) => {
    const list = await readJson("feedback.json", []);
    const entry = list.find((f) => f.id === req.params.id);
    const next = list.filter((f) => f.id !== req.params.id);
    await writeJson("feedback.json", next, `Delete feedback ${req.params.id}`);
    if (entry?.image) await deleteImage(path.basename(entry.image));
    res.json({ feedback: next });
  })
);

app.get("/api/models", (req, res) => {
  res.json({ models: Object.entries(MODELS).map(([id, m]) => ({ id, qualities: m.qualities })), defaultModel: DEFAULT_MODEL });
});

// --- Image generation --------------------------------------------------------

app.post("/api/generate", async (req, res) => {
  const { prompt, sourceImage, referenceImage, characterReference, quality, model: requestedModel } = req.body ?? {};
  if (typeof prompt !== "string" || !prompt.trim()) return res.status(400).json({ error: "Prompt is required." });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Server is missing OPENAI_API_KEY. Add it to .env and restart the server." });

  const model = MODELS[requestedModel] ? requestedModel : DEFAULT_MODEL;
  const { size, qualities } = MODELS[model];
  const q = qualities.includes(quality) ? quality : "auto";

  try {
    let response;
    // Order matters: the prompt's [ATTACHED IMAGES] note numbers them the same way.
    // sourceImage is a previous result being varied (🔁 배리에이션).
    const references = [parseDataUrl(sourceImage), parseDataUrl(referenceImage), await readSavedImage(characterReference)].filter(Boolean);

    if (references.length) {
      // References go through the edits endpoint; the prompt's rules limit
      // what each one is used for.
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", prompt);
      form.append("size", size);
      form.append("quality", q);
      references.forEach((r, i) => form.append("image[]", new Blob([r.buffer], { type: r.mimeType }), `reference-${i + 1}.png`));
      response = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
    } else {
      response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt, size, quality: q, n: 1 }),
      });
    }

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data?.error?.message || "Image generation failed." });

    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) return res.status(502).json({ error: "No image returned by the API." });
    res.json({ image: `data:image/png;base64,${b64}`, model, quality: q });
  } catch (err) {
    console.error("Image generation error:", err);
    res.status(500).json({ error: "Unexpected server error while generating the image." });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Icon Thumbnail Generator running at http://localhost:${PORT}`);
  console.log(`Storage: ${USING_GITHUB ? `GitHub (${process.env.GITHUB_DATA_REPO})` : "local data/ folder"}`);
});
