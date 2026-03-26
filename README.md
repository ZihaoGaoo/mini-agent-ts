# Mini Agent TS Lite

一个按照 `Mini-Agent` CLI 主链路实现的轻量化 TypeScript 版本。

保留能力：

- 交互式 CLI
- `--task` 单次执行模式
- Agent 主循环
- OpenAI / Anthropic 兼容协议适配
- 基础工具：`read_file`、`write_file`、`edit_file`、`bash`、`record_note`、`recall_notes`
- 基础日志

刻意省略：

- ACP / Zed
- MCP
- Skills
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

然后填入 `api_key`。

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

VS Code 已配置为保存时自动使用 Prettier 格式化。

## 命令

- `/help`
- `/clear`
- `/history`
- `/stats`
- `/exit`

## 说明

这个版本追求“小而完整”，重点是把 Python 版本里的 CLI 路线迁移到 TS，而不是完整复刻全部生态集成。
