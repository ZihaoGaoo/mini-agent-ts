import { Pool, PoolClient } from "pg";

import { Message, ToolCall } from "../schema";
import {
  AgentStore,
  HandoffCreateInput,
  HandoffRecord,
  MessageCreateInput,
  MessageRecord,
  RunCreateInput,
  RunRecord,
  SessionCreateInput,
  SessionRecord,
  SessionSnapshot,
  ToolCallCreateInput,
  ToolCallRecord
} from "./sessionStore";

type Queryable = Pool | PoolClient;

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? (value as Record<string, any>) : {};
}

function mapSession(row: Record<string, any>): SessionRecord {
  return {
    id: String(row.id),
    userId: row.user_id ?? undefined,
    status: row.status,
    currentAgent: row.current_agent,
    environmentId: row.environment_id,
    totalTokens: Number(row.total_tokens ?? 0),
    metadata: asObject(row.metadata),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

function mapRun(row: Record<string, any>): RunRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    parentRunId: row.parent_run_id ?? undefined,
    triggerMessageId: row.trigger_message_id ?? undefined,
    agentName: row.agent_name,
    status: row.status,
    traceId: row.trace_id ?? undefined,
    inputSummary: row.input_summary ?? undefined,
    outputSummary: row.output_summary ?? undefined,
    totalTokens: Number(row.total_tokens ?? 0),
    errorMessage: row.error_message ?? undefined,
    startedAt: new Date(row.started_at).toISOString(),
    finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

function mapToolCall(row: Record<string, any>): ToolCallRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    runId: String(row.run_id),
    messageId: String(row.message_id),
    toolCallId: row.tool_call_id,
    toolName: row.tool_name,
    argumentsJson: asObject(row.arguments_json),
    status: row.status,
    resultJson: row.result_json ? asObject(row.result_json) : undefined,
    errorMessage: row.error_message ?? undefined,
    startedAt: new Date(row.started_at).toISOString(),
    finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

function mapHandoff(row: Record<string, any>): HandoffRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    runId: String(row.run_id),
    toolCallId: row.tool_call_id ?? undefined,
    fromAgent: row.from_agent,
    toAgent: row.to_agent,
    reason: row.reason ?? undefined,
    payload: asObject(row.payload),
    createdAt: new Date(row.created_at).toISOString()
  };
}

function parseMessageToolCalls(payload: Record<string, any>): ToolCall[] | undefined {
  return Array.isArray(payload.toolCalls) ? (payload.toolCalls as ToolCall[]) : undefined;
}

function mapMessage(row: Record<string, any>): MessageRecord {
  const payload = asObject(row.payload);
  const base: Message = {
    role: row.role,
    content: row.content,
    toolCalls: parseMessageToolCalls(payload),
    toolCallId: row.tool_call_id ?? undefined,
    name: row.name ?? undefined
  };

  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    runId: row.run_id ?? undefined,
    agentName: row.agent_name ?? undefined,
    messageType: row.message_type,
    sequence: Number(row.sequence),
    createdAt: new Date(row.created_at).toISOString(),
    ...base
  };
}

