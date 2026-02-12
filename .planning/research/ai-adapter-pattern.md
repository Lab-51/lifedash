# AI Adapter Pattern Research

## Summary
The Vercel AI SDK is the leading TypeScript solution for multi-provider LLM integration. It provides exactly the adapter pattern needed — unified API across OpenAI, Anthropic, Ollama, and more, with streaming support and type safety.

## Key Findings

### Vercel AI SDK (Recommended)

**Current Version:** AI SDK 5/6 (major updates in 2025)

**What it provides:**
- Unified TypeScript API for multiple LLM providers
- Provider adapters: OpenAI, Anthropic, Google, Mistral, Ollama, and more
- Streaming support across all providers
- Type-safe API with full TypeScript support
- Works in Node.js (perfect for Electron main process)
- Framework-agnostic core (not tied to Next.js)
- Tool/function calling support
- Structured output (JSON mode)

**Key benefit:** "Switch providers with a single line change" — exactly what Living Dashboard needs.

### Provider Support Matrix

| Provider | Package | Streaming | Tool Calling | Cost |
|----------|---------|-----------|-------------|------|
| OpenAI (GPT-4o-mini) | `@ai-sdk/openai` | Yes | Yes | ~$0.15/1M input tokens |
| Anthropic (Claude Haiku) | `@ai-sdk/anthropic` | Yes | Yes | ~$0.25/1M input tokens |
| Ollama (local) | `ollama-ai-provider` | Yes | Yes | Free (local) |
| Google (Gemini Flash) | `@ai-sdk/google` | Yes | Yes | Free tier available |
| Mistral | `@ai-sdk/mistral` | Yes | Yes | ~$0.1/1M input tokens |

### Architecture for Living Dashboard

```typescript
// Per-task model configuration
interface AIConfig {
  transcription: ModelConfig;    // Whisper local or API
  summarization: ModelConfig;    // GPT-4o-mini or Claude Haiku
  brainstorming: ModelConfig;    // GPT-4o or Claude Sonnet (higher quality)
  taskGeneration: ModelConfig;   // Any capable model
  ideaAnalysis: ModelConfig;     // Any capable model
}

interface ModelConfig {
  provider: 'openai' | 'anthropic' | 'ollama' | 'google' | 'mistral';
  model: string;
  temperature?: number;
  maxTokens?: number;
}
```

### Cost Tracking
- AI SDK doesn't have built-in cost tracking
- Implement token counting via response metadata (usage.promptTokens, usage.completionTokens)
- Map tokens to cost using provider-specific pricing
- Store in PostgreSQL for analytics

### Alternatives Considered

| Library | Pros | Cons |
|---------|------|------|
| **Vercel AI SDK** | Best DX, type-safe, maintained | Vercel-centric naming (but works standalone) |
| **LangChain.js** | Feature-rich, chains/agents | Heavy, complex, over-abstracted for simple use |
| **LiteLLM** | Python-based, 100+ providers | Python, not TypeScript native |
| **Custom adapters** | Full control | Maintenance burden, reimplements solved problems |

**Verdict:** Vercel AI SDK is the clear winner for TypeScript + multi-provider.

### Prompt Management
- Store system prompts in database or config files
- Template system for different tasks (summarize meeting, generate tasks, brainstorm)
- Version prompts so changes can be tracked
- User-editable prompts for power users

## Implementation Plan
1. Install `ai` + provider packages (`@ai-sdk/openai`, `@ai-sdk/anthropic`, `ollama-ai-provider`)
2. Create settings UI for per-task model selection
3. Build prompt templates for each AI task type
4. Implement token/cost tracking middleware
5. Add fallback chain (if primary fails, try secondary provider)

## Risks
- Vercel AI SDK updates frequently — pin versions
- Ollama provider is community-maintained (not official Vercel)
- Token counting accuracy varies by provider
- API keys management in Electron (secure storage needed)

## Sources
- https://ai-sdk.dev/docs/introduction
- https://vercel.com/blog/ai-sdk-5
- https://vercel.com/blog/ai-sdk-6
- https://github.com/vercel/ai
