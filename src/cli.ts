import fs from "node:fs/promises";
import path from "node:path";
import * as readline from "node:readline/promises";

import { AgentRuntime } from "./app/runtime";
import { AgentEvent } from "./schema";

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

function handleCliEvent(event: AgentEvent): void {
  if (event.type === "step_started") {
    console.log(`\n[step ${event.step}/${event.maxSteps}]`);
    return;
  }

  if (event.type === "assistant_message") {
    if (event.content) {
      console.log(`assistant> ${event.content}`);
    }
    return;
  }

  if (event.type === "tool_call") {
    console.log(`tool> ${event.toolName}`);
    return;
  }

  if (event.type === "tool_result") {
    if (event.success) {
      console.log(`tool-result> ${event.content}`);
    } else {
      console.log(`tool-error> ${event.error}`);
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const workspaceDir = path.resolve(args.workspace ?? process.cwd());
  await fs.mkdir(workspaceDir, { recursive: true });
  const { runtime, configPath, model } = await AgentRuntime.createDefault();
  const session = await runtime.createSession(workspaceDir, "cli");

  console.log(`config> ${configPath}`);
  console.log(`workspace> ${workspaceDir}`);
  console.log(`model> ${model}`);

  if (args.task) {
    await runtime.runTurn({
      sessionId: session.id,
      workspaceDir,
      userMessage: args.task,
      onEvent: handleCliEvent
    });
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
      await runtime.clearSession(session.id);
      console.log("history cleared");
      continue;
    }

    if (input === "/history") {
      const currentSession = await runtime.getSession(session.id);
      console.log(`messages> ${currentSession?.messages.length ?? 0}`);
      continue;
    }

    if (input === "/stats") {
      const currentSession = await runtime.getSession(session.id);
      console.log(`messages> ${currentSession?.messages.length ?? 0}`);
      console.log(`tokens> ${currentSession?.totalTokens ?? 0}`);
      continue;
    }

    try {
      await runtime.runTurn({
        sessionId: session.id,
        userMessage: input,
        onEvent: handleCliEvent
      });
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
