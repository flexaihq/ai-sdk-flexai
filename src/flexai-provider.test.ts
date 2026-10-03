import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { generateObject, generateText, streamText } from 'ai';
import { z } from 'zod';

import {
  FLEXAI_DEFAULT_BASE_URL,
  createFlexAI,
  flexai,
} from './flexai-provider.js';
import { VERSION } from './version.js';

const MODEL = 'test-vendor/test-model';

/** Capture the request a model would make, without making it. */
function captureRequest(responseBody: unknown = chatCompletion()) {
  const calls: Array<{ url: string; headers: Headers; body: any }> = [];
  const fetch = (async (url: any, init: any) => {
    calls.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as any;
  return { calls, fetch };
}

function chatCompletion(content = 'ok') {
  return {
    id: 'cmpl-1',
    object: 'chat.completion',
    created: 0,
    model: MODEL,
    choices: [
      { index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

/** A minimal SSE stream, so streaming paths can be exercised offline. */
function sseStream(chunks: unknown[]) {
  const body =
    chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  return () =>
    Promise.resolve(
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
}

describe('configuration', () => {
  it('defaults to the FlexAI endpoint', async () => {
    const { calls, fetch } = captureRequest();
    await generateText({
      model: createFlexAI({ apiKey: 'k', fetch }).chatModel(MODEL),
      prompt: 'hi',
    });
    expect(calls[0]!.url).toBe(`${FLEXAI_DEFAULT_BASE_URL}/chat/completions`);
  });

  it('reads the API key from FLEXAI_API_KEY', async () => {
    vi.stubEnv('FLEXAI_API_KEY', 'from-env');
    const { calls, fetch } = captureRequest();
    await generateText({
      model: createFlexAI({ fetch }).chatModel(MODEL),
      prompt: 'hi',
    });
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer from-env');
    vi.unstubAllEnvs();
  });

  it('prefers an explicit API key over the environment', async () => {
    vi.stubEnv('FLEXAI_API_KEY', 'from-env');
    const { calls, fetch } = captureRequest();
    await generateText({
      model: createFlexAI({ apiKey: 'explicit', fetch }).chatModel(MODEL),
      prompt: 'hi',
    });
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer explicit');
    vi.unstubAllEnvs();
  });

  it('honours FLEXAI_API_BASE', async () => {
    vi.stubEnv('FLEXAI_API_BASE', 'https://eu.example/v1');
    const { calls, fetch } = captureRequest();
    await generateText({
      model: createFlexAI({ apiKey: 'k', fetch }).chatModel(MODEL),
      prompt: 'hi',
    });
    expect(calls[0]!.url).toBe('https://eu.example/v1/chat/completions');
    vi.unstubAllEnvs();
  });

  it('an explicit baseURL wins over the environment', async () => {
    vi.stubEnv('FLEXAI_API_BASE', 'https://eu.example/v1');
    const { calls, fetch } = captureRequest();
    await generateText({
      model: createFlexAI({
        apiKey: 'k',
        baseURL: 'https://other.example/v1',
        fetch,
      }).chatModel(MODEL),
      prompt: 'hi',
    });
    expect(calls[0]!.url).toBe('https://other.example/v1/chat/completions');
    vi.unstubAllEnvs();
  });

  it('strips a trailing slash from the baseURL', async () => {
    const { calls, fetch } = captureRequest();
    await generateText({
      model: createFlexAI({
        apiKey: 'k',
        baseURL: 'https://api.flex.ai/v1/',
        fetch,
      }).chatModel(MODEL),
      prompt: 'hi',
    });
    expect(calls[0]!.url).toBe('https://api.flex.ai/v1/chat/completions');
  });

  it('sends custom headers', async () => {
    const { calls, fetch } = captureRequest();
    await generateText({
      model: createFlexAI({
        apiKey: 'k',
        headers: { 'x-trace': 'abc' },
        fetch,
      }).chatModel(MODEL),
      prompt: 'hi',
    });
    expect(calls[0]!.headers.get('x-trace')).toBe('abc');
  });

  it('identifies itself in the user agent at the model layer', async () => {
    // Asserted against `doGenerate` rather than `generateText`: the `ai`
    // package sets its own `user-agent` on the request it hands the model,
    // and that replaces the provider-level one. The suffix this package adds
    // is therefore visible on a direct model call but not through the
    // top-level helpers — upstream behaviour, not something to work around.
    const { calls, fetch } = captureRequest();
    await createFlexAI({ apiKey: 'k', fetch })
      .chatModel(MODEL)
      .doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] });
    expect(calls[0]!.headers.get('user-agent')).toContain(
      `ai-sdk-flexai/${VERSION}`,
    );
  });

  it('importing the default instance does not require a key', () => {
    // The key is resolved per-request, so module load must not throw even
    // with no FLEXAI_API_KEY in the environment.
    vi.stubEnv('FLEXAI_API_KEY', undefined);
    expect(() => flexai.chatModel(MODEL)).not.toThrow();
    vi.unstubAllEnvs();
  });

  it('a missing key fails naming the FlexAI variable, not an OpenAI one', async () => {
    vi.stubEnv('FLEXAI_API_KEY', undefined);
    const { fetch } = captureRequest();
    await expect(
      generateText({ model: createFlexAI({ fetch }).chatModel(MODEL), prompt: 'hi' }),
    ).rejects.toThrow(/FLEXAI_API_KEY/);
    vi.unstubAllEnvs();
  });
});

describe('model kinds', () => {
  const p = createFlexAI({ apiKey: 'k' });

  it('is callable as a shorthand for chatModel', () => {
    expect(p(MODEL).modelId).toBe(MODEL);
    expect(p(MODEL).provider).toBe('flexai.chat');
  });

  it('exposes every ProviderV4 model kind', () => {
    expect(p.languageModel(MODEL).provider).toBe('flexai.chat');
    expect(p.chatModel(MODEL).provider).toBe('flexai.chat');
    expect(p.completionModel(MODEL).provider).toBe('flexai.completion');
    expect(p.embeddingModel('bge-m3').provider).toBe('flexai.embedding');
    expect(p.textEmbeddingModel('bge-m3').provider).toBe('flexai.embedding');
    expect(p.imageModel(MODEL).provider).toBe('flexai.image');
  });

  it('declares specification version v4', () => {
    expect(p.specificationVersion).toBe('v4');
  });
});

describe('stream usage default', () => {
  // The defect this package exists to avoid: FlexAI reports usage on a
  // stream only when stream_options.include_usage is sent, and
  // @ai-sdk/openai-compatible omits it unless asked.

  it('sends stream_options.include_usage by default', async () => {
    const bodies: any[] = [];
    const fetch = (async (_url: any, init: any) => {
      bodies.push(JSON.parse(String(init.body)));
      return sseStream([
        { choices: [{ index: 0, delta: { content: 'ok' } }] },
        { choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
      ])();
    }) as any;
    const result = streamText({
      model: createFlexAI({ apiKey: 'k', fetch }).chatModel(MODEL),
      prompt: 'hi',
    });
    await result.consumeStream();
    expect(bodies[0].stream).toBe(true);
    expect(bodies[0].stream_options).toEqual({ include_usage: true });
  });

  it('can be opted out of', async () => {
    const bodies: any[] = [];
    const fetch = (async (_url: any, init: any) => {
      bodies.push(JSON.parse(String(init.body)));
      return sseStream([{ choices: [{ index: 0, delta: { content: 'ok' } }] }])();
    }) as any;
    const result = streamText({
      model: createFlexAI({ apiKey: 'k', fetch, includeUsage: false }).chatModel(MODEL),
      prompt: 'hi',
    });
    await result.consumeStream();
    expect(bodies[0].stream_options).toBeUndefined();
  });
});

describe('structured output default', () => {
  const schema = z.object({ name: z.string() });

  it('sends a strict json_schema response format by default', async () => {
    const { calls, fetch } = captureRequest(chatCompletion('{"name":"x"}'));
    await generateObject({
      model: createFlexAI({ apiKey: 'k', fetch }).chatModel(MODEL),
      schema,
      prompt: 'hi',
    });
    expect(calls[0]!.body.response_format.type).toBe('json_schema');
    expect(calls[0]!.body.response_format.json_schema.strict).toBe(true);
  });

  it('falls back to json_object when opted out', async () => {
    const { calls, fetch } = captureRequest(chatCompletion('{"name":"x"}'));
    await generateObject({
      model: createFlexAI({
        apiKey: 'k',
        fetch,
        supportsStructuredOutputs: false,
      }).chatModel(MODEL),
      schema,
      prompt: 'hi',
    });
    expect(calls[0]!.body.response_format.type).toBe('json_object');
  });
});

describe('package metadata', () => {
  it('VERSION matches package.json', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    );
    expect(VERSION).toBe(pkg.version);
  });
});
