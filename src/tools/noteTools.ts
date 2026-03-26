const fs = require("node:fs/promises");
const path = require("node:path");

import { ToolResult } from "../schema";
import { BaseTool } from "./base";

async function loadNotes(memoryFile: string): Promise<any[]> {
  try {
    return JSON.parse(await fs.readFile(memoryFile, "utf8"));
  } catch {
    return [];
  }
}

export class RecordNoteTool extends BaseTool {
  name = "record_note";
  description = "Record a note for later reference during the session.";
  parameters = {
    type: "object" as const,
    properties: {
      content: { type: "string", description: "Note content." },
      category: { type: "string", description: "Optional note category." }
    },
    required: ["content"]
  };

  constructor(private readonly memoryFile: string) {
    super();
  }

  async execute(args: Record<string, any>): Promise<ToolResult> {
    try {
      const notes = await loadNotes(this.memoryFile);
      notes.push({
        timestamp: new Date().toISOString(),
        category: args.category ?? "general",
        content: String(args.content)
      });
      await fs.mkdir(path.dirname(this.memoryFile), { recursive: true });
      await fs.writeFile(this.memoryFile, JSON.stringify(notes, null, 2), "utf8");
      return { success: true, content: "Note recorded." };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  }
}

export class RecallNotesTool extends BaseTool {
  name = "recall_notes";
  description = "Read previously recorded notes.";
  parameters = {
    type: "object" as const,
    properties: {
      category: { type: "string", description: "Optional category filter." }
    }
  };

  constructor(private readonly memoryFile: string) {
    super();
  }

  async execute(args: Record<string, any>): Promise<ToolResult> {
    try {
      const category = args.category ? String(args.category) : null;
      let notes = await loadNotes(this.memoryFile);
      if (category) {
        notes = notes.filter((note) => note.category === category);
      }
      if (!notes.length) {
        return { success: true, content: "No notes found." };
      }
      const lines = notes.map(
        (note, index) => `${index + 1}. [${note.category}] ${note.content} (${note.timestamp})`
      );
      return { success: true, content: lines.join("\n") };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  }
}
