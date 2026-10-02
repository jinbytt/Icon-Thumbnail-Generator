// Reference implementation of the full pipeline, without the website:
//
//   service description ──► thumbnail 502×310 ──► symbol 120×120 (transparent + background color)
//
//   node scripts/generate.js "AI 응원존 — AI가 얼굴을 분석해 응원 캐릭터를 매칭하는 서비스"
//   node scripts/generate.js "룰렛 — ..." --hue peach --people none --out out/roulette
//
// Everything the website does behind the scenes (background hue, people
// rules, sizes, transparent symbol, background-color symbol) is reproduced
// here so a service can generate the same results from the prompt alone.
// Prompt text and rules live in prompts/thumbnail.json and prompts/symbol.txt.

import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { fileURLToPath } from "url";

dotenv.config();

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "prompts/thumbnail.json"), "utf-8"));
const SYMBOL_PROMPT = fs.readFileSync(path.join(ROOT, "prompts/symbol.txt"), "utf-8").trim();
const API_KEY = process.env.OPENAI_API_KEY;
let QUALITY = CONFIG.quality; // --quality low|medium|high|auto overrides it (low = cheap test)

// --- 1. Build the thumbnail prompt -----------------------------------------

const pick = (list) => list[Math.floor(Math.random() * list.length)];

// "include" when the SUBJECT mentions faces/photos etc., otherwise "none".
export function decidePeople(subject) {
  const s = subject.toLowerCase();
  return CONFIG.people.keywords.some((k) => s.includes(k.toLowerCase())) ? "include" : "none";
}

export function buildThumbnailPrompt(subject, { hue, people, gender }) {
  const peopleIds = CONFIG.people.peopleSectionIds;
  const includeLine = CONFIG.people.includeLine.replaceAll("{{GENDER}}", gender);
  const blocks = CONFIG.sections
    .filter((s) => people === "include" || !peopleIds.includes(s.id))
    .map((s) => {
      const text = s.text.replaceAll("{{SUBJECT}}", subject).replaceAll("{{BACKGROUND_HUE}}", hue);
      return `[${s.label}]\n${text}${s.id === "character" ? `\n${includeLine}` : ""}`;
    });
  if (people === "none") blocks.push(CONFIG.people.noPeopleBlock);
  else if (!CONFIG.sections.some((s) => s.id === "character")) blocks.push(`[PERSON]\n${includeLine}`);
  return blocks.join("\n");
}

// --- 2. OpenAI calls -----------------------------------------------------------

// One retry for dropped connections / 429 / 5xx — long generations sometimes time out.
async function openai(endpoint, init) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`https://api.openai.com/v1/images/${endpoint}`, {
        ...init,
        headers: { Authorization: `Bearer ${API_KEY}`, ...(init.headers ?? {}) },
      });
      const data = await res.json();
      if (res.ok) return Buffer.from(data.data[0].b64_json, "base64");
      if ((res.status === 429 || res.status >= 500) && attempt < 2) continue;
      throw new Error(`OpenAI ${res.status}: ${data?.error?.message}`);
    } catch (err) {
      if (attempt >= 2 || String(err.message).startsWith("OpenAI ")) throw err;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function generateThumbnail(prompt) {
  return openai("generations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: CONFIG.model, prompt, size: CONFIG.thumbnail.generateSize, quality: QUALITY, n: 1 }),
  });
}

// The symbol is an edit of the finished thumbnail, so it keeps the same object.
async function generateSymbol(thumbnailPng) {
  const form = new FormData();
  form.append("model", CONFIG.model);
  form.append("prompt", SYMBOL_PROMPT);
  form.append("size", CONFIG.symbol.generateSize);
  form.append("quality", QUALITY);
  form.append("background", CONFIG.symbol.background);
  form.append("image[]", new Blob([thumbnailPng], { type: "image/png" }), "thumbnail.png");
  return openai("edits", { method: "POST", body: form });
}

// --- 3. Post-processing ------------------------------------------------------------

// Average of the four corner pixels = the solid pastel background color.
async function sampleBackground(png) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => [0, 1, 2].map((c) => data[(y * info.width + x) * info.channels + c]);
  const pts = [at(4, 4), at(info.width - 5, 4), at(4, info.height - 5), at(info.width - 5, info.height - 5)];
  const [r, g, b] = [0, 1, 2].map((c) => Math.round(pts.reduce((sum, p) => sum + p[c], 0) / pts.length));
  return { r, g, b };
}

// --- Run -------------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[++i];
    else args._.push(argv[i]);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const subject = args._.join(" ").trim();
  if (!subject) {
    console.error('Usage: node scripts/generate.js "<서비스 이름 — 설명>" [--hue peach] [--people none|include] [--gender man|woman] [--quality low|medium|high|auto] [--out dir]');
    process.exit(1);
  }
  if (!API_KEY) throw new Error("OPENAI_API_KEY is missing (.env)");
  if (args.quality) QUALITY = args.quality;

  const hue = args.hue ?? pick(CONFIG.backgroundHues).id;
  const people = args.people ?? decidePeople(subject);
  const gender = args.gender === "man" ? CONFIG.people.genders[0] : args.gender === "woman" ? CONFIG.people.genders[1] : pick(CONFIG.people.genders);
  const outDir = args.out ?? path.join(ROOT, "out", `${Date.now()}`);
  fs.mkdirSync(outDir, { recursive: true });

  const prompt = buildThumbnailPrompt(subject, { hue, people, gender });
  fs.writeFileSync(path.join(outDir, "prompt.txt"), prompt);
  console.log(`▶ thumbnail  (${CONFIG.name} ${CONFIG.version}, hue=${hue}, people=${people})`);

  const raw = await generateThumbnail(prompt);
  const { outputWidth: w, outputHeight: h } = CONFIG.thumbnail;
  const thumbnail = await sharp(raw).resize(w, h, { fit: "cover" }).png().toBuffer();
  fs.writeFileSync(path.join(outDir, `thumbnail-${w}x${h}.png`), thumbnail);

  console.log("▶ symbol");
  // Send the full-resolution thumbnail (cropped to the same frame) as the source.
  const source = await sharp(raw).resize(1296, 800, { fit: "cover" }).png().toBuffer();
  const symbolLarge = await generateSymbol(source);
  const n = CONFIG.symbol.outputSize;
  const symbol = await sharp(symbolLarge).resize(n, n, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const bg = await sampleBackground(raw);
  const symbolOnBg = await sharp(symbol).flatten({ background: bg }).png().toBuffer();
  fs.writeFileSync(path.join(outDir, `symbol-${n}-transparent.png`), symbol);
  fs.writeFileSync(path.join(outDir, `symbol-${n}.png`), symbolOnBg);
  fs.writeFileSync(path.join(outDir, "symbol-1024-transparent.png"), symbolLarge);

  const meta = { subject, template: `${CONFIG.name} ${CONFIG.version}`, model: CONFIG.model, hue, people, gender, backgroundColor: bg };
  fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(meta, null, 2));
  console.log(`✔ done → ${outDir}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("✖", err.message);
    process.exit(1);
  });
}
