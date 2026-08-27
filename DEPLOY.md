# 部署到 CloudBase（腾讯云开发）

> CloudBase **不只是静态网页**：它有「云托管 CloudBase Run」（容器，能跑本项目的 Node 后端）与「云函数 SCF」（无服务器），都能真实连接 DeepSeek API。本项目推荐用**云托管**，因为后端是一个常驻 Node 服务，天然适合容器化。

## 方式一：CloudBase 云托管（推荐）

### 1. 登录（唯一需要你本人操作的步骤）

CloudBase 用腾讯云账号。任选其一：

**A. 二维码登录（浏览器扫码）**
```bash
npx @cloudbase/cli login
```
会自动打开浏览器/显示二维码，用微信扫一扫授权。

**B. 用密钥非交互登录（适合把密钥交给别人/CI）**
```bash
npx @cloudbase/cli login --apiKeyId <你的SecretID> --apiKey <你的SecretKey>
```
> SecretID/SecretKey 在腾讯云控制台 → 访问管理 → API 密钥管理 创建。**只给你信任的人，且用完记得删除。**

### 2. 创建环境

```bash
npx @cloudbase/cli env:create mingxi-prod
# 记下返回的 envId（形如 xxx-1gxxxxx）
```

### 3. 部署（本仓库已含 Dockerfile）

```bash
# 用容器插件把 Node 后端部署到云托管
npx @cloudbase/cli framework deploy -e <你的envId>
```

首次会提示选择框架插件，选「容器 / Container」，端口填 `4177`。部署成功后得到公网访问地址。

### 4. 配置环境变量（功能B 地址 + 可选默认模型 Key）

在云托管控制台的服务配置里加：

```
FEATURE_B_BASE_URL=https://<你的功能B地址>   # 功能B需单独部署，见下方说明
MINGXI_BASE_URL=https://api.deepseek.com
MINGXI_MODEL=deepseek-chat
```

> 说明：功能A（逻辑链）与功能B（知识补全）是独立应用，需分别部署（功能A 可走 Docker/Cloudflare，功能B 走 Cloudflare Workers+D1，见各自仓库 README）。把它们的公网地址填进 mingxi 页面 ③④ 顶部即可完成四页联动。

## 方式二：CloudBase 云函数（无服务器，备选）

把 `server.mjs` 包装成云函数入口，用 `@cloudbase/cli functions:deploy` 部署。适合访问量小、想省资源的场景；但本项目是常驻 HTTP 服务，云函数需配合 API 网关，配置略繁琐，推荐优先用云托管。

## 方式三：不依赖腾讯云，其它平台

本项目是标准 Node.js 应用，任意 Node 托管都能跑：

- **Railway / Render / Fly.io**：连 GitHub 仓库 → 设 `MINGXI_API_KEY` → 部署，几分钟得到公网地址（有免费额度，推荐先试这个验证效果）。
- **自有 VPS**：`node server.mjs` + Caddy/nginx 反向代理（README 已给示例）。

## 上线前必读（安全）

- 登录系统已内置，但**公网开放前建议再补**：HTTPS、限流、审计日志（当前是本地单用户优先设计）。
- 每个用户可自配自己的模型 Key（BYOK），因此"外人上传笔记"的模型费用由各自承担，不会刷爆你的主 Key。
- `.mingxi-data.json`（用户+笔记数据）在容器内是易失的，云托管请挂载**持久化存储**或改用云数据库（下一步可做）。
