import crypto from "node:crypto";

import { Message } from "../schema";

export type SessionStatus = "active" | "busy" | "archived" | "error";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type MessageType = "message" | "tool_result" | "handoff_summary";
export type ToolCallStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface SessionRecord {
  id: string;
  userId?: string;
  status: SessionStatus;
  currentAgent: string;
  workspaceDir: string;
  totalTokens: number;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface RunRecord {
  id: string;
  sessionId: string;
  parentRunId?: string;
  triggerMessageId?: string;
  agentName: string;
  status: RunStatus;
  traceId?: string;
  inputSummary?: string;
  outputSummary?: string;
  totalTokens: number;
  errorMessage?: string;
  startedAt: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRecord extends Message {
  id: string;
  sessionId: string;
  runId?: string;
  agentName?: string;
  messageType: MessageType;
  sequence: number;
  createdAt: string;
}

export interface ToolCallRecord {
  id: string;
  sessionId: string;
  runId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  argumentsJson: Record<string, any>;
  status: ToolCallStatus;
  resultJson?: Record<string, any>;
  errorMessage?: string;
  startedAt: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface HandoffRecord {
  id: string;
  sessionId: string;
  runId: string;
  toolCallId?: string;
  fromAgent: string;
  toAgent: string;
  reason?: string;
  payload: Record<string, any>;
  createdAt: string;
}

export interface SessionSnapshot {
  id: string;
  workspaceDir: string;
  currentAgent: string;
  messages: MessageRecord[];
  totalTokens: number;
}

export interface SessionCreateInput {
  id?: string;
  userId?: string;
  currentAgent: string;
  workspaceDir: string;
  metadata?: Record<string, any>;
}

export interface RunCreateInput {
  sessionId: string;
  parentRunId?: string;
  agentName: string;
  traceId?: string;
  inputSummary?: string;
}

export interface MessageCreateInput extends Message {
  sessionId: string;
  runId?: string;
  agentName?: string;
  messageType?: MessageType;
}

export interface ToolCallCreateInput {
  sessionId: string;
  runId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  argumentsJson: Record<string, any>;
  status: ToolCallStatus;
  resultJson?: Record<string, any>;
  errorMessage?: string;
}

export interface HandoffCreateInput {
  sessionId: string;
  runId: string;
  toolCallId?: string;
  fromAgent: string;
  toAgent: string;
  reason?: string;
  payload?: Record<string, any>;
}

export interface AgentStore {
  createSession(input: SessionCreateInput): Promise<SessionRecord>;
  getSession(id: string): Promise<SessionRecord | null>;
  updateSession(id: string, patch: Partial<SessionRecord>): Promise<SessionRecord>;
  loadSessionSnapshot(id: string): Promise<SessionSnapshot | null>;
  clearSession(id: string): Promise<SessionSnapshot>;
  deleteSession(id: string): Promise<void>;
  createRun(input: RunCreateInput): Promise<RunRecord>;
  updateRun(id: string, patch: Partial<RunRecord>): Promise<RunRecord>;
  listRuns(sessionId: string): Promise<RunRecord[]>;
  appendMessages(messages: MessageCreateInput[]): Promise<MessageRecord[]>;
  listMessages(sessionId: string): Promise<MessageRecord[]>;
  createToolCalls(toolCalls: ToolCallCreateInput[]): Promise<ToolCallRecord[]>;
  listToolCalls(runId: string): Promise<ToolCallRecord[]>;
  createHandoff(input: HandoffCreateInput): Promise<HandoffRecord>;
  listHandoffs(runId: string): Promise<HandoffRecord[]>;
}

function now(): string {
  return new Date().toISOString();
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function cloneSession(record: SessionRecord): SessionRecord {
  return deepClone(record);
}

function cloneRun(record: RunRecord): RunRecord {
  return deepClone(record);
}

function cloneMessage(record: MessageRecord): MessageRecord {
  return deepClone(record);
}

function cloneToolCall(record: ToolCallRecord): ToolCallRecord {
  return deepClone(record);
}

function cloneHandoff(record: HandoffRecord): HandoffRecord {
  return deepClone(record);
}

export class InMemorySessionStore implements AgentStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly runs = new Map<string, RunRecord>();
  private readonly messages = new Map<string, MessageRecord[]>();
  private readonly toolCalls = new Map<string, ToolCallRecord[]>();
  private readonly handoffs = new Map<string, HandoffRecord[]>();

  async createSession(input: SessionCreateInput): Promise<SessionRecord> {
    const createdAt = now();
    const session: SessionRecord = {
      id: input.id ?? crypto.randomUUID(),
      userId: input.userId,
      status: "active",
      currentAgent: input.currentAgent,
      workspaceDir: input.workspaceDir,
      totalTokens: 0,
      metadata: input.metadata ?? {},
      createdAt,
      updatedAt: createdAt
    };
    this.sessions.set(session.id, cloneSession(session));
    this.messages.set(session.id, []);
    return cloneSession(session);
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    const session = this.sessions.get(id);
    return session ? cloneSession(session) : null;
  }

  async updateSession(id: string, patch: Partial<SessionRecord>): Promise<SessionRecord> {
    const current = this.sessions.get(id);
    if (!current) {
      throw new Error(`Session ${id} not found.`);
    }

    const next: SessionRecord = {
      ...current,
      ...deepClone(patch),
      id: current.id,
      updatedAt: now()
    };

    this.sessions.set(id, cloneSession(next));
    return cloneSession(next);
  }

  async loadSessionSnapshot(id: string): Promise<SessionSnapshot | null> {
    const session = this.sessions.get(id);
    if (!session) {
      return null;
    }

    const messages = (this.messages.get(id) ?? []).map(cloneMessage);
    return {
      id: session.id,
      workspaceDir: session.workspaceDir,
      currentAgent: session.currentAgent,
      messages,
      totalTokens: session.totalTokens
    };
  }

  async clearSession(id: string): Promise<SessionSnapshot> {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session ${id} not found.`);
    }

    const systemMessages = (this.messages.get(id) ?? []).filter((message) => message.role === "system");
    const resequenced = systemMessages
      .sort((a, b) => a.sequence - b.sequence)
      .map((message, index) => ({
        ...message,
        sequence: index + 1
      }));

    this.messages.set(id, resequenced.map(cloneMessage));
    this.sessions.set(
      id,
      cloneSession({
        ...session,
        status: "active",
        totalTokens: 0,
        updatedAt: now()
      })
    );

    for (const run of this.runs.values()) {
      if (run.sessionId === id) {
        this.runs.delete(run.id);
        this.toolCalls.delete(run.id);
        this.handoffs.delete(run.id);
      }
    }

    return {
      id,
      workspaceDir: session.workspaceDir,
      currentAgent: session.currentAgent,
      messages: resequenced.map(cloneMessage),
      totalTokens: 0
    };
  }

  async deleteSession(id: string): Promise<void> {
    this.sessions.delete(id);
    this.messages.delete(id);
    for (const run of this.runs.values()) {
      if (run.sessionId === id) {
        this.runs.delete(run.id);
        this.toolCalls.delete(run.id);
        this.handoffs.delete(run.id);
      }
    }
  }

  async createRun(input: RunCreateInput): Promise<RunRecord> {
    const createdAt = now();
    const run: RunRecord = {
      id: crypto.randomUUID(),
      sessionId: input.sessionId,
      parentRunId: input.parentRunId,
      agentName: input.agentName,
      status: "running",
      traceId: input.traceId,
      inputSummary: input.inputSummary,
      totalTokens: 0,
      startedAt: createdAt,
      createdAt,
      updatedAt: createdAt
    };

    this.runs.set(run.id, cloneRun(run));
    this.toolCalls.set(run.id, []);
    this.handoffs.set(run.id, []);
    await this.updateSession(input.sessionId, { status: "busy" });
    return cloneRun(run);
  }

  async updateRun(id: string, patch: Partial<RunRecord>): Promise<RunRecord> {
    const current = this.runs.get(id);
    if (!current) {
      throw new Error(`Run ${id} not found.`);
    }

    const next: RunRecord = {
      ...current,
      ...deepClone(patch),
      id: current.id,
      sessionId: current.sessionId,
      updatedAt: now()
    };

    this.runs.set(id, cloneRun(next));

    if (patch.status && patch.status !== "running") {
      const session = await this.getSession(current.sessionId);
      if (session) {
        await this.updateSession(current.sessionId, {
          status: "active",
          currentAgent: next.agentName,
          totalTokens: next.totalTokens
        });
      }
    }

    return cloneRun(next);
  }

  async listRuns(sessionId: string): Promise<RunRecord[]> {
    return Array.from(this.runs.values())
      .filter((run) => run.sessionId === sessionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(cloneRun);
  }

  async appendMessages(messages: MessageCreateInput[]): Promise<MessageRecord[]> {
    if (!messages.length) {
      return [];
    }

    const sessionId = messages[0].sessionId;
    const existing = this.messages.get(sessionId) ?? [];
    let nextSequence = existing.length ? existing[existing.length - 1].sequence + 1 : 1;

    const appended = messages.map((message) => {
      const record: MessageRecord = {
        id: crypto.randomUUID(),
        sessionId: message.sessionId,
        runId: message.runId,
        role: message.role,
        content: message.content,
        toolCalls: deepClone(message.toolCalls),
        toolCallId: message.toolCallId,
        name: message.name,
        agentName: message.agentName,
        messageType: message.messageType ?? (message.role === "tool" ? "tool_result" : "message"),
        sequence: nextSequence++,
        createdAt: now()
      };
      return record;
    });

    this.messages.set(sessionId, [...existing.map(cloneMessage), ...appended.map(cloneMessage)]);
    return appended.map(cloneMessage);
  }

  async listMessages(sessionId: string): Promise<MessageRecord[]> {
    return (this.messages.get(sessionId) ?? []).map(cloneMessage);
  }

  async createToolCalls(toolCalls: ToolCallCreateInput[]): Promise<ToolCallRecord[]> {
    const createdAt = now();
    const created = toolCalls.map((toolCall) => ({
      id: crypto.randomUUID(),
      sessionId: toolCall.sessionId,
      runId: toolCall.runId,
      messageId: toolCall.messageId,
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      argumentsJson: deepClone(toolCall.argumentsJson),
      status: toolCall.status,
      resultJson: deepClone(toolCall.resultJson),
      errorMessage: toolCall.errorMessage,
      startedAt: createdAt,
      finishedAt: toolCall.status === "pending" || toolCall.status === "running" ? undefined : createdAt,
      createdAt,
      updatedAt: createdAt
    }));

    for (const toolCall of created) {
      const existing = this.toolCalls.get(toolCall.runId) ?? [];
      existing.push(cloneToolCall(toolCall));
      this.toolCalls.set(toolCall.runId, existing);
    }

    return created.map(cloneToolCall);
  }

  async listToolCalls(runId: string): Promise<ToolCallRecord[]> {
    return (this.toolCalls.get(runId) ?? []).map(cloneToolCall);
  }

  async createHandoff(input: HandoffCreateInput): Promise<HandoffRecord> {
    const handoff: HandoffRecord = {
      id: crypto.randomUUID(),
      sessionId: input.sessionId,
      runId: input.runId,
      toolCallId: input.toolCallId,
      fromAgent: input.fromAgent,
      toAgent: input.toAgent,
      reason: input.reason,
      payload: deepClone(input.payload ?? {}),
      createdAt: now()
    };

    const existing = this.handoffs.get(input.runId) ?? [];
    existing.push(cloneHandoff(handoff));
    this.handoffs.set(input.runId, existing);
    await this.updateSession(input.sessionId, { currentAgent: input.toAgent });
    return cloneHandoff(handoff);
  }

  async listHandoffs(runId: string): Promise<HandoffRecord[]> {
    return (this.handoffs.get(runId) ?? []).map(cloneHandoff);
  }
}
