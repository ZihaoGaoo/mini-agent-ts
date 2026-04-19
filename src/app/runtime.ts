import fs from "node:fs/promises";
import crypto from "node:crypto";

import { Agent } from "../agent";
import { loadConfig } from "../config";
import { LLMClient } from "../llm/client";
import { AgentEvent, Message, Tool } from "../schema";
import { BashTool } from "../tools/bashTool";
import { ReadFileTool, WriteFileTool } from "../tools/fileTools";
import {
  AgentStore,
  InMemorySessionStore,
  MessageCreateInput,
  MessageRecord,
  SessionSnapshot,
  ToolCallCreateInput
} from "./sessionStore";

export interface RunTurnInput {
  sessionId: string;
  userMessage: string;
  workspaceDir?: string;
  onEvent?: (event: AgentEvent) => void;
}

export interface RunTurnResult {
  sessionId: string;
  runId: string;
  workspaceDir: string;
  assistantMessage: string;
  messageCount: number;
  totalTokens: number;
  messages: MessageRecord[];
}

export interface AgentRuntimeOptions {
  llm: LLMClient;
  systemPrompt: string;
  maxSteps: number;
  store?: AgentStore;
}

function createTools(workspaceDir: string): Tool[] {
  return [new ReadFileTool(workspaceDir), new WriteFileTool(workspaceDir), new BashTool(workspaceDir)];
}

function cloneMessages(messages: Message[]): Message[] {
  return JSON.parse(JSON.stringify(messages));
}

function toModelMessages(messages: MessageRecord[]): Message[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    toolCalls: message.toolCalls,
    toolCallId: message.toolCallId,
    name: message.name
  }));
}

function toStoredMessage(sessionId: string, runId: string, agentName: string, message: Message): MessageCreateInput {
  return {
    sessionId,
    runId,
    role: message.role,
    content: message.content,
    toolCalls: message.toolCalls,
    toolCallId: message.toolCallId,
    name: message.name,
    agentName,
    messageType: message.role === "tool" ? "tool_result" : "message"
  };
}

function buildToolCallRecords(runId: string, persistedMessages: MessageRecord[]): ToolCallCreateInput[] {
  const toolResults = new Map<string, MessageRecord>();
  for (const message of persistedMessages) {
    if (message.role === "tool" && message.toolCallId) {
      toolResults.set(message.toolCallId, message);
    }
  }

  const records: ToolCallCreateInput[] = [];
  for (const message of persistedMessages) {
    if (message.role !== "assistant" || !message.toolCalls?.length) {
      continue;
    }

    for (const call of message.toolCalls) {
      const result = toolResults.get(call.id);
      const isError = Boolean(result?.content?.startsWith("Error: "));

      records.push({
        sessionId: message.sessionId,
        runId,
        messageId: message.id,
        toolCallId: call.id,
        toolName: call.function.name,
        argumentsJson: call.function.arguments,
        status: !result ? "pending" : isError ? "failed" : "completed",
        resultJson: !result || isError ? undefined : { content: result.content },
        errorMessage: result && isError ? result.content.slice("Error: ".length) : undefined
      });
    }
  }

  return records;
}

export class AgentRuntime {
  private readonly llm: LLMClient;
  private readonly systemPrompt: string;
  private readonly maxSteps: number;
  private readonly store: AgentStore;

  constructor(options: AgentRuntimeOptions) {
    this.llm = options.llm;
    this.systemPrompt = options.systemPrompt;
    this.maxSteps = options.maxSteps;
    this.store = options.store ?? new InMemorySessionStore();
  }

  static async createDefault(store?: AgentStore): Promise<{
    runtime: AgentRuntime;
    configPath: string;
    model: string;
  }> {
    const { config, configPath, systemPrompt } = await loadConfig();
    return {
      runtime: new AgentRuntime({
        llm: new LLMClient(config),
        systemPrompt,
        maxSteps: config.maxSteps,
        store
      }),
      configPath,
      model: config.model
    };
  }