async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export class PostgresAgentStore implements AgentStore {
  constructor(private readonly pool: Pool) {}

  async createSession(input: SessionCreateInput): Promise<SessionRecord> {
    const result = await this.pool.query(
      `INSERT INTO sessions (id, user_id, status, current_agent, environment_id, total_tokens, metadata)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, 'active', $3, $4, 0, $5::jsonb)
       RETURNING *`,
      [input.id ?? null, input.userId ?? null, input.currentAgent, input.environmentId, JSON.stringify(input.metadata ?? {})]
    );
    return mapSession(result.rows[0]);
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    const result = await this.pool.query("SELECT * FROM sessions WHERE id = $1", [id]);
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async updateSession(id: string, patch: Partial<SessionRecord>): Promise<SessionRecord> {
    const current = await this.getSession(id);
    if (!current) {
      throw new Error(`Session ${id} not found.`);
    }

    const next = {
      ...current,
      ...patch
    };

    const result = await this.pool.query(
      `UPDATE sessions
         SET user_id = $2,
             status = $3,
             current_agent = $4,
             environment_id = $5,
             total_tokens = $6,
             metadata = $7::jsonb,
             updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, next.userId ?? null, next.status, next.currentAgent, next.environmentId, next.totalTokens, JSON.stringify(next.metadata)]
    );

    return mapSession(result.rows[0]);
  }

  async resolveWorkspaceDir(session: SessionRecord): Promise<string> {
    const workspaceDir = session.metadata?.workspaceDir;
    if (!workspaceDir || typeof workspaceDir !== "string") {
      throw new Error(`Session ${session.id} is missing a resolved workspaceDir in metadata.`);
    }
    return workspaceDir;
  }

  async loadSessionSnapshot(id: string): Promise<SessionSnapshot | null> {
    const session = await this.getSession(id);
    if (!session) {
      return null;
    }

    const messages = await this.listMessages(id);
    return {
      id: session.id,
      environmentId: session.environmentId,
      workspaceDir: await this.resolveWorkspaceDir(session),
      currentAgent: session.currentAgent,
      messages,
      totalTokens: session.totalTokens
    };
  }

  async clearSession(id: string): Promise<SessionSnapshot> {
    return withTransaction(this.pool, async (client) => {
      const sessionResult = await client.query("SELECT * FROM sessions WHERE id = $1", [id]);
      if (!sessionResult.rows[0]) {
        throw new Error(`Session ${id} not found.`);
      }
      const session = mapSession(sessionResult.rows[0]);

      await client.query("DELETE FROM runs WHERE session_id = $1", [id]);
      await client.query("DELETE FROM messages WHERE session_id = $1 AND role <> 'system'", [id]);
      await client.query(
        `UPDATE sessions
            SET status = 'active',
                total_tokens = 0,
                updated_at = now()
          WHERE id = $1`,
        [id]
      );

      const messagesResult = await client.query("SELECT * FROM messages WHERE session_id = $1 ORDER BY sequence ASC", [id]);

      return {
        id,
        environmentId: session.environmentId,
        workspaceDir: await this.resolveWorkspaceDir(session),
        currentAgent: session.currentAgent,
        messages: messagesResult.rows.map(mapMessage),
        totalTokens: 0
      };
    });
  }

  async deleteSession(id: string): Promise<void> {
    await this.pool.query("DELETE FROM sessions WHERE id = $1", [id]);
  }

  async createRun(input: RunCreateInput): Promise<RunRecord> {
    return withTransaction(this.pool, async (client) => {
      const runResult = await client.query(
        `INSERT INTO runs (session_id, parent_run_id, agent_name, status, trace_id, input_summary, total_tokens)
         VALUES ($1, $2, $3, 'running', $4, $5, 0)
         RETURNING *`,
        [input.sessionId, input.parentRunId ?? null, input.agentName, input.traceId ?? null, input.inputSummary ?? null]
      );

      await client.query(
        `UPDATE sessions SET status = 'busy', updated_at = now() WHERE id = $1`,
        [input.sessionId]
      );

      return mapRun(runResult.rows[0]);
    });
  }

  async updateRun(id: string, patch: Partial<RunRecord>): Promise<RunRecord> {
    const current = await this.pool.query("SELECT * FROM runs WHERE id = $1", [id]);
    if (!current.rows[0]) {
      throw new Error(`Run ${id} not found.`);
    }
    const run = mapRun(current.rows[0]);
    const next = { ...run, ...patch };

    return withTransaction(this.pool, async (client) => {
      const result = await client.query(
        `UPDATE runs
            SET parent_run_id = $2,
                trigger_message_id = $3,
                agent_name = $4,
                status = $5,
                trace_id = $6,
                input_summary = $7,
                output_summary = $8,
                total_tokens = $9,
                error_message = $10,
                started_at = $11,
                finished_at = $12,
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [
          id,
          next.parentRunId ?? null,
          next.triggerMessageId ?? null,
          next.agentName,
          next.status,
          next.traceId ?? null,
          next.inputSummary ?? null,
          next.outputSummary ?? null,
          next.totalTokens,
          next.errorMessage ?? null,
          next.startedAt,
          next.finishedAt ?? null
        ]
      );

      if (patch.status && patch.status !== "running") {
        await client.query(
          `UPDATE sessions
              SET status = 'active',
                  current_agent = $2,
                  total_tokens = $3,
                  updated_at = now()
            WHERE id = $1`,
          [run.sessionId, next.agentName, next.totalTokens]
        );
      }

      return mapRun(result.rows[0]);
    });
  }

  async listRuns(sessionId: string): Promise<RunRecord[]> {
    const result = await this.pool.query("SELECT * FROM runs WHERE session_id = $1 ORDER BY created_at ASC", [sessionId]);
    return result.rows.map(mapRun);
  }

  async appendMessages(messages: MessageCreateInput[]): Promise<MessageRecord[]> {
    if (!messages.length) {
      return [];
    }

    return withTransaction(this.pool, async (client) => {
      const sessionId = messages[0].sessionId;
      const seqResult = await client.query("SELECT COALESCE(MAX(sequence), 0) AS max_sequence FROM messages WHERE session_id = $1", [sessionId]);
      let nextSequence = Number(seqResult.rows[0].max_sequence) + 1;
      const inserted: MessageRecord[] = [];

      for (const message of messages) {
        const payload = message.toolCalls?.length ? { toolCalls: message.toolCalls } : {};
        const result = await client.query(
          `INSERT INTO messages (session_id, run_id, role, agent_name, message_type, content, tool_call_id, name, payload, sequence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
           RETURNING *`,
          [
            message.sessionId,
            message.runId ?? null,
            message.role,
            message.agentName ?? null,
            message.messageType ?? (message.role === "tool" ? "tool_result" : "message"),
            message.content,
            message.toolCallId ?? null,
            message.name ?? null,
            JSON.stringify(payload),
            nextSequence++
          ]
        );
        inserted.push(mapMessage(result.rows[0]));
      }

      return inserted;
    });
  }

  async listMessages(sessionId: string): Promise<MessageRecord[]> {
    const result = await this.pool.query("SELECT * FROM messages WHERE session_id = $1 ORDER BY sequence ASC", [sessionId]);
    return result.rows.map(mapMessage);
  }

  async createToolCalls(toolCalls: ToolCallCreateInput[]): Promise<ToolCallRecord[]> {
    if (!toolCalls.length) {
      return [];
    }

    const inserted: ToolCallRecord[] = [];
    for (const toolCall of toolCalls) {
      const result = await this.pool.query(
        `INSERT INTO tool_calls (
           session_id, run_id, message_id, tool_call_id, tool_name, arguments_json, status, result_json, error_message, finished_at
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, CASE WHEN $7 IN ('pending', 'running') THEN NULL ELSE now() END)
         RETURNING *`,
        [
          toolCall.sessionId,
          toolCall.runId,
          toolCall.messageId,
          toolCall.toolCallId,
          toolCall.toolName,
          JSON.stringify(toolCall.argumentsJson),
          toolCall.status,
          toolCall.resultJson ? JSON.stringify(toolCall.resultJson) : null,
          toolCall.errorMessage ?? null
        ]
      );
      inserted.push(mapToolCall(result.rows[0]));
    }
    return inserted;
  }

  async listToolCalls(runId: string): Promise<ToolCallRecord[]> {
    const result = await this.pool.query("SELECT * FROM tool_calls WHERE run_id = $1 ORDER BY created_at ASC", [runId]);
    return result.rows.map(mapToolCall);
  }

  async createHandoff(input: HandoffCreateInput): Promise<HandoffRecord> {
    const result = await this.pool.query(
      `INSERT INTO handoffs (session_id, run_id, tool_call_id, from_agent, to_agent, reason, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING *`,
      [
        input.sessionId,
        input.runId,
        input.toolCallId ?? null,
        input.fromAgent,
        input.toAgent,
        input.reason ?? null,
        JSON.stringify(input.payload ?? {})
      ]
    );

    await this.pool.query(
      `UPDATE sessions SET current_agent = $2, updated_at = now() WHERE id = $1`,
      [input.sessionId, input.toAgent]
    );

    return mapHandoff(result.rows[0]);
  }

  async listHandoffs(runId: string): Promise<HandoffRecord[]> {
    const result = await this.pool.query("SELECT * FROM handoffs WHERE run_id = $1 ORDER BY created_at ASC", [runId]);
    return result.rows.map(mapHandoff);
  }
}
