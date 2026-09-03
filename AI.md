# AI

All model use goes through `AIService`. Business logic must never name an OpenAI model directly. Fast, reasoning, and research modes are selected through server-side configuration.

The Context Builder will supply only the current message, relevant recent messages, summaries, verified memories, preferences, and open commitments. Speculation is not durable memory. Attention scores remain explainable through independently visible dimensions. The interface presents concise reasoning summaries, never hidden chain-of-thought.

Rule-based scoring remains available before AI analysis. AI Intelligence v1 adds an owner-initiated Responses API analysis for one selected email at a time. The request includes only sender name, subject, current rule category, and at most 2,000 characters of message text. Requests use structured outputs and `store: false`; no full-inbox or background AI analysis is permitted.

Production requires server-only `OPENAI_API_KEY`. `OPENAI_FAST_MODEL` is optional and defaults to `gpt-5.6-luna`. Never expose either variable with a `NEXT_PUBLIC_` prefix.

Automatic intelligence runs one message at a time while the authenticated, MFA-verified owner has the app open. Recent sent Outlook messages are retained only when they match an imported conversation and are used as bounded writing-style examples. Generated replies are editable suggestions; sending remains a separate owner-approved action.
