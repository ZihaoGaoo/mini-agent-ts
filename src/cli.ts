const fs = require("node:fs/promises");
const path = require("node:path");
const readline = require("node:readline/promises");

import { Agent } from "./agent";
import { loadConfig } from "./config";
import { LLMClient } from "./llm/client";
import { Tool } from "./schema";
import { BashTool } from "./tools/bashTool";
import { EditFileTool, ReadFileTool, WriteFileTool } from "./tools/fileTools";
import { RecallNotesTool, RecordNoteTool } from "./tools/noteTools";
import { RunLogger } from "./utils/logger";

interface ParsedArgs {
  workspace?: string;
  task?: string;
  help?: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === "--workspace" || current === "-w") {
      parsed.workspace = argv[i + 1];
      i += 1;
    } else if (current === "--task" || current === "-t") {
      parsed.task = argv[i + 1];
      i += 1;
    } else if (current === "--help" || current === "-h") {
      parsed.help = true;
    }
  }
  return parsed;
}

function printHelp(): void {
  console.log(`
Mini Agent TS Lite

Usage:
  node dist/cli.js
  node dist/cli.js --workspace /path/to/project
  node dist/cli.js --task "read README and summarize"

Commands:
  /help
  /clear
  /history
  /stats
  /exit
`);
}

function createTools(workspaceDir: string, enable: { file: boolean; bash: boolean; note: boolean }): Tool[] {
  const tools: Tool[] = [];

  if (enable.file) {
    tools.push(new ReadFileTool(workspaceDir), new WriteFileTool(workspaceDir), new EditFileTool(workspaceDir));
  }
  if (enable.bash) {
    tools.push(new BashTool(workspaceDir));
  }
  if (enable.note) {
    const memoryFile = path.join(workspaceDir, ".agent_memory.json");
    tools.push(new RecordNoteTool(memoryFile), new RecallNotesTool(memoryFile));
  }

  return tools;
}

async function ensureConfigExample(projectRoot: string): Promise<void> {
  const configTarget = path.join(projectRoot, "config", "config.yaml");
  try {
    await fs.access(configTarget);
  } catch {
    const example = path.join(projectRoot, "config", "config-example.yaml");
    const content = await fs.readFile(example, "utf8");
    await fs.writeFile(configTarget, content, "utf8");
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const projectRoot = path.resolve(__dirname, "..");
  await ensureConfigExample(projectRoot);

  const { config, configPath, systemPrompt } = await loadConfig();
  const workspaceDir = path.resolve(args.workspace ?? process.cwd());
  await fs.mkdir(workspaceDir, { recursive: true });

  const logger = new RunLogger();
  await logger.startRun();

  console.log(`config> ${configPath}`);
  console.log(`workspace> ${workspaceDir}`);
  console.log(`provider> ${config.provider}`);
  console.log(`log> ${logger.getLogFile()}`);

  const llm = new LLMClient(config);
  const tools = createTools(workspaceDir, {
    file: config.tools.enableFileTools,
    bash: config.tools.enableBash,
    note: config.tools.enableNote
  });
  const agent = new Agent({
    llm,
    systemPrompt: `${systemPrompt}\n\nCurrent Workspace: ${workspaceDir}`,
    tools,
    maxSteps: config.maxSteps,
    logger
  });

  if (args.task) {
    agent.addUserMessage(args.task);
    await agent.run();
    return;
  }

  console.log("Mini Agent TS Lite");
  console.log("Type /help for commands.");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  while (true) {
    const input = String(await rl.question("You > ")).trim();
    if (!input) {
      continue;
    }

    if (input === "/exit" || input === "exit" || input === "quit") {
      break;
    }

    if (input === "/help") {
      printHelp();
      continue;
    }

    if (input === "/clear") {
      agent.messages.splice(1);
      console.log("history cleared");
      continue;
    }

    if (input === "/history") {
      console.log(`messages> ${agent.getMessageCount()}`);
      continue;
    }

    if (input === "/stats") {
      console.log(`messages> ${agent.getMessageCount()}`);
      console.log(`tokens> ${agent.totalTokens}`);
      continue;
    }

    agent.addUserMessage(input);
    try {
      await agent.run();
    } catch (error) {
      console.error(`error> ${String(error)}`);
    }
  }

  await rl.close();
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
