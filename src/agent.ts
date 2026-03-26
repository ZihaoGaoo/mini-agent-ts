import { LLMClient } from "./llm/client";
import { Message, Tool } from "./schema";
import { RunLogger } from "./utils/logger";

export class Agent {
  readonly messages: Message[];
  private readonly llm: LLMClient;
  private readonly tools: Map<string, Tool>;
  private readonly maxSteps: number;
  private readonly logger: RunLogger;
  totalTokens = 0;

  constructor(options: { llm: LLMClient; systemPrompt: string; tools: Tool[]; maxSteps: number; logger: RunLogger }) {
    this.llm = options.llm;
    this.tools = new Map(options.tools.map((tool) => [tool.name, tool]));
    this.maxSteps = options.maxSteps;
    this.logger = options.logger;
    this.messages = [{ role: "system", content: options.systemPrompt }];
  }

  addUserMessage(content: string): void {
    this.messages.push({ role: "user", content });
  }

  getMessageCount(): number {
    return this.messages.length;
  }

  async run(): Promise<string> {
    for (let step = 0; step < this.maxSteps; step += 1) {
      console.log(`\n[step ${step + 1}/${this.maxSteps}]`);
      await this.logger.log("request", {
        messages: this.messages,
        tools: Array.from(this.tools.keys())
      });

      const response = await this.llm.generate(this.messages, Array.from(this.tools.values()));
      this.totalTokens = response.usage?.totalTokens ?? this.totalTokens;
      await this.logger.log("response", response);

      this.messages.push({
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls
      });

      if (response.content) {
        console.log(`assistant> ${response.content}`);
      }

      if (!response.toolCalls.length) {
        return response.content;
      }

      for (const call of response.toolCalls) {
        console.log(`tool> ${call.function.name}`);
        const tool = this.tools.get(call.function.name);
        if (!tool) {
          const error = `Unknown tool: ${call.function.name}`;
          this.messages.push({
            role: "tool",
            content: error,
            toolCallId: call.id,
            name: call.function.name
          });
          console.log(`tool-error> ${error}`);
          continue;
        }

        const result = await tool.execute(call.function.arguments);
        await this.logger.log("tool_result", {
          tool: call.function.name,
          args: call.function.arguments,
          result
        });

        if (result.success) {
          console.log(`tool-result> ${result.content}`);
        } else {
          console.log(`tool-error> ${result.error}`);
        }

        this.messages.push({
          role: "tool",
          content: result.success ? result.content : `Error: ${result.error}`,
          toolCallId: call.id,
          name: call.function.name
        });
      }
    }

    const exhausted = `Task could not be completed within ${this.maxSteps} steps.`;
    console.log(exhausted);
    return exhausted;
  }
}
