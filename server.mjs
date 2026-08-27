/**
 * 明晰 Mingxi · 统一后端（含用户登录 + 每用户笔记库）
 * 运行：node server.mjs
 */
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, "public");
const DATA_FILE = join(ROOT, ".mingxi-data.json");
const PORT = Number(process.env.PORT || 4177);

const DEFAULT_CONFIG = {
  baseUrl: process.env.MINGXI_BASE_URL || "https://api.deepseek.com",
  model: process.env.MINGXI_MODEL || "deepseek-chat",
  apiKey: process.env.MINGXI_API_KEY || "",
};

let db = { users: {}, notes: {} };
async function loadDb() {
  if (existsSync(DATA_FILE)) { try { db = JSON.parse(await readFile(DATA_FILE, "utf8")); } catch { db = { users: {}, notes: {} }; } }
}
async function saveDb() { await writeFile(DATA_FILE, JSON.stringify(db, null, 2), "utf8"); }

const sessions = new Map();
function hashPassword(password, salt) { return scryptSync(password, salt, 64).toString("hex"); }
function newSalt() { return randomBytes(16).toString("hex"); }
function newToken() { return randomBytes(32).toString("hex"); }
function getUser(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const username = sessions.get(token);
  return username ? { username, record: db.users[username] } : null;
}

async function chatJson(user, system, userMsg, { maxTokens = 4000 } = {}) {
  const cfg = user.record.config || DEFAULT_CONFIG;
  if (!cfg.apiKey) throw new Error("尚未配置 API Key：请先点击右上角「设置」填入你自己的模型 Key。");
  const baseUrl = cfg.baseUrl.replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, messages: [{ role: "system", content: system }, { role: "user", content: userMsg }], temperature: 0.2, max_tokens: maxTokens, stream: false }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `模型接口 HTTP ${response.status}`);
  const content = payload.choices?.[0]?.message?.content ?? "";
  const start = content.indexOf("{"); const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型返回不是 JSON");
  return JSON.parse(content.slice(start, end + 1));
}

const TAGGING_SYSTEM = `你是「明晰」笔记知识库的统一分析引擎。对用户提交的每篇笔记做整理归纳，输出结构化结果。只输出一个 JSON 对象，不要 Markdown、不要 JSON 之外的文字。
领域(domain)从以下白名单选一个最贴切（都不贴切用"其他"）：
["机器学习","大模型/Agent","前端工程","后端工程","产品设计","研究方法","个人成长","读书笔记","生活方式","其他"]
用途(purpose)从白名单选：["学习","收藏","避坑","素材","待定"]
tags 给 2-5 个具体可检索的中文短标签。summary 一句话概括核心。title 若用户未提供则补一个简洁标题。`;

