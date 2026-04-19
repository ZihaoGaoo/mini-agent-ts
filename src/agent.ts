import { LLMClient } from "./llm/client";
import { AgentEvent, Message, Tool } from "./schema";

export class Agent {
  readonly messages: Message[];
  private readonly llm: LLMClient;
  private readonly tools: Map<string, Tool>;
  private readonly maxSteps: number;
  private readonly onEvent?: (event: AgentEvent) => void;
  totalTokens = 0;

  constructor(options: {
    llm: LLMClient;
    messages: Message[];
    tools: Tool[];
    maxSteps: number;
    totalTokens?: number;
    onEvent?: (event: AgentEvent) => void;
  }) {
    this.llm = options.llm;
    this.tools = new Map(options.tools.map((tool) => [tool.name, tool]));
    this.maxSteps = options.maxSteps;
    this.messages = options.messages;
    this.totalTokens = options.totalTokens ?? 0;
    this.onEvent = options.onEvent;
  }

  addUserMessage(content: string): void {
    this.messages.push({ role: "user", content });
  }

  getMessageCount(): number {
    return this.messages.length;
  }

  async run(): Promise<string> {
    for (let step = 0; step < this.maxSteps; step += 1) {
      this.onEvent?.({ type: "step_started", step: step + 1, maxSteps: this.maxSteps });
      const response = await this.llm.generate(this.messages, Array.from(this.tools.values()));
      this.totalTokens = response.usage?.totalTokens ?? this.totalTokens;

      this.messages.push({
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls
      });

      this.onEvent?.({
        type: "assistant_message",
        content: response.content,
        toolCalls: response.toolCalls
      });

      if (!response.toolCalls.length) {
        this.onEvent?.({
          type: "run_completed",
          content: response.content,
          totalTokens: this.totalTokens,
          exhausted: false
        });
        return response.content;
      }

      for (const call of response.toolCalls) {
        this.onEvent?.({
          type: "tool_call",
          toolCallId: call.id,
          toolName: call.function.name,
          args: call.function.arguments
        });
        const tool = this.tools.get(call.function.name);
        if (!tool) {
          const error = `Unknown tool: ${call.function.name}`;
          this.messages.push({
            role: "tool",
            content: error,
            toolCallId: call.id,
            name: call.function.name
          });
          this.onEvent?.({
            type: "tool_result",
            toolCallId: call.id,
            toolName: call.function.name,
            success: false,
            content: "",
            error
          });
          continue;
        }

        const result = await tool.execute(call.function.arguments);
        this.onEvent?.({
          type: "tool_result",
          toolCallId: call.id,
          toolName: call.function.name,
          success: result.success,
          content: result.content,
          error: result.error
        });

        this.messages.push({
          role: "tool",
          content: result.success ? result.content : `Error: ${result.error}`,
          toolCallId: call.id,
          name: call.function.name
        });
      }
    }

    const exhausted = `Task could not be completed within ${this.maxSteps} steps.`;
    this.onEvent?.({
      type: "run_completed",
      content: exhausted,
      totalTokens: this.totalTokens,
      exhausted: true
    });
    return exhausted;
  }
}
