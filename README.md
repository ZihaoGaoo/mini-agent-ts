# Mini Agent TS Lite

一个面向 HTTP 服务的轻量化 TypeScript Agent Runtime，默认用 Fastify 暴露接口，同时保留一个本地 CLI 调试入口。

保留能力：

- Web-first HTTP API
- Fastify 服务入口
- PostgreSQL 会话存储
- 交互式 CLI
- `--task` 单次执行模式
- Agent 主循环
- 单一 OpenAI-compatible 协议适配
- 基础工具：`read_file`、`write_file`、`bash`

刻意省略：

- ACP / Zed
- MCP
- Skills
- 会话笔记 / 本地日志
- 多模型协议兼容与重试编排
- 复杂上下文摘要与后台 Bash 任务管理

## 目录结构

```text
mini-agent-ts-lite/
  config/
  src/
    app/
  dist/
```

## 结构

- `src/agent.ts`: 纯 agent 主循环，只处理消息、tool call 和运行事件
- `src/app/runtime.ts`: 入口无关的运行时，负责 session、environment、agent 装配
- `src/app/sessionStore.ts`: 会话存储接口和内存版实现
- `src/app/postgresStore.ts`: PostgreSQL 存储实现
- `src/http.ts`: Fastify 服务入口，默认启动方式
- `src/cli.ts`: CLI 调试入口

## 配置

复制配置模板：

```bash
cp config/config-example.yaml config/config.yaml
```

然后填入 `api_key`。默认示例使用 DeepSeek 的 OpenAI-compatible 接口：

- `api_base=https://api.deepseek.com`
- `model=deepseek-chat`

HTTP 服务默认连接下面这组 PostgreSQL 配置，也支持标准 `PG*` 环境变量覆盖：

- `PGHOST=127.0.0.1`
- `PGPORT=5433`
- `PGUSER=postgres`
- `PGPASSWORD=reactivepass`
- `PGDATABASE=mini_agent`

## 运行

建议先使用 Node 18+，再执行下面命令：

```bash
pnpm install
pnpm build
pnpm start
pnpm start:cli -- --task "read README and summarize"
pnpm start:cli -- --workspace /path/to/project
```

## 开发

```bash
pnpm dev
pnpm dev:cli
pnpm typecheck
pnpm format
pnpm format:check
```

VS Code 已配置为保存时自动格式化；编辑器内使用内置 formatter，命令行可继续用 `pnpm format` 执行 Prettier。

## 命令

- `/help`
- `/clear`
- `/history`
- `/stats`
- `/exit`

## HTTP API

启动服务：

```bash
PGHOST=127.0.0.1 \
PGPORT=5433 \
PGUSER=postgres \
PGPASSWORD=reactivepass \
PGDATABASE=mini_agent \
AGENT_HTTP_PORT=3000 \
AGENT_ENVIRONMENT_MAP_JSON='{"local-dev":"/path/to/project"}' \
pnpm start
```

可选环境变量：

- `AGENT_HTTP_HOST`
- `AGENT_HTTP_PORT`
- `AGENT_ENVIRONMENT_MAP_JSON`
- `PGHOST`
- `PGPORT`
- `PGUSER`
- `PGPASSWORD`
- `PGDATABASE`

接口：

- `GET /health`
- `POST /sessions`
- `GET /sessions/:id`
- `DELETE /sessions/:id`
- `POST /sessions/:id/messages`
- `POST /sessions/:id/messages/stream`

示例：

```bash
curl -X POST http://127.0.0.1:3000/sessions \
  -H "Content-Type: application/json" \
  -d '{"environmentId":"local-dev"}'

curl -X POST http://127.0.0.1:3000/sessions/<sessionId>/messages \
  -H "Content-Type: application/json" \
  -d '{"environmentId":"local-dev","content":"read README.md and summarize"}'

curl -sN -X POST http://127.0.0.1:3000/sessions/<sessionId>/messages/stream \
  -H "Content-Type: application/json" \
  -d '{"environmentId":"local-dev","content":"read README.md and summarize"}'
```

## 说明

这个版本追求“最小但像服务”：

- 一次模型调用
- 一个 agent 循环
- 三个基础工具
- 一个默认 Fastify HTTP 服务入口
- 一个默认 PostgreSQL 存储实现
- 一个辅助 CLI 调试入口

重点是把 tool-calling agent 的主路径讲清楚，并按 web-first 方式组织 runtime、存储和入口层，再附带 CLI 打包方式。
