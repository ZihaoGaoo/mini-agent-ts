const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

import { AppConfig, Provider } from "./schema";
import { parseSimpleYaml } from "./utils/yaml";

function normalizeConfig(raw: Record<string, any>): AppConfig {
  const provider = (raw.provider ?? "openai") as Provider;

  return {
    apiKey: raw.api_key,
    apiBase: raw.api_base ?? "https://api.minimax.io",
    model: raw.model ?? "MiniMax-M2.5",
    provider,
    retry: {
      enabled: raw.retry?.enabled ?? true,
      maxRetries: raw.retry?.max_retries ?? 3,
      initialDelay: raw.retry?.initial_delay ?? 1,
      maxDelay: raw.retry?.max_delay ?? 30,
      exponentialBase: raw.retry?.exponential_base ?? 2
    },
    maxSteps: raw.max_steps ?? 30,
    workspaceDir: raw.workspace_dir ?? "./workspace",
    systemPromptPath: raw.system_prompt_path ?? "system_prompt.md",
    tools: {
      enableFileTools: raw.tools?.enable_file_tools ?? true,
      enableBash: raw.tools?.enable_bash ?? true,
      enableNote: raw.tools?.enable_note ?? true
    }
  };
}

async function findExisting(paths: string[]): Promise<string | null> {
  for (const candidate of paths) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

export function resolveProjectRoot(): string {
  const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : process.cwd();
  const scriptDir = path.dirname(scriptPath);
  if (path.basename(scriptDir) === "dist") {
    return path.resolve(scriptDir, "..");
  }
  if (path.basename(scriptDir) === "src") {
    return path.resolve(scriptDir, "..");
  }
  return process.cwd();
}

export async function loadConfig(): Promise<{ config: AppConfig; configPath: string; systemPrompt: string }> {
  const projectRoot = resolveProjectRoot();
  const candidates = [
    path.join(process.cwd(), "config", "config.yaml"),
    path.join(projectRoot, "config", "config.yaml"),
    path.join(os.homedir(), ".mini-agent-ts-lite", "config", "config.yaml")
  ];

  const configPath = await findExisting(candidates);
  if (!configPath) {
    throw new Error("config.yaml not found. Copy config/config-example.yaml to config/config.yaml and fill api_key.");
  }

  const raw = parseSimpleYaml(await fs.readFile(configPath, "utf8"));
  const config = normalizeConfig(raw);

  if (!config.apiKey || config.apiKey === "YOUR_API_KEY_HERE") {
    throw new Error("Please configure a valid api_key in config.yaml.");
  }

  const promptPath = path.resolve(path.dirname(configPath), config.systemPromptPath);
  let systemPrompt = "You are a practical AI assistant.";
  try {
    systemPrompt = await fs.readFile(promptPath, "utf8");
  } catch {
    systemPrompt = "You are a practical AI assistant.";
  }

  return { config, configPath, systemPrompt };
}
