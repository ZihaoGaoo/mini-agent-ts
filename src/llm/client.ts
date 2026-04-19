import { AppConfig, LLMResponse, Message, Tool, ToolCall } from "../schema";

function normalizeApiBase(apiBase: string): string {
  const trimmed = apiBase.replace(/\/+$/, "");
  if (trimmed.includes("api.minimax.io") && !trimmed.endsWith("/v1")) {
    return `${trimmed}/v1`;
  }
  if (trimmed.includes("api.minimaxi.com") && !trimmed.endsWith("/v1")) {
    return `${trimmed}/v1`;
  }
  return trimmed;
}

function randomToolId(): string {
  return `tool_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function parseToolArguments(raw: unknown): Record<string, any> {
  if (!raw || raw === "undefined") {
    return {};
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "undefined") {
      return {};
    }

    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, any>) : {};
}

export class LLMClient {
  private readonly apiKey: string;
  private readonly apiBase: string;
  private readonly model: string;

  constructor(config: AppConfig) {
    this.apiKey = config.apiKey;
    this.apiBase = normalizeApiBase(config.apiBase);
    this.model = config.model;
  }

  async generate(messages: Message[], tools: Tool[]): Promise<LLMResponse> {
    const response = await fetch(`${this.apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map((message) => this.toOpenAIMessage(message)),
        tools: tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
          }
        }))
      })
    });

    if (!response.ok) {
      throw new Error(`LLM request failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message ?? {};
    const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((call: any) => ({
      id: call.id ?? randomToolId(),
      type: "function",
      function: {
        name: call.function.name,
        arguments: parseToolArguments(call.function.arguments)
      }
    }));

    return {
      content: message.content ?? "",
      toolCalls,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens ?? 0,
            completionTokens: data.usage.completion_tokens ?? 0,
            totalTokens: data.usage.total_tokens ?? 0
          }
        : undefined
    };
  }

  private toOpenAIMessage(message: Message): Record<string, any> {
    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant",
        content: message.content || "",
        tool_calls: message.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: "function",
          function: {
            name: toolCall.function.name,
            arguments: JSON.stringify(toolCall.function.arguments)
          }
        }))
      };
    }

    if (message.role === "tool") {
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.content
      };
    }

    return {
      role: message.role,
      content: message.content
    };
  }
}