  async createSession(workspaceDir: string, sessionId = crypto.randomUUID(), currentAgent = "main"): Promise<SessionSnapshot> {
    const resolvedWorkspaceDir = workspaceDir;
    await fs.mkdir(resolvedWorkspaceDir, { recursive: true });

    await this.store.createSession({
      id: sessionId,
      currentAgent,
      workspaceDir: resolvedWorkspaceDir
    });

    await this.store.appendMessages([
      {
        sessionId,
        role: "system",
        content: `${this.systemPrompt}\n\nCurrent Workspace: ${resolvedWorkspaceDir}`,
        agentName: currentAgent
      }
    ]);

    return this.requireSnapshot(sessionId);
  }

  async getSession(sessionId: string): Promise<SessionSnapshot | null> {
    return this.store.loadSessionSnapshot(sessionId);
  }

  async clearSession(sessionId: string): Promise<SessionSnapshot> {
    return this.store.clearSession(sessionId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.store.deleteSession(sessionId);
  }

  async runTurn(input: RunTurnInput): Promise<RunTurnResult> {
    let snapshot = await this.store.loadSessionSnapshot(input.sessionId);
    if (!snapshot) {
      if (!input.workspaceDir) {
        throw new Error(`Session ${input.sessionId} not found. Provide workspaceDir to create it.`);
      }
      snapshot = await this.createSession(input.workspaceDir, input.sessionId);
    }

    const run = await this.store.createRun({
      sessionId: snapshot.id,
      agentName: snapshot.currentAgent,
      traceId: crypto.randomUUID(),
      inputSummary: input.userMessage
    });

    const [userMessage] = await this.store.appendMessages([
      {
        sessionId: snapshot.id,
        runId: run.id,
        role: "user",
        content: input.userMessage
      }
    ]);

    await this.store.updateRun(run.id, { triggerMessageId: userMessage.id });

    const modelMessages = toModelMessages(snapshot.messages);
    modelMessages.push({
      role: userMessage.role,
      content: userMessage.content
    });

    const agent = new Agent({
      llm: this.llm,
      messages: cloneMessages(modelMessages),
      tools: createTools(snapshot.workspaceDir),
      maxSteps: this.maxSteps,
      totalTokens: snapshot.totalTokens,
      onEvent: input.onEvent
    });

    let assistantMessage: string;
    try {
      assistantMessage = await agent.run();
    } catch (error) {
      await this.store.updateRun(run.id, {
        status: "failed",
        errorMessage: String(error),
        finishedAt: new Date().toISOString(),
        totalTokens: agent.totalTokens
      });
      throw error;
    }
    const generatedMessages = agent.messages.slice(modelMessages.length);

    const storedMessages = generatedMessages.map((message) =>
      toStoredMessage(snapshot!.id, run.id, snapshot!.currentAgent, message)
    );
    const persistedMessages = await this.store.appendMessages(storedMessages);

    const toolCallRecords = buildToolCallRecords(run.id, persistedMessages);
    if (toolCallRecords.length) {
      await this.store.createToolCalls(toolCallRecords);
    }

    await this.store.updateRun(run.id, {
      status: "completed",
      outputSummary: assistantMessage,
      totalTokens: agent.totalTokens,
      finishedAt: new Date().toISOString()
    });

    const nextSnapshot = await this.requireSnapshot(snapshot.id);

    return {
      sessionId: nextSnapshot.id,
      runId: run.id,
      workspaceDir: nextSnapshot.workspaceDir,
      assistantMessage,
      messageCount: nextSnapshot.messages.length,
      totalTokens: nextSnapshot.totalTokens,
      messages: nextSnapshot.messages
    };
  }

  private async requireSnapshot(sessionId: string): Promise<SessionSnapshot> {
    const snapshot = await this.store.loadSessionSnapshot(sessionId);
    if (!snapshot) {
      throw new Error(`Session ${sessionId} not found.`);
    }
    return snapshot;
  }
}
