import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const IMAGE_DIR = path.join(DATA_DIR, "images");

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
app.use("/images", express.static(IMAGE_DIR));

// --- Tiny JSON stores -----------------------------------------------------

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(value, null, 2));
}

function newId() {
  return `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

function parseDataUrl(dataUrl) {
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/.exec(dataUrl ?? "");
  if (!match) return null;
  return { mimeType: match[1], buffer: Buffer.from(match[2], "base64") };
}

function saveImage(dataUrl) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  const name = `${newId()}.png`;
  fs.writeFileSync(path.join(IMAGE_DIR, name), parsed.buffer);
  return `/images/${name}`;
}

// --- Prompt template versions -----------------------------------------------
// Every save becomes a new version so feedback can be traced back to the
// exact prompt that produced it. null = "use the default in public/template.js".

app.get("/api/template", (req, res) => {
  res.json({ versions: readJson("template-versions.json", []) });
});

app.post("/api/template", (req, res) => {
  const { sections, note, assets } = req.body ?? {};
  if (!sections || typeof sections !== "object") return res.status(400).json({ error: "sections is required." });
  const versions = readJson("template-versions.json", []);
  const version = {
    version: `v${versions.length + 2}`, // v1 is the built-in default
    sections,
    note: typeof note === "string" ? note.trim() : "",
    assets: assets && typeof assets === "object" ? assets : {},
    createdAt: new Date().toISOString(),
  };
  versions.push(version);
  writeJson("template-versions.json", versions);
  res.json({ versions });
});

// Images that belong to a prompt version (e.g. the character reference) are
// uploaded once and referenced by URL, so versions stay small.
app.post("/api/assets", (req, res) => {
  const url = saveImage(req.body?.image);
  if (!url) return res.status(400).json({ error: "Image is required." });
  res.json({ url });
});

function readSavedImage(url) {
  if (typeof url !== "string" || !url.startsWith("/images/")) return null;
  const file = path.join(IMAGE_DIR, path.basename(url));
  return fs.existsSync(file) ? { mimeType: "image/png", buffer: fs.readFileSync(file) } : null;
}

// --- Feedback --------------------------------------------------------------
// 👎 entries carry categories + memo; `active` ones are folded into the
// prompt's feedback section. 👍 entries are kept as good examples.

app.get("/api/feedback", (req, res) => {
  res.json({ feedback: readJson("feedback.json", []) });
});

app.post("/api/feedback", (req, res) => {
  const { rating, categories, memo, subject, hue, promptVersion, model, image } = req.body ?? {};
  if (rating !== "good" && rating !== "bad") return res.status(400).json({ error: "rating must be good or bad." });
  const list = readJson("feedback.json", []);
  list.unshift({
    id: newId(),
    rating,
    categories: Array.isArray(categories) ? categories.filter((c) => typeof c === "string") : [],
    memo: typeof memo === "string" ? memo.trim() : "",
    subject: typeof subject === "string" ? subject : "",
    hue: typeof hue === "string" ? hue : "",
    promptVersion: typeof promptVersion === "string" ? promptVersion : "",
    model: typeof model === "string" ? model : "",
    image: saveImage(image),
    active: rating === "bad",
    createdAt: new Date().toISOString(),
  });
  writeJson("feedback.json", list);
  res.json({ feedback: list });
});

app.patch("/api/feedback/:id", (req, res) => {
  const list = readJson("feedback.json", []);
  const entry = list.find((f) => f.id === req.params.id);
  if (!entry) return res.status(404).json({ error: "Not found." });
  if (typeof req.body?.active === "boolean") entry.active = req.body.active;
  if (typeof req.body?.memo === "string") entry.memo = req.body.memo.trim();
  writeJson("feedback.json", list);
  res.json({ feedback: list });
});

app.delete("/api/feedback/:id", (req, res) => {
  const list = readJson("feedback.json", []);
  const entry = list.find((f) => f.id === req.params.id);
  if (entry?.image) fs.rmSync(path.join(IMAGE_DIR, path.basename(entry.image)), { force: true });
  const next = list.filter((f) => f.id !== req.params.id);
  writeJson("feedback.json", next);
  res.json({ feedback: next });
});

app.get("/api/models", (req, res) => {
  res.json({ models: Object.entries(MODELS).map(([id, m]) => ({ id, qualities: m.qualities })), defaultModel: DEFAULT_MODEL });
});

// --- Image generation --------------------------------------------------------

app.post("/api/generate", async (req, res) => {
  const { prompt, referenceImage, characterReference, quality, model: requestedModel } = req.body ?? {};
  if (typeof prompt !== "string" || !prompt.trim()) return res.status(400).json({ error: "Prompt is required." });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Server is missing OPENAI_API_KEY. Add it to .env and restart the server." });

  const model = MODELS[requestedModel] ? requestedModel : DEFAULT_MODEL;
  const { size, qualities } = MODELS[model];
  const q = qualities.includes(quality) ? quality : "auto";

  try {
    let response;
    // Order matters: the prompt's [ATTACHED IMAGES] note numbers them the same way.
    const references = [parseDataUrl(referenceImage), readSavedImage(characterReference)].filter(Boolean);

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
});
