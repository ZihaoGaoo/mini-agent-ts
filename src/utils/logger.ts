const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

export class RunLogger {
  private logDir: string;
  private logFile: string | null;

  constructor() {
    this.logDir = path.join(os.homedir(), ".mini-agent-ts-lite", "log");
    this.logFile = null;
  }

  async startRun(): Promise<void> {
    await fs.mkdir(this.logDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.logFile = path.join(this.logDir, `agent-run-${timestamp}.log`);
    await fs.writeFile(this.logFile, `Mini Agent TS Lite Log\nstarted=${new Date().toISOString()}\n\n`, "utf8");
  }

  async log(kind: string, payload: unknown): Promise<void> {
    if (!this.logFile) {
      return;
    }

    const entry = `[${new Date().toISOString()}] ${kind}\n${JSON.stringify(payload, null, 2)}\n\n`;
    await fs.appendFile(this.logFile, entry, "utf8");
  }

  getLogFile(): string | null {
    return this.logFile;
  }
}
