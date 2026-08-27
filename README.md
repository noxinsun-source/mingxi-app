# 明晰 Mingxi · 真实可运行版

从「收下一条内容」到「梳成可执行的逻辑」——一个**真实接入 LLM 的统一笔记产品**，把原来纯离线的 `明晰_Demo_5.0` 四个页面做成了可运行的应用：

| 页面 | 功能 | 状态 |
|---|---|---|
| ① 笔记库 | 批量上传 / 粘贴笔记 → LLM 自动打标签、写摘要、归领域、标用途 | ✅ 真实（DeepSeek） |
| ② 领域全景 | 按领域自动聚合，看见知识库结构 | ✅ 真实 |
| ③ 梳逻辑（功能A） | 多轮对话驱动可编辑逻辑图 | ✅ 内嵌独立应用 [logic-chain-project-a](https://github.com/noxinsun-source/logic-chain-project-a) |
| ④ 知识补全（功能B） | 笔记 → 可追溯、可切换粒度的知识网络 | ✅ 内嵌独立应用 [knowledge-completion](https://github.com/noxinsun-source/knowledge-completion) |

核心原则不变：**领域交给 AI，用途由人点；笔记只发给你自己配置的模型**。API Key 保存在服务端本地配置文件（已 gitignore），不进仓库、不上传。

## 一、快速开始

### 1. 启动「明晰」统一服务（本仓库）

```bash
cd mingxi
# 可选：用环境变量预置 API（也可启动后在页面右上角「设置」里填）
export MINGXI_API_KEY=sk-你的密钥          # DeepSeek / OpenAI / 硅基流动 / OpenRouter 均可
export MINGXI_BASE_URL=https://api.deepseek.com
export MINGXI_MODEL=deepseek-chat
node server.mjs
```

打开 <http://localhost:4177>。在「① 笔记库」粘贴或上传 `.md` / `.txt`（可多选），点「⚡ 交给 LLM 分析整理」，即可看到每篇笔记被自动打上标题/摘要/领域/用途/标签。

### 2. 启动功能A（梳逻辑）与功能B（知识补全）

页面 ③④ 通过 iframe 内嵌两个独立应用，需要单独启动：

```bash
# 功能A（逻辑链梳理，默认 http://localhost:3001）
git clone https://github.com/noxinsun-source/logic-chain-project-a.git && cd logic-chain-project-a
npm ci && npm run dev

# 功能B（知识补全，默认 http://localhost:4318）
git clone https://github.com/noxinsun-source/knowledge-completion.git && cd knowledge-completion
npm ci && npm run dev
```

回到「明晰」页面，在 ③④ 顶部把地址改成对应端口，点「打开」。若两个子应用与本服务同域部署，直接填公网地址即可。

> 说明：功能A / 功能B 是独立、可单独部署的完整应用（含 Agent 插件、评测、Docker/Cloudflare 部署），「明晰」是统一入口。若只想要笔记打标签 + 领域整理，只启动本仓库即可。

## 二、API 适配（任意 OpenAI-compatible）

右上角「⚙ 设置 API」可随时改 Base URL / 模型 / Key，覆盖：

| 场景 | Base URL | 模型示例 |
|---|---|---|
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4.1` |
| 硅基流动 | `https://api.siliconflow.cn/v1` | `Qwen/Qwen3-8B` |
| OpenRouter | `https://openrouter.ai/api/v1` | `openai/gpt-4o-mini` |
| 本地 Ollama | `http://127.0.0.1:11434/v1` | `qwen3.5:9b` |
| 远程服务器（SSH） | `http://127.0.0.1:<转发端口>/v1` | 服务器已拉取模型 |

配置持久化在 `mingxi/.mingxi-config.json`（已 gitignore），重启不丢。

## 三、部署到公网

本服务是零依赖 Node.js 应用，任何能跑 Node 的环境都能部署：

```bash
# 生产环境：用环境变量注入密钥，避免明文落在配置文件
MINGXI_API_KEY=sk-xxx MINGXI_BASE_URL=https://api.deepseek.com MINGXI_MODEL=deepseek-chat node server.mjs
```

推荐用反向代理把三个服务挂到同一域名下，让 iframe 同源：

```text
https://notes.example.com        → 本服务（mingxi，端口 4177）
https://notes.example.com/fa     → 功能A（端口 3001）
https://notes.example.com/fb     → 功能B（端口 4318）
```

然后把页面 ③④ 的 iframe 地址改成 `https://notes.example.com/fa` 与 `https://notes.example.com/fb`。Caddy 示例：

```caddyfile
notes.example.com {
    reverse_proxy localhost:4177
    handle_path /fa/* { reverse_proxy localhost:3001 }
    handle_path /fb/* { reverse_proxy localhost:4318 }
}
```

### Docker（可选）

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY . .
ENV PORT=4177
EXPOSE 4177
CMD ["node", "server.mjs"]
```

```bash
docker build -t mingxi .
docker run -d -p 4177:4177 -e MINGXI_API_KEY=sk-xxx mingxi
```

## 四、隐私与边界

- 笔记正文只在你点「分析整理」时发给**你自己配置的模型**，不经过任何第三方中转。
- 本服务无登录、无多租户、无限流，**仅适合本地单用户或私有部署**；公开公网前请自行加身份认证与 HTTPS。
- 功能A / 功能B 各自有独立的证据校验、持久化与安全边界，见其 README 与 SECURITY。

## 目录

```text
mingxi/
├── server.mjs            # 零依赖 Node 后端：静态托管 + 笔记/打标签/配置 API
├── public/index.html     # 四页面前端（笔记库 / 领域全景 / 梳逻辑 / 知识补全）
├── package.json
└── .gitignore            # 忽略 .mingxi-config.json / .mingxi-notes.json（含密钥与笔记数据）
```
