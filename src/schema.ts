export type Role = "system" | "user" | "assistant" | "tool";
export type Provider = "openai" | "anthropic";

export interface RetryConfig {
  enabled: boolean;
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  exponentialBase: number;
}

export interface ToolsConfig {
  enableFileTools: boolean;
  enableBash: boolean;
  enableNote: boolean;
}

export interface AppConfig {
  apiKey: string;
  apiBase: string;
  model: string;
  provider: Provider;
  retry: RetryConfig;
  maxSteps: number;
  workspaceDir: string;
  systemPromptPath: string;
  tools: ToolsConfig;
}

export interface FunctionCall {
  name: string;
  arguments: Record<string, any>;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: FunctionCall;
}

export interface Message {
  role: Role;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMResponse {
  content: string;
  toolCalls: ToolCall[];
  usage?: TokenUsage;
}

export interface ToolResult {
  success: boolean;
  content: string;
  error?: string;
}

export interface ToolSchema {
  type: "object";
  properties: Record<string, any>;
  required?: string[];
}

export interface Tool {
  name: string;
  description: string;
  parameters: ToolSchema;
  execute(args: Record<string, any>): Promise<ToolResult>;
}
