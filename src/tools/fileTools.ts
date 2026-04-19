import fs from "node:fs/promises";
import path from "node:path";

import { Tool, ToolResult } from "../schema";

function resolvePath(workspaceDir: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(workspaceDir, filePath);
}

export class ReadFileTool implements Tool {
  name = "read_file";
  description = "Read a file from the workspace and return line-numbered content.";
  parameters = {
    type: "object" as const,
    properties: {
      path: { type: "string", description: "Absolute or workspace-relative file path." },
      offset: { type: "integer", description: "Optional 1-based start line." },
      limit: { type: "integer", description: "Optional number of lines to read." }
    },
    required: ["path"]
  };
  constructor(private readonly workspaceDir: string) {}

  async execute(args: Record<string, any>): Promise<ToolResult> {
    try {
      const filePath = resolvePath(this.workspaceDir, args.path);
      const content = await fs.readFile(filePath, "utf8");
      const lines = content.split(/\r?\n/);
      const start = Math.max((args.offset ?? 1) - 1, 0);
      const end = args.limit ? start + args.limit : lines.length;
      const selected = lines.slice(start, end);
      const numbered = selected.map((line: string, index: number) => `${String(start + index + 1).padStart(6, " ")}|${line}`);

      return { success: true, content: numbered.join("\n") };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  }
}

export class WriteFileTool implements Tool {
  name = "write_file";
  description = "Write complete content to a file, replacing any existing file.";
  parameters = {
    type: "object" as const,
    properties: {
      path: { type: "string", description: "Absolute or workspace-relative file path." },
      content: { type: "string", description: "Full file content to write." }
    },
    required: ["path", "content"]
  };
  constructor(private readonly workspaceDir: string) {}

  async execute(args: Record<string, any>): Promise<ToolResult> {
    try {
      const filePath = resolvePath(this.workspaceDir, args.path);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, String(args.content ?? ""), "utf8");
      return { success: true, content: `Wrote ${filePath}` };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  }
}
