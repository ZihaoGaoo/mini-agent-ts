const childProcess = require("node:child_process");
const util = require("node:util");

import { ToolResult } from "../schema";
import { BaseTool } from "./base";

const execAsync = util.promisify(childProcess.exec);

export class BashTool extends BaseTool {
  name = "bash";
  description = "Execute a shell command in the workspace. Use carefully.";
  parameters = {
    type: "object" as const,
    properties: {
      command: { type: "string", description: "Shell command to execute." },
      timeout: { type: "integer", description: "Timeout in seconds.", default: 120 }
    },
    required: ["command"]
  };

  constructor(private readonly workspaceDir: string) {
    super();
  }

  async execute(args: Record<string, any>): Promise<ToolResult> {
    try {
      const timeout = Number(args.timeout ?? 120) * 1000;
      const result = await execAsync(String(args.command), {
        cwd: this.workspaceDir,
        timeout,
        maxBuffer: 1024 * 1024
      });

      const stdout = String(result.stdout ?? "").trim();
      const stderr = String(result.stderr ?? "").trim();
      const parts = [stdout, stderr ? `[stderr]\n${stderr}` : ""].filter(Boolean);
      return {
        success: true,
        content: parts.join("\n\n") || "(no output)"
      };
    } catch (error: any) {
      const stdout = String(error?.stdout ?? "").trim();
      const stderr = String(error?.stderr ?? "").trim();
      const details = [stdout, stderr].filter(Boolean).join("\n\n");
      return {
        success: false,
        content: "",
        error: details || String(error)
      };
    }
  }
}
