# @flexai/ai-sdk-provider

[Vercel AI SDK](https://ai-sdk.dev) provider for [FlexAI](https://flex.ai) —
open-weight models served behind an OpenAI-compatible API.

## Installation

```bash
npm install @flexai/ai-sdk-provider ai zod
export FLEXAI_API_KEY="your-api-key"
```

## Usage

```ts
import { flexai } from '@flexai/ai-sdk-provider';
import { generateText } from 'ai';

const { text } = await generateText({
  model: flexai('DeepSeek-V4-Flash-0731'),
  prompt: 'Explain speculative decoding in two sentences.',
});
```

`flexai` is a default instance reading `FLEXAI_API_KEY`. For a custom setup:

```ts
import { createFlexAI } from '@flexai/ai-sdk-provider';

const flexai = createFlexAI({
  apiKey: process.env.FLEXAI_API_KEY,
  baseURL: 'https://api.flex.ai/v1',
});
```

Model ids are the **canonical bare name** as returned by `GET /v1/models` —
`'DeepSeek-V4-Flash-0731'`, not `'deepseek-ai/DeepSeek-V4-Flash-0731'`. FlexAI
rejects an organisation-prefixed id.

### Model kinds

```ts
flexai('<id>')                      // chat (shorthand)
flexai.chatModel('<id>')
flexai.languageModel('<id>')
flexai.completionModel('<id>')      // /v1/completions
flexai.embeddingModel('bge-m3')     // /v1/embeddings
flexai.imageModel('<id>')           // /v1/images/generations — see caveats
```

### Streaming

```ts
import { streamText } from 'ai';

const result = streamText({
  model: flexai('DeepSeek-V4-Flash-0731'),
  prompt: 'Write a haiku about GPUs.',
});

for await (const chunk of result.textStream) process.stdout.write(chunk);

const usage = await result.totalUsage; // reported — see "Token usage" below
```

### Tool calling

```ts
import { generateText, tool } from 'ai';
import { z } from 'zod';

const { toolCalls } = await generateText({
  model: flexai('DeepSeek-V4-Flash-0731'),
  tools: {
    weather: tool({
      description: 'Get the current weather in a location.',
      inputSchema: z.object({ location: z.string() }),
      execute: async ({ location }) => ({ location, tempC: 17 }),
    }),
  },
  prompt: 'What is the weather in Paris?',
});
```

### Structured output

```ts
import { generateObject } from 'ai';
import { z } from 'zod';

const { object } = await generateObject({
  model: flexai('DeepSeek-V4-Flash-0731'),
  schema: z.object({ name: z.string(), age: z.number().int() }),
  prompt: 'Invent a person.',
});
```

### Image input

Vision models read an image part. Pass the bytes as a `file` part:

```ts
const { text } = await generateText({
  model: flexai('gemma-4-31b-it'),
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What colour fills this image?' },
        { type: 'file', data: pngBytes, mediaType: 'image/png' },
      ],
    },
  ],
});
```

### Reasoning models

Some FlexAI-served models return a reasoning trace in a non-standard
`reasoning_content` field. `@ai-sdk/openai-compatible` already maps that field
onto the SDK's reasoning parts, so it is available with no extra configuration
on both `generateText` and `streamText`:

```ts
const { reasoningText } = await generateText({
  model: flexai('gpt-oss-120b'),
  prompt: 'What is 17*23? Think it through.',
  maxOutputTokens: 1024,
});
```

This package does not add that support — it inherits it. Not every reasoning
model uses the field; some reason inline in `content`. Treat it as
present-or-absent rather than guaranteed.

## Two defaults this package changes

FlexAI is OpenAI-compatible, so this is a thin configuration of
`@ai-sdk/openai-compatible` rather than a separate client. Two of that
package's defaults are wrong for FlexAI, and both are changed here:

| Setting | Upstream default | Here | Why |
|---|---|---|---|
| `includeUsage` | `undefined` (off) | `true` | FlexAI reports usage on a stream only when `stream_options.include_usage` is sent. Left off, `totalUsage` resolves to all-`undefined` token counts on **every** streamed response — no error, just silently absent cost tracking. |
| `supportsStructuredOutputs` | `false` | `true` | FlexAI enforces strict `json_schema` on a good share of served models. Left off, `generateObject` never uses the constrained path and falls back to prompt-guided JSON. |

Both are overridable:

```ts
createFlexAI({ includeUsage: false, supportsStructuredOutputs: false });
```

A caveat on the second one, because the obvious assumption is wrong. Turning
`supportsStructuredOutputs` **off** is not a general rescue for a model that
rejects `json_schema`. Measured across the six models that failed
`generateObject` with the default on, opting out rescued exactly **one**
(`Qwen3.6-27B-FP8`); the other five still failed, just with a vaguer
`AI_NoObjectGeneratedError` instead of a 400 naming the unsupported parameter.
Leaving the default on is what gives you the actionable error.

## Token usage

Reported on both paths. Verified live:

```ts
const { usage } = await generateText({ /* … */ });
usage.inputTokens; usage.outputTokens; usage.totalTokens;

const result = streamText({ /* … */ });
await result.consumeStream();
const streamed = await result.totalUsage; // populated, because includeUsage defaults true
```

## Capabilities vary by model

FlexAI serves many models through one endpoint, so some behaviour is per-model
rather than provider-wide. Every row below was measured against the live API on
2026-10-02 and is covered by a test in `tests/integration.test.ts`.

| Behaviour | What we measured |
|---|---|
| **Streaming usage** | Absent unless `stream_options.include_usage` is sent. This package sends it by default. |
| **Forced tool choice** | Per-model, and best-effort rather than constrained decoding. `DeepSeek-V4-Flash-0731` and `gpt-oss-120b` honour `toolChoice: 'required'` on a prompt that invites no tool call; `gemma-4-31b-it` declines and the gateway returns `400` rather than inventing a call. |
| **Structured output** | Strict `json_schema` is enforced on a subset — 5 of the 11 chat models we measured. A model that does not support it **rejects** the request with a 400 naming `response_format`, rather than silently ignoring it. |
| **`supported_parameters` is not a reliable predictor** | FlexAI's own 400 says to use "a model that advertises `structured_outputs` in its `/v1/models` `supported_parameters`" — but **no model currently advertises that value**, and several that list `response_format` still reject `json_schema` (`Qwen3.6-27B-FP8`, `Step-3.7-Flash`, `GLM-5.3-Flash`, `DeepSeek-V4.1-Flash`). Measure, do not infer. |
| **Image input** | Vision models only. Most non-vision models reject with `400 … is not a multimodal model`. `gpt-oss-120b` and `gpt-oss-20b` are the exceptions: they **accept** an image part and ignore it (120b answers "I'm unable to view the image"; 20b returns empty content) — so a 200 is not proof the image was read. |
| **The catalog can understate a model** | `DeepSeek-V4.1-Flash` reports `input_modalities: ["text"]` and `category: "text"` in `GET /v1/models`, but reads images correctly on both fixtures. |
| **Reasoning traces** | Returned in `reasoning_content` by `gpt-oss-120b`; mapped to SDK reasoning parts by the base package. `DeepSeek-V4-Flash-0731` reasons inline in `content` instead. |
| **`max_output_length`** | Mirrors `context_length` on every chat row in `GET /v1/models`. It is not a real output cap — do not treat it as one. |
| **Low `maxOutputTokens` on a reasoning model** | Returns empty content with `finish_reason: "stop"`, because the budget went to hidden reasoning. Two vision models (`Step-3.7-Flash`, `GLM-5.3-Flash`) looked blind at 24 tokens and read both fixtures correctly at 1024. Budget generously before concluding a model cannot do something. |

### Measured capability matrix

Probed through this package against the live API on 2026-10-02. Image input
was verified with **two** different solid-colour fixtures, so a model that
always guesses the same colour cannot pass.

| Model | Image Input | Object Generation | Tool Usage | Tool Streaming |
| --- | --- | --- | --- | --- |
| `DeepSeek-V4-Flash-0731` | no | yes | yes | yes |
| `DeepSeek-V4.1-Flash` | yes | no | yes | yes |
| `GLM-5.2` | no | no | yes | yes |
| `gpt-oss-120b` | no | yes | yes | yes |
| `gpt-oss-20b` | no | no | yes | yes |
| `Llama-3.3-70B-Instruct-FP8` | no | yes | yes | yes |
| `Qwen3-Coder-30B-A3B-Instruct-FP8` | no | yes | yes | yes |
| `gemma-4-31b-it` | yes | yes | yes | yes |
| `Qwen3.6-27B-FP8` | yes | no | yes | yes |
| `Step-3.7-Flash` | yes | no | yes | yes |
| `GLM-5.3-Flash` | yes | no | yes | yes |

The model list changes; re-measure rather than trusting this table
indefinitely.

## Configuration

| Setting | Env var | Default |
|---|---|---|
| `apiKey` | `FLEXAI_API_KEY` | — (required) |
| `baseURL` | `FLEXAI_API_BASE` | `https://api.flex.ai/v1` |
| `headers` | — | — |
| `fetch` | — | global `fetch` |
| `includeUsage` | — | `true` |
| `supportsStructuredOutputs` | — | `true` |

The API key is resolved **per request**, not at construction, so importing the
default `flexai` instance never throws in a process that has no key set.

## Not verified

Stated plainly rather than implied:

- **Image generation.** `flexai.imageModel()` is wired to `/v1/images/generations`,
  but FlexAI's only image model (`FLUX.1-schnell`) reports `is_ready: false`, so
  this path has **not** been exercised against a live model.
- **Transcription and speech.** Not exposed. FlexAI lists `whisper-large-v3-turbo`,
  `parakeet-tdt-0.6b-v3` and `Kokoro-82M`, all currently `is_ready: false`.
- **Reranking.** No served model.
- **User-agent.** This package adds an `ai-sdk-flexai/<version>` suffix, which is
  visible on a direct model call. The `ai` package replaces the `user-agent` on
  requests made through `generateText`/`streamText`, so the suffix does not
  appear there. Upstream behaviour, not worked around.

## Relationship to `@ai-sdk/openai-compatible`

Using `createOpenAICompatible({ baseURL: 'https://api.flex.ai/v1', name: 'flexai', apiKey, includeUsage: true, supportsStructuredOutputs: true })`
directly is equivalent and supported. This package just supplies the defaults,
the env-var wiring and the model-id types.

## Development

```bash
npm install
npm run build
npm test                  # unit tests, no network
npm run test:integration  # live API; skips without FLEXAI_API_KEY
```

## Documentation

[docs.flex.ai](https://docs.flex.ai)

## License

MIT
