// Persistent storage for feedback, prompt versions and images.
//
// Render's free plan wipes the disk on every restart/redeploy, so when
// GITHUB_TOKEN + GITHUB_DATA_REPO are set everything is written to a private
// GitHub repo via the Contents API (one commit per write). Without them it
// falls back to the local data/ folder, which is fine for local dev.
//
// JSON files are cached in memory after the first read; writes go through a
// single queue so consecutive commits never race on the same file's sha.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_DIR = path.join(ROOT, "data");
const IMAGE_CACHE_DIR = path.join(LOCAL_DIR, "images");

const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_DATA_REPO; // e.g. "jinbytt/icon-thumbnail-data"
export const USING_GITHUB = Boolean(TOKEN && REPO);

const jsonCache = new Map(); // file -> { value, sha }
let queue = Promise.resolve();

function enqueue(task) {
  const run = queue.then(task);
  queue = run.catch(() => {}); // keep the queue alive after a failed write
  return run;
}

async function gh(method, filePath, body, accept = "application/vnd.github+json") {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${filePath}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${method} ${filePath} failed: ${res.status} ${await res.text()}`);
  return accept.endsWith("raw") ? Buffer.from(await res.arrayBuffer()) : res.json();
}

// --- JSON ---------------------------------------------------------------------

export async function readJson(file, fallback) {
  if (jsonCache.has(file)) return structuredClone(jsonCache.get(file).value);

  let entry = { value: fallback, sha: undefined };
  if (USING_GITHUB) {
    const meta = await gh("GET", file);
    if (meta) entry = { value: JSON.parse(Buffer.from(meta.content, "base64").toString("utf-8")), sha: meta.sha };
  } else {
    try {
      entry.value = JSON.parse(fs.readFileSync(path.join(LOCAL_DIR, file), "utf-8"));
    } catch {}
  }
  jsonCache.set(file, entry);
  return structuredClone(entry.value);
}

export function writeJson(file, value, message = `Update ${file}`) {
  return enqueue(async () => {
    const text = JSON.stringify(value, null, 2);
    if (USING_GITHUB) {
      const prev = jsonCache.get(file);
      const res = await gh("PUT", file, {
        message,
        content: Buffer.from(text).toString("base64"),
        ...(prev?.sha ? { sha: prev.sha } : {}),
      });
      jsonCache.set(file, { value: structuredClone(value), sha: res.content.sha });
    } else {
      fs.mkdirSync(LOCAL_DIR, { recursive: true });
      fs.writeFileSync(path.join(LOCAL_DIR, file), text);
      jsonCache.set(file, { value: structuredClone(value) });
    }
  });
}

// --- Images -------------------------------------------------------------------
// Always written to the local cache too, so serving them doesn't need a
// GitHub round trip until the next restart.

export function saveImage(name, buffer) {
  fs.mkdirSync(IMAGE_CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(IMAGE_CACHE_DIR, name), buffer);
  if (!USING_GITHUB) return Promise.resolve();
  return enqueue(() => gh("PUT", `images/${name}`, { message: `Add image ${name}`, content: buffer.toString("base64") }));
}

export async function readImage(name) {
  const cached = path.join(IMAGE_CACHE_DIR, name);
  if (fs.existsSync(cached)) return fs.readFileSync(cached);
  if (!USING_GITHUB) return null;
  const buffer = await gh("GET", `images/${name}`, null, "application/vnd.github.raw");
  if (buffer) {
    fs.mkdirSync(IMAGE_CACHE_DIR, { recursive: true });
    fs.writeFileSync(cached, buffer);
  }
  return buffer;
}

export function deleteImage(name) {
  fs.rmSync(path.join(IMAGE_CACHE_DIR, name), { force: true });
  if (!USING_GITHUB) return Promise.resolve();
  return enqueue(async () => {
    const meta = await gh("GET", `images/${name}`);
    if (meta) await gh("DELETE", `images/${name}`, { message: `Delete image ${name}`, sha: meta.sha });
  });
}
