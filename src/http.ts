import fs from "node:fs/promises";

import Fastify from "fastify";
import { Pool } from "pg";

import { AgentRuntime } from "./app/runtime";
import { PostgresAgentStore } from "./app/postgresStore";
import { SessionSnapshot, StaticEnvironmentResolver } from "./app/sessionStore";
import { getPostgresConfig } from "./db/config";

interface CreateSessionBody {
  sessionId?: string;
  environmentId?: string;
}

interface SendMessageBody {
  content?: string;
  environmentId?: string;
}

function parseEnvironmentMap(): Record<string, string> {
  const raw = process.env.AGENT_ENVIRONMENT_MAP_JSON ?? "{}";
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AGENT_ENVIRONMENT_MAP_JSON must be a JSON object mapping environmentId to workspace path.");
  }

  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
}

function requireString(value: unknown, fieldName: string): string {
  const result = String(value ?? "").trim();
  if (!result) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return result;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sessionSummary(session: SessionSnapshot) {
  return {
    sessionId: session.id,
    environmentId: session.environmentId,
    currentAgent: session.currentAgent,
    messageCount: session.messages.length,
    totalTokens: session.totalTokens
  };
}

async function main(): Promise<void> {
  const host = process.env.AGENT_HTTP_HOST ?? process.env.HOST ?? "127.0.0.1";
  const port = Number(process.env.AGENT_HTTP_PORT ?? process.env.PORT ?? "3000");
  const environmentMap = parseEnvironmentMap();

  for (const workspaceDir of Object.values(environmentMap)) {
    await fs.mkdir(workspaceDir, { recursive: true });
  }

  const pool = new Pool(getPostgresConfig());
  const store = new PostgresAgentStore(pool);
  const { runtime, configPath, model } = await AgentRuntime.createDefault(
    store,
    new StaticEnvironmentResolver(environmentMap)
  );

  const app = Fastify({
    logger: false
  });

  app.addHook("onClose", async () => {
    await pool.end();
  });

  app.setErrorHandler((error, _request, reply) => {
    const message = getErrorMessage(error);
    const statusCode = message.includes("not found") ? 404 : 400;
    void reply.status(statusCode).send({ error: { message, statusCode } });
  });

  app.get("/health", async () => ({
    ok: true,
    model,
    configPath
  }));

  app.post<{ Body: CreateSessionBody }>("/sessions", async (request, reply) => {
    const environmentId = requireString(request.body?.environmentId, "environmentId");
    const session = await runtime.createSession(environmentId, request.body?.sessionId);
    return reply.status(201).send(sessionSummary(session));
  });

  app.get<{ Params: { id: string } }>("/sessions/:id", async (request) => {
    const session = await runtime.getSession(request.params.id);
    if (!session) {
      throw new Error(`Session ${request.params.id} not found.`);
    }
    return sessionSummary(session);
  });

  app.delete<{ Params: { id: string } }>("/sessions/:id", async (request) => {
    const session = await runtime.getSession(request.params.id);
    if (!session) {
      throw new Error(`Session ${request.params.id} not found.`);
    }

    await runtime.deleteSession(request.params.id);
    return {
      deleted: true,
      sessionId: request.params.id
    };
  });

  app.post<{ Params: { id: string }; Body: SendMessageBody }>("/sessions/:id/messages", async (request) => {
    const content = requireString(request.body?.content, "content");
    const existingSession = await runtime.getSession(request.params.id);
    const environmentId = request.body?.environmentId ? requireString(request.body.environmentId, "environmentId") : undefined;

    if (!existingSession && !environmentId) {
      throw new Error("environmentId is required when creating a new session via /messages.");
    }

    const result = await runtime.runTurn({
      sessionId: request.params.id,
      environmentId,
      userMessage: content
    });

    return {
      sessionId: result.sessionId,
      runId: result.runId,
      environmentId: result.environmentId,
      assistantMessage: result.assistantMessage,
      messageCount: result.messageCount,
      totalTokens: result.totalTokens
    };
  });

  await app.listen({
    host,
    port
  });

  console.log(`config> ${configPath}`);
  console.log(`model> ${model}`);
  console.log(`postgres> ${getPostgresConfig().host}:${getPostgresConfig().port}/${getPostgresConfig().database}`);
  console.log(`http> http://${host}:${port}`);
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
