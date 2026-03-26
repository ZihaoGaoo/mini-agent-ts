const crypto = require("node:crypto");

import { AppConfig, LLMResponse, Message, Provider, Tool, ToolCall } from "../schema";

function normalizeApiBase(apiBase: string, provider: Provider): string {
  const trimmed = apiBase.replace(/\/+$/, "");
  const isMiniMax = trimmed.includes("api.minimax.io") || trimmed.includes("api.minimaxi.com");

  if (!isMiniMax) {
    return trimmed;
  }

  const base = trimmed.replace(/\/anthropic$/, "").replace(/\/v1$/, "");
  return provider === "anthropic" ? `${base}/anthropic` : `${base}/v1`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomToolId(): string {
  return `tool_${crypto.randomUUID()}`;
}

export class LLMClient {
  private readonly apiKey: string;
  private readonly apiBase: string;
  private readonly model: string;
  private readonly provider: Provider;
  private readonly retry: AppConfig["retry"];

  constructor(config: AppConfig) {
    this.apiKey = config.apiKey;
    this.apiBase = normalizeApiBase(config.apiBase, config.provider);
    this.model = config.model;
    this.provider = config.provider;
    this.retry = config.retry;
  }

  async generate(messages: Message[], tools: Tool[]): Promise<LLMResponse> {
    const attempts = this.retry.enabled ? this.retry.maxRetries + 1 : 1;
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return this.provider === "anthropic"
          ? await this.generateAnthropic(messages, tools)
          : await this.generateOpenAI(messages, tools);
      } catch (error) {
        lastError = error;
        if (attempt >= attempts - 1) {
          throw error;
        }

        const delay = Math.min(
          this.retry.initialDelay * Math.pow(this.retry.exponentialBase, attempt),
          this.retry.maxDelay
        );
        console.log(`Retrying LLM call in ${delay}s due to error: ${String(error)}`);
        await sleep(delay * 1000);
      }
    }

    throw lastError;
  }

  private async generateOpenAI(messages: Message[], tools: Tool[]): Promise<LLMResponse> {
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
      throw new Error(`OpenAI-compatible request failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message ?? {};
    const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((call: any) => ({
      id: call.id ?? randomToolId(),
      type: "function",
      function: {
        name: call.function.name,
        arguments: JSON.parse(call.function.arguments || "{}")
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

  private async generateAnthropic(messages: Message[], tools: Tool[]): Promise<LLMResponse> {
    const { system, convertedMessages } = this.toAnthropicMessages(messages);
    const response = await fetch(`${this.apiBase}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        system,
        messages: convertedMessages,
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters
        }))
      })
    });

    if (!response.ok) {
      throw new Error(`Anthropic-compatible request failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    const contentBlocks = Array.isArray(data.content) ? data.content : [];
    const textParts: string[] = [];
    const toolCalls: ToolCall[] = [];

    for (const block of contentBlocks) {
      if (block.type === "text") {
        textParts.push(block.text ?? "");
      }
      if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id ?? randomToolId(),
          type: "function",
          function: {
            name: block.name,
            arguments: block.input ?? {}
          }
        });
      }
    }

    return {
      content: textParts.join(""),
      toolCalls,
      usage: data.usage
        ? {
            promptTokens: data.usage.input_tokens ?? 0,
            completionTokens: data.usage.output_tokens ?? 0,
            totalTokens: (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0)
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

  private toAnthropicMessages(messages: Message[]): { system: string | undefined; convertedMessages: Record<string, any>[] } {
    let system: string | undefined;
    const convertedMessages: Record<string, any>[] = [];

    for (const message of messages) {
      if (message.role === "system") {
        system = message.content;
        continue;
      }

      if (message.role === "tool") {
        convertedMessages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: message.toolCallId,
              content: message.content
            }
          ]
        });
        continue;
      }

      if (message.role === "assistant" && message.toolCalls?.length) {
        const content = [];
        if (message.content) {
          content.push({ type: "text", text: message.content });
        }
        for (const toolCall of message.toolCalls) {
          content.push({
            type: "tool_use",
            id: toolCall.id,
            name: toolCall.function.name,
            input: toolCall.function.arguments
          });
        }
        convertedMessages.push({ role: "assistant", content });
        continue;
      }

      convertedMessages.push({
        role: message.role,
        content: message.content
      });
    }

    return { system, convertedMessages };
  }
}
