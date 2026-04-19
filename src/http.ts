import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

import { AgentRuntime } from "./app/runtime";
import { SessionSnapshot } from "./app/sessionStore";

interface ParsedArgs {
  workspace?: string;
  host?: string;
  port?: number;
  help?: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === "--workspace" || current === "-w") {
      parsed.workspace = argv[i + 1];
      i += 1;
    } else if (current === "--host") {
      parsed.host = argv[i + 1];
      i += 1;
    } else if (current === "--port" || current === "-p") {
      parsed.port = Number(argv[i + 1]);
      i += 1;
    } else if (current === "--help" || current === "-h") {
      parsed.help = true;
    }
  }
  return parsed;
}

function printHelp(): void {
  console.log(`
Mini Agent TS Lite HTTP

Usage:
  node dist/http.js
  node dist/http.js --workspace /path/to/project
  node dist/http.js --port 3000 --host 127.0.0.1

Endpoints:
  GET    /health
  POST   /sessions
  GET    /sessions/:id
  DELETE /sessions/:id
  POST   /sessions/:id/messages
`);
}

async function readJsonBody(req: any): Promise<Record<string, any>> {
  const chunks: string[] = [];

  for await (const chunk of req) {
    chunks.push(String(chunk));
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(chunks.join(""));
}

function sendJson(res: any, status: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(body.length)
  });
  res.end(body);
}

function sessionSummary(session: SessionSnapshot) {
  return {
    sessionId: session.id,
    workspaceDir: session.workspaceDir,
    messageCount: session.messages.length,
    totalTokens: session.totalTokens
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const host = args.host ?? "127.0.0.1";
  const port = args.port ?? 3000;
  const defaultWorkspaceDir = path.resolve(args.workspace ?? process.cwd());
  await fs.mkdir(defaultWorkspaceDir, { recursive: true });

  const { runtime, configPath, model } = await AgentRuntime.createDefault();

  const server = http.createServer(async (req: any, res: any) => {
    try {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${host}:${port}`}`);
      const pathname = url.pathname;
      const sessionMatch = pathname.match(/^\/sessions\/([^/]+)$/);
      const messageMatch = pathname.match(/^\/sessions\/([^/]+)\/messages$/);

      if (method === "GET" && pathname === "/health") {
        sendJson(res, 200, { ok: true, model, configPath });
        return;
      }

      if (method === "POST" && pathname === "/sessions") {
        const body = await readJsonBody(req);
        const workspaceDir = path.resolve(body.workspaceDir ?? defaultWorkspaceDir);
        const session = await runtime.createSession(workspaceDir, body.sessionId);
        sendJson(res, 201, sessionSummary(session));
        return;
      }

      if (method === "GET" && sessionMatch) {
        const session = await runtime.getSession(sessionMatch[1]);
        if (!session) {
          sendJson(res, 404, { error: `Session ${sessionMatch[1]} not found.` });
          return;
        }
        sendJson(res, 200, sessionSummary(session));
        return;
      }

      if (method === "DELETE" && sessionMatch) {
        const session = await runtime.getSession(sessionMatch[1]);
        if (!session) {
          sendJson(res, 404, { error: `Session ${sessionMatch[1]} not found.` });
          return;
        }
        await runtime.deleteSession(sessionMatch[1]);
        sendJson(res, 200, { deleted: true, sessionId: sessionMatch[1] });
        return;
      }

      if (method === "POST" && messageMatch) {
        const body = await readJsonBody(req);
        const content = String(body.content ?? "").trim();
        if (!content) {
          sendJson(res, 400, { error: "Request body must include non-empty content." });
          return;
        }

        const result = await runtime.runTurn({
          sessionId: messageMatch[1],
          workspaceDir: path.resolve(body.workspaceDir ?? defaultWorkspaceDir),
          userMessage: content
        });

        sendJson(res, 200, {
          sessionId: result.sessionId,
          workspaceDir: result.workspaceDir,
          assistantMessage: result.assistantMessage,
          messageCount: result.messageCount,
          totalTokens: result.totalTokens
        });
        return;
      }

      sendJson(res, 404, { error: `Route not found: ${method} ${pathname}` });
    } catch (error) {
      sendJson(res, 500, { error: String(error) });
    }
  });

  server.listen(port, host, () => {
    console.log(`config> ${configPath}`);
    console.log(`workspace> ${defaultWorkspaceDir}`);
    console.log(`model> ${model}`);
    console.log(`http> http://${host}:${port}`);
  });
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
