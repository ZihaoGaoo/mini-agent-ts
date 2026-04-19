import fs from "node:fs/promises";
import crypto from "node:crypto";

import { Agent } from "../agent";
import { loadConfig } from "../config";
import { LLMClient } from "../llm/client";
import { AgentEvent, Message, Tool } from "../schema";
import { BashTool } from "../tools/bashTool";
import { ReadFileTool, WriteFileTool } from "../tools/fileTools";
import { InMemorySessionStore, SessionSnapshot, SessionStore } from "./sessionStore";

export interface RunTurnInput {
  sessionId: string;
  userMessage: string;
  workspaceDir?: string;
  onEvent?: (event: AgentEvent) => void;
}

export interface RunTurnResult {
  sessionId: string;
  workspaceDir: string;
  assistantMessage: string;
  messageCount: number;
  totalTokens: number;
  messages: Message[];
}

export interface AgentRuntimeOptions {
  llm: LLMClient;
  systemPrompt: string;
  maxSteps: number;
  sessionStore?: SessionStore;
}

function createTools(workspaceDir: string): Tool[] {
  return [new ReadFileTool(workspaceDir), new WriteFileTool(workspaceDir), new BashTool(workspaceDir)];
}

function cloneMessages(messages: Message[]): Message[] {
  return JSON.parse(JSON.stringify(messages));
}

export class AgentRuntime {
  private readonly llm: LLMClient;
  private readonly systemPrompt: string;
  private readonly maxSteps: number;
  private readonly sessionStore: SessionStore;

  constructor(options: AgentRuntimeOptions) {
    this.llm = options.llm;
    this.systemPrompt = options.systemPrompt;
    this.maxSteps = options.maxSteps;
    this.sessionStore = options.sessionStore ?? new InMemorySessionStore();
  }

  static async createDefault(sessionStore?: SessionStore): Promise<{
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
        sessionStore
      }),
      configPath,
      model: config.model
    };
  }

  async createSession(workspaceDir: string, sessionId = crypto.randomUUID()): Promise<SessionSnapshot> {
    const resolvedWorkspaceDir = workspaceDir;
    await fs.mkdir(resolvedWorkspaceDir, { recursive: true });

    const session: SessionSnapshot = {
      id: sessionId,
      workspaceDir: resolvedWorkspaceDir,
      messages: [
        {
          role: "system",
          content: `${this.systemPrompt}\n\nCurrent Workspace: ${resolvedWorkspaceDir}`
        }
      ],
      totalTokens: 0
    };

    await this.sessionStore.save(session);
    return session;
  }

  async getSession(sessionId: string): Promise<SessionSnapshot | null> {
    return this.sessionStore.load(sessionId);
  }

  async clearSession(sessionId: string): Promise<SessionSnapshot> {
    const session = await this.requireSession(sessionId);
    const resetSession: SessionSnapshot = {
      ...session,
      messages: [session.messages[0]],
      totalTokens: 0
    };
    await this.sessionStore.save(resetSession);
    return resetSession;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.sessionStore.delete(sessionId);
  }

  async runTurn(input: RunTurnInput): Promise<RunTurnResult> {
    let session = await this.sessionStore.load(input.sessionId);
    if (!session) {
      if (!input.workspaceDir) {
        throw new Error(`Session ${input.sessionId} not found. Provide workspaceDir to create it.`);
      }
      session = await this.createSession(input.workspaceDir, input.sessionId);
    }

    const agent = new Agent({
      llm: this.llm,
      messages: cloneMessages(session.messages),
      tools: createTools(session.workspaceDir),
      maxSteps: this.maxSteps,
      totalTokens: session.totalTokens,
      onEvent: input.onEvent
    });

    agent.addUserMessage(input.userMessage);
    const assistantMessage = await agent.run();

    const nextSession: SessionSnapshot = {
      id: session.id,
      workspaceDir: session.workspaceDir,
      messages: cloneMessages(agent.messages),
      totalTokens: agent.totalTokens
    };

    await this.sessionStore.save(nextSession);

    return {
      sessionId: nextSession.id,
      workspaceDir: nextSession.workspaceDir,
      assistantMessage,
      messageCount: nextSession.messages.length,
      totalTokens: nextSession.totalTokens,
      messages: nextSession.messages
    };
  }

  private async requireSession(sessionId: string): Promise<SessionSnapshot> {
    const session = await this.sessionStore.load(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found.`);
    }
    return session;
  }
}
