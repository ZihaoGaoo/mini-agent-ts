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

interface ToolCallAccumulator {
  id?: string;
  type?: "function";
  functionName: string;
  functionArguments: string;
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

  async generate(messages: Message[], tools: Tool[], onTextDelta?: (delta: string) => void): Promise<LLMResponse> {
    const body = {
      model: this.model,
      messages: messages.map((message) => this.toOpenAIMessage(message)),
      tools: tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters
        }
      })),
      stream: Boolean(onTextDelta)
    };

    const response = await fetch(`${this.apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`LLM request failed: ${response.status} ${await response.text()}`);
    }

    if (onTextDelta) {
      return this.consumeStreamingResponse(response, onTextDelta);
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message ?? {};
    const toolCalls = this.parseToolCalls(message.tool_calls ?? []);

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

  private async consumeStreamingResponse(
    response: Response,
    onTextDelta: (delta: string) => void
  ): Promise<LLMResponse> {
    if (!response.body) {
      throw new Error("LLM streaming response body is missing.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const toolCalls = new Map<number, ToolCallAccumulator>();
    let buffered = "";
    let content = "";
    let usage = undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffered += decoder.decode(value, { stream: true });
      const parts = buffered.split("\n\n");
      buffered = parts.pop() ?? "";

      for (const part of parts) {
        const payload = this.parseSseData(part);
        if (!payload || payload === "[DONE]") {
          continue;
        }

        const chunk = JSON.parse(payload);
        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens ?? 0,
            completionTokens: chunk.usage.completion_tokens ?? 0,
            totalTokens: chunk.usage.total_tokens ?? 0
          };
        }

        const choice = chunk.choices?.[0];
        const delta = choice?.delta ?? {};

        if (typeof delta.content === "string" && delta.content) {
          content += delta.content;
          onTextDelta(delta.content);
        }

        if (Array.isArray(delta.tool_calls)) {
          for (const toolCallDelta of delta.tool_calls) {
            const index = Number(toolCallDelta.index ?? toolCalls.size);
            const current = toolCalls.get(index) ?? {
              functionName: "",
              functionArguments: ""
            };

            if (toolCallDelta.id) {
              current.id = toolCallDelta.id;
            }
            if (toolCallDelta.type) {
              current.type = toolCallDelta.type;
            }
            if (toolCallDelta.function?.name) {
              current.functionName += toolCallDelta.function.name;
            }
            if (toolCallDelta.function?.arguments) {
              current.functionArguments += toolCallDelta.function.arguments;
            }

            toolCalls.set(index, current);
          }
        }
      }
    }

    const trailingPayload = this.parseSseData(buffered);
    if (trailingPayload && trailingPayload !== "[DONE]") {
      const chunk = JSON.parse(trailingPayload);
      if (chunk.usage) {
        usage = {
          promptTokens: chunk.usage.prompt_tokens ?? 0,
          completionTokens: chunk.usage.completion_tokens ?? 0,
          totalTokens: chunk.usage.total_tokens ?? 0
        };
      }
    }

    const finalToolCalls: ToolCall[] = Array.from(toolCalls.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, call]) => ({
        id: call.id ?? randomToolId(),
        type: "function",
        function: {
          name: call.functionName,
          arguments: parseToolArguments(call.functionArguments)
        }
      }));

    return {
      content,
      toolCalls: finalToolCalls,
      usage
    };
  }

  private parseSseData(eventChunk: string): string | null {
    const lines = eventChunk
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());

    return lines.length ? lines.join("\n") : null;
  }

  private parseToolCalls(rawToolCalls: any[]): ToolCall[] {
    return rawToolCalls.map((call: any) => ({
      id: call.id ?? randomToolId(),
      type: "function",
      function: {
        name: call.function.name,
        arguments: parseToolArguments(call.function.arguments)
      }
    }));
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