function json(res, status, body) { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(body)); }
function readBody(req) { return new Promise((resolve, reject) => { let d = ""; req.on("data", (c) => { d += c; if (d.length > 5_000_000) { reject(new Error("请求过大")); req.destroy(); } }); req.on("end", () => resolve(d)); req.on("error", reject); }); }
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
const userNotes = (u) => (db.notes[u.username] = db.notes[u.username] || []);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = decodeURIComponent(url.pathname);
  try {
    if (path === "/api/auth/register" && req.method === "POST") {
      const { username, password } = JSON.parse(await readBody(req));
      const name = String(username || "").trim().slice(0, 40);
      if (!name || !password || String(password).length < 4) throw new Error("用户名需非空，密码至少 4 位");
      if (db.users[name]) throw new Error("用户名已存在");
      const salt = newSalt();
      db.users[name] = { salt, hash: hashPassword(String(password), salt), config: { ...DEFAULT_CONFIG, apiKey: "" } };
      db.notes[name] = db.notes[name] || [];
      await saveDb();
      return json(res, 200, { ok: true });
    }
    if (path === "/api/auth/login" && req.method === "POST") {
      const { username, password } = JSON.parse(await readBody(req));
      const rec = db.users[String(username || "")];
      if (!rec) throw new Error("用户不存在");
      const hash = hashPassword(String(password || ""), rec.salt);
      if (!timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(rec.hash, "hex"))) throw new Error("密码错误");
      const token = newToken();
      sessions.set(token, String(username));
      return json(res, 200, { ok: true, token, username: String(username) });
    }
    if (path === "/api/auth/me" && req.method === "GET") {
      const u = getUser(req);
      return json(res, 200, { username: u?.username || null, configured: u ? Boolean(u.record.config?.apiKey || DEFAULT_CONFIG.apiKey) : false });
    }
    if (path === "/api/auth/logout" && req.method === "POST") {
      const auth = req.headers.authorization || "";
      sessions.delete(auth.slice(7));
      return json(res, 200, { ok: true });
    }

    const user = getUser(req);
    if (path === "/api/config" && req.method === "GET") {
      if (!user) return json(res, 401, { error: "未登录" });
      const c = user.record.config || DEFAULT_CONFIG;
      return json(res, 200, { baseUrl: c.baseUrl, model: c.model, hasKey: Boolean(c.apiKey), keyPreview: c.apiKey ? `…${c.apiKey.slice(-4)}` : "" });
    }
    if (path === "/api/config" && req.method === "POST") {
      if (!user) return json(res, 401, { error: "未登录" });
      const body = JSON.parse(await readBody(req));
      const cfg = user.record.config || { ...DEFAULT_CONFIG };
      if (typeof body.baseUrl === "string" && body.baseUrl.trim()) cfg.baseUrl = body.baseUrl.trim();
      if (typeof body.model === "string" && body.model.trim()) cfg.model = body.model.trim();
      if (typeof body.apiKey === "string" && body.apiKey.trim()) cfg.apiKey = body.apiKey.trim();
      user.record.config = cfg;
      await saveDb();
      return json(res, 200, { ok: true, hasKey: Boolean(cfg.apiKey) });
    }
    if (path === "/api/notes" && req.method === "GET") {
      if (!user) return json(res, 401, { error: "未登录" });
      return json(res, 200, { notes: userNotes(user) });
    }
    if (path === "/api/notes/clear" && req.method === "POST") {
      if (!user) return json(res, 401, { error: "未登录" });
      db.notes[user.username] = [];
      await saveDb();
      return json(res, 200, { ok: true });
    }
    if (path === "/api/notes/analyze" && req.method === "POST") {
      if (!user) return json(res, 401, { error: "未登录" });
      const body = JSON.parse(await readBody(req));
      const items = Array.isArray(body.notes) ? body.notes : [];
      if (!items.length) throw new Error("没有收到笔记");
      const cleaned = items.map((n, i) => ({ id: String(n.id || `note_${i + 1}`), title: String(n.title || ""), content: String(n.content || "").trim() })).filter((n) => n.content);
      if (!cleaned.length) throw new Error("笔记正文为空");
      const results = [];
      for (const note of cleaned) {
        const tag = await chatJson(user, TAGGING_SYSTEM, JSON.stringify({ id: note.id, title: note.title, content: note.content.slice(0, 8000) }), { maxTokens: 600 });
        results.push({ id: note.id, title: tag.title || note.title || "未命名笔记", summary: tag.summary || "", domain: tag.domain || "其他", purpose: tag.purpose || "待定", tags: Array.isArray(tag.tags) ? tag.tags.slice(0, 8) : [], content: note.content, analyzedAt: new Date().toISOString() });
      }
      const map = new Map(userNotes(user).map((n) => [n.id, n]));
      for (const r of results) map.set(r.id, r);
      db.notes[user.username] = [...map.values()];
      await saveDb();
      return json(res, 200, { ok: true, analyzed: results.length, notes: db.notes[user.username] });
    }
    if (path === "/api/health" && req.method === "GET") {
      return json(res, 200, { ok: true, model: (user?.record.config || DEFAULT_CONFIG).model, baseUrl: (user?.record.config || DEFAULT_CONFIG).baseUrl, configured: Boolean(user ? (user.record.config?.apiKey || DEFAULT_CONFIG.apiKey) : DEFAULT_CONFIG.apiKey), noteCount: user ? userNotes(user).length : 0, loginRequired: true });
    }

    // 功能B（知识补全）代理：把选中的笔记发给功能B的 Run API，返回 runId，前端再跳转其页面
    if (path === "/api/featureb/run" && req.method === "POST") {
      if (!user) return json(res, 401, { error: "未登录" });
      const body = JSON.parse(await readBody(req));
      const note = body.note;
      if (!note || !note.content || !note.content.trim()) throw new Error("请先选择一篇有正文的笔记");
      const fbBase = (process.env.FEATURE_B_BASE_URL || "http://localhost:4318").replace(/\/+$/, "");
      const response = await fetch(`${fbBase}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          notes: [{ id: "note_1", title: note.title || "我的笔记", content: note.content, source: "mingxi", capturedAt: new Date().toISOString().slice(0, 10), confidence: 0.9 }],
          goal: body.goal || "系统理解这篇笔记并找到下一步知识缺口",
          granularity: body.granularity || 4,
          expansionRadius: body.hops || 2,
          maxNodes: body.maxNodes || 30,
          confidenceThreshold: 0.5,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || payload?.run?.error?.message || `功能B 返回 HTTP ${response.status}`);
      const runId = payload.run?.runId;
      if (!runId) throw new Error("功能B 未返回 runId");
      return json(res, 200, { ok: true, runId, dashboardUrl: `${fbBase}/runs/${runId}` });
    }

    if (req.method === "GET") {
      let file = path === "/" ? "index.html" : path.replace(/^\/+/, "");
      if (file.includes("..")) return json(res, 403, { error: "forbidden" });
      const filePath = join(PUBLIC, file);
      if (existsSync(filePath)) { res.writeHead(200, { "content-type": MIME[extname(filePath).toLowerCase()] || "application/octet-stream" }); return res.end(await readFile(filePath)); }
    }
    json(res, 404, { error: "not found" });
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : "服务器错误" });
  }
});

await loadDb();
server.listen(PORT, () => console.log(`\n  明晰 Mingxi · 服务已启动 → http://localhost:${PORT}\n`));
