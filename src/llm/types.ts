export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type CompleteRequest = {
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /**
   * When set, the adapter asks the provider for JSON matching this schema using
   * whatever native mechanism it has, and falls back to prompt-level coercion.
   */
  jsonSchema?: Record<string, unknown>;
};

export type CompleteResponse = {
  text: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
};

export interface LlmClient {
  readonly name: string;
  readonly model: string;
  complete(req: CompleteRequest): Promise<CompleteResponse>;
}
