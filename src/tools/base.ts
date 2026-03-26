import { Tool, ToolResult } from "../schema";

export abstract class BaseTool implements Tool {
  abstract name: string;
  abstract description: string;
  abstract parameters: Tool["parameters"];

  abstract execute(args: Record<string, any>): Promise<ToolResult>;
}
