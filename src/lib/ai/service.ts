import type { Conversation } from "@/lib/domain";

export interface DraftRequest { conversation: Conversation; instruction?: string }
export interface AIService { generateDraft(request: DraftRequest): Promise<string> }

export class MockAIService implements AIService {
  async generateDraft({ conversation }: DraftRequest) {
    return conversation.draft ?? `Thanks for the message, ${conversation.person.name.split(" ")[0]}. I’ll take a look and get back to you shortly.`;
  }
}

export function getAIService(): AIService {
  // The provider stays behind this boundary. Production Responses API wiring is enabled
  // only after server-side credentials and retention settings are configured.
  return new MockAIService();
}
