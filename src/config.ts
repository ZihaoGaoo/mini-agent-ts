import fs from "node:fs/promises";
import path from "node:path";

import { AppConfig } from "./schema";
import { parseSimpleYaml } from "./utils/yaml";

function normalizeConfig(raw: Record<string, any>): AppConfig {
  return {
    apiKey: raw.api_key,
    apiBase: raw.api_base ?? "https://api.deepseek.com",
    model: raw.model ?? "deepseek-chat",
    maxSteps: raw.max_steps ?? 20,
    systemPromptPath: raw.system_prompt_path ?? "system_prompt.md"
  };
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
  const configPath = path.join(projectRoot, "config", "config.yaml");

  try {
    await fs.access(configPath);
  } catch {
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
