# Mini Agent TS Lite

一个按照 `Mini-Agent` CLI 主链路实现的轻量化 TypeScript 版本。

保留能力：

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
  dist/
```

## 配置

复制配置模板：

```bash
cp config/config-example.yaml config/config.yaml
```

然后只需要填入 `api_key`。

## 运行

建议先使用 Node 18+，再执行下面命令：

```bash
pnpm install
pnpm build
pnpm start
pnpm start -- --task "read README and summarize"
pnpm start -- --workspace /path/to/project
```

## 开发

```bash
pnpm dev
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

## 说明

这个版本追求“最小闭环”：

- 一次模型调用
- 一个 agent 循环
- 三个基础工具

重点是把 tool-calling agent 的主路径讲清楚，而不是复刻完整生态。
