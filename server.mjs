/**
 * 明晰 Mingxi · 统一后端
 * 一个轻量 Node.js 服务：静态托管前端 + 笔记批量上传/LLM 打标签/领域整理 API。
 * 模型走任意 OpenAI-compatible 接口（默认 DeepSeek），支持用户在前端自配。
 *
 * 运行：node server.mjs
 * 环境变量（可选，作为默认配置）：MINGXI_BASE_URL / MINGXI_MODEL / MINGXI_API_KEY / PORT
 */
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, "public");
const CONFIG_FILE = join(ROOT, ".mingxi-config.json");
const PORT = Number(process.env.PORT || 4177);

// ---- 运行时配置（前端可覆盖，持久化到本地 gitignored 文件） ----
let config = {
  baseUrl: process.env.MINGXI_BASE_URL || "https://api.deepseek.com",
  model: process.env.MINGXI_MODEL || "deepseek-chat",
  apiKey: process.env.MINGXI_API_KEY || "",
};
async function loadConfig() {
  if (existsSync(CONFIG_FILE)) {
    try {
      const saved = JSON.parse(await readFile(CONFIG_FILE, "utf8"));
      config = { ...config, ...saved };
    } catch { /* ignore corrupt config */ }
  }
}
async function saveConfig() {
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
}

// ---- 笔记存储（内存 + 本地 JSON，重启保留） ----
let notes = [];
const NOTES_FILE = join(ROOT, ".mingxi-notes.json");
async function loadNotes() {
  if (existsSync(NOTES_FILE)) {
    try { notes = JSON.parse(await readFile(NOTES_FILE, "utf8")); } catch { /* ignore */ }
  }
}
async function saveNotes() {
  await writeFile(NOTES_FILE, JSON.stringify(notes, null, 2), "utf8");
}

// ---- LLM 调用（OpenAI-compatible /chat/completions） ----
async function chatJson(system, user, { maxTokens = 4000 } = {}) {
  if (!config.apiKey) throw new Error("尚未配置 API Key：请先点击右上角「设置」填入。");
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.2,
      max_tokens: maxTokens,
      stream: false,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `模型接口 HTTP ${response.status}`);
  const content = payload.choices?.[0]?.message?.content ?? "";
  if (!content) throw new Error("模型未返回内容");
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型返回不是 JSON");
  return JSON.parse(content.slice(start, end + 1));
}

const TAGGING_SYSTEM = `你是「明晰」笔记知识库的统一分析引擎。对用户提交的每篇笔记做整理归纳，输出结构化结果。只输出一个 JSON 对象，不要 Markdown、不要 JSON 之外的文字。

领域(domain)从以下白名单中选一个最贴切的（如果都不贴切则用"其他"）：
["机器学习","大模型/Agent","前端工程","后端工程","产品设计","研究方法","个人成长","读书笔记","生活方式","其他"]

用途(purpose)从以下白名单选一个：["学习","收藏","避坑","素材","待定"]

tags 给出 2-5 个具体、可检索的中文短标签（不要泛化词）。summary 用一句话概括笔记核心。title 若用户未提供则补一个简洁标题。`;

function analyzePrompt(note) {
  return JSON.stringify({ id: note.id, title: note.title || "", content: note.content.slice(0, 8000) });
}

// ---- API ----
function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 5_000_000) { reject(new Error("请求过大")); req.destroy(); } });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = decodeURIComponent(url.pathname);

  try {
    if (path === "/api/health" && req.method === "GET") {
      return json(res, 200, { ok: true, model: config.model, baseUrl: config.baseUrl, configured: Boolean(config.apiKey), noteCount: notes.length });
    }
    if (path === "/api/config" && req.method === "GET") {
      return json(res, 200, { baseUrl: config.baseUrl, model: config.model, hasKey: Boolean(config.apiKey), keyPreview: config.apiKey ? `…${config.apiKey.slice(-4)}` : "" });
    }
    if (path === "/api/config" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      if (typeof body.baseUrl === "string" && body.baseUrl.trim()) config.baseUrl = body.baseUrl.trim();
      if (typeof body.model === "string" && body.model.trim()) config.model = body.model.trim();
      if (typeof body.apiKey === "string" && body.apiKey.trim()) config.apiKey = body.apiKey.trim();
      await saveConfig();
      return json(res, 200, { ok: true, hasKey: Boolean(config.apiKey) });
    }
    if (path === "/api/notes" && req.method === "GET") {
      return json(res, 200, { notes });
    }
    if (path === "/api/notes/clear" && req.method === "POST") {
      notes = [];
      await saveNotes();
      return json(res, 200, { ok: true });
    }
    if (path === "/api/notes/analyze" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const items = Array.isArray(body.notes) ? body.notes : [];
      if (!items.length) throw new Error("没有收到笔记");
      const cleaned = items.map((n, i) => ({ id: String(n.id || `note_${i + 1}`), title: String(n.title || ""), content: String(n.content || "").trim() })).filter((n) => n.content);
      if (!cleaned.length) throw new Error("笔记正文为空");
      const results = [];
      for (const note of cleaned) {
        const tag = await chatJson(TAGGING_SYSTEM, analyzePrompt(note), { maxTokens: 600 });
        results.push({
          id: note.id,
          title: tag.title || note.title || "未命名笔记",
          summary: tag.summary || "",
          domain: tag.domain || "其他",
          purpose: tag.purpose || "待定",
          tags: Array.isArray(tag.tags) ? tag.tags.slice(0, 8) : [],
          source: note.title || "粘贴内容",
          content: note.content,
          analyzedAt: new Date().toISOString(),
        });
      }
      // 合并进笔记库（按 id 覆盖）
      const map = new Map(notes.map((n) => [n.id, n]));
      for (const r of results) map.set(r.id, r);
      notes = [...map.values()];
      await saveNotes();
      return json(res, 200, { ok: true, analyzed: results.length, notes });
    }
    if (path === "/api/notes/analyze" && req.method !== "POST") {
      return json(res, 405, { error: "method not allowed" });
    }

    // 静态文件
    if (req.method === "GET") {
      let file = path === "/" ? "index.html" : path.replace(/^\/+/, "");
      if (file.includes("..")) return json(res, 403, { error: "forbidden" });
      const filePath = join(PUBLIC, file);
      if (existsSync(filePath)) {
        const ext = extname(filePath).toLowerCase();
        res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
        return res.end(await readFile(filePath));
      }
    }
    json(res, 404, { error: "not found" });
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : "服务器错误" });
  }
});

await loadConfig();
await loadNotes();
server.listen(PORT, () => {
  console.log(`\n  明晰 Mingxi · 本地服务已启动`);
  console.log(`  → http://localhost:${PORT}\n`);
  console.log(`  模型：${config.model}  @  ${config.baseUrl}`);
  console.log(`  已配置 API Key：${config.apiKey ? "是" : "否（请在页面右上角「设置」填写）"}\n`);
});
