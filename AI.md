# AI

All model use goes through `AIService`. Business logic must never name an OpenAI model directly. Fast, reasoning, and research modes are selected through server-side configuration.

The Context Builder will supply only the current message, relevant recent messages, summaries, verified memories, preferences, and open commitments. Speculation is not durable memory. Attention scores remain explainable through independently visible dimensions. The interface presents concise reasoning summaries, never hidden chain-of-thought.

Milestone 1 uses deterministic mock scoring, recommendations, and drafts. Real Responses API generation is deliberately inactive until a server-side key and privacy/retention settings are available.
