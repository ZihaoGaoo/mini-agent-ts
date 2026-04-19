export type Role = "system" | "user" | "assistant" | "tool";

export interface AppConfig {
  apiKey: string;
  apiBase: string;
  model: string;
  maxSteps: number;
  systemPromptPath: string;
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

export interface StepStartedEvent {
  type: "step_started";
  step: number;
  maxSteps: number;
}

export interface AssistantMessageEvent {
  type: "assistant_message";
  content: string;
  toolCalls: ToolCall[];
}

export interface AssistantDeltaEvent {
  type: "assistant_delta";
  delta: string;
}

export interface ToolCallEvent {
  type: "tool_call";
  toolCallId: string;
  toolName: string;
  args: Record<string, any>;
}

export interface ToolResultEvent {
  type: "tool_result";
  toolCallId: string;
  toolName: string;
  success: boolean;
  content: string;
  error?: string;
}

export interface RunCompletedEvent {
  type: "run_completed";
  content: string;
  totalTokens: number;
  exhausted: boolean;
}

export type AgentEvent =
  | StepStartedEvent
  | AssistantDeltaEvent
  | AssistantMessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | RunCompletedEvent;

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
