/**
 * Integration tests against the live FlexAI API.
 *
 * Require FLEXAI_API_KEY and a funded org; the whole suite skips without one,
 * so `npm test` stays offline and green.
 */
import { describe, expect, it } from 'vitest';
import { embed, generateObject, generateText, streamText, tool } from 'ai';
import { z } from 'zod';

import { createFlexAI } from '../src/flexai-provider.js';
import { BLUE_PNG, RED_PNG } from './fixtures.js';

const live = !!process.env['FLEXAI_API_KEY'];
const d = describe.skipIf(!live);

// Bare canonical ids, as returned by GET /v1/models.
const TEXT = process.env['FLEXAI_TEST_MODEL'] ?? 'DeepSeek-V4-Flash-0731';
const VISION = process.env['FLEXAI_TEST_VISION_MODEL'] ?? 'gemma-4-31b-it';
const REASONING = process.env['FLEXAI_TEST_REASONING_MODEL'] ?? 'gpt-oss-120b';
const EMBEDDING = process.env['FLEXAI_TEST_EMBEDDING_MODEL'] ?? 'bge-m3';
const COMPLETION =
  process.env['FLEXAI_TEST_COMPLETION_MODEL'] ?? 'Llama-3.3-70B-Instruct-FP8';

const flexai = createFlexAI();

d('text generation', () => {
  it('generateText returns content', async () => {
    const { text } = await generateText({
      model: flexai(TEXT),
      prompt: 'Reply with exactly: ok',
      maxOutputTokens: 32,
      temperature: 0,
    });
    expect(text.trim().length).toBeGreaterThan(0);
  });

  it('streamText yields multiple chunks', async () => {
    const result = streamText({
      model: flexai(TEXT),
      prompt: 'Count from 1 to 5, one number per line.',
      maxOutputTokens: 64,
      temperature: 0,
    });
    const chunks: string[] = [];
    for await (const c of result.textStream) chunks.push(c);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toMatch(/1/);
  });
});

d('completion models', () => {
  it('generates against /v1/completions', async () => {
    const { text, usage } = await generateText({
      model: flexai.completionModel(COMPLETION),
      prompt: 'The capital of France is',
      maxOutputTokens: 16,
      temperature: 0,
    });
    expect(text.length).toBeGreaterThan(0);
    expect(usage.inputTokens).toBeGreaterThan(0);
  });
});

d('token usage', () => {
  it('is reported on generateText', async () => {
    const { usage } = await generateText({
      model: flexai(TEXT),
      prompt: 'Reply with exactly: ok',
      maxOutputTokens: 32,
      temperature: 0,
    });
    expect(usage.inputTokens).toBeGreaterThan(0);
    expect(usage.outputTokens).toBeGreaterThan(0);
    expect(usage.totalTokens).toBeGreaterThan(0);
  });

  it('is reported on streamText — the default this package changes', async () => {
    const result = streamText({
      model: flexai(TEXT),
      prompt: 'Reply with exactly: ok',
      maxOutputTokens: 32,
      temperature: 0,
    });
    await result.consumeStream();
    const usage = await result.totalUsage;
    expect(usage.inputTokens).toBeGreaterThan(0);
    expect(usage.outputTokens).toBeGreaterThan(0);
  });

  it('is absent on a stream when includeUsage is disabled', async () => {
    // Pins the upstream behaviour this package's default exists to avoid:
    // without stream_options.include_usage, FlexAI reports nothing.
    const bare = createFlexAI({ includeUsage: false });
    const result = streamText({
      model: bare(TEXT),
      prompt: 'Reply with exactly: ok',
      maxOutputTokens: 32,
      temperature: 0,
    });
    await result.consumeStream();
    const usage = await result.totalUsage;
    expect(usage.inputTokens).toBeUndefined();
    expect(usage.outputTokens).toBeUndefined();
  });
});

d('tool calling', () => {
  const weather = tool({
    description: 'Get the current weather in a location.',
    inputSchema: z.object({ location: z.string().describe('City name') }),
    execute: async ({ location }) => ({ location, tempC: 17 }),
  });

  it('emits a tool call with parsed arguments', async () => {
    const { toolCalls } = await generateText({
      model: flexai(TEXT),
      tools: { weather },
      prompt: 'What is the weather in Paris? Use the tool.',
      maxOutputTokens: 256,
      temperature: 0,
    });
    expect(toolCalls.length).toBeGreaterThan(0);
    expect(toolCalls[0]!.toolName).toBe('weather');
    expect(JSON.stringify(toolCalls[0]!.input).toLowerCase()).toContain('paris');
  });

  it('runs a full tool round-trip', async () => {
    const { text } = await generateText({
      model: flexai(TEXT),
      tools: { weather },
      prompt: 'What is the weather in Paris? Use the tool, then answer.',
      maxOutputTokens: 512,
      temperature: 0,
      stopWhen: ({ steps }) => steps.length >= 3,
    });
    expect(text.length).toBeGreaterThan(0);
  });

  it('honours a forced tool choice on a model that supports it', async () => {
    const { toolCalls } = await generateText({
      model: flexai(TEXT),
      tools: { weather },
      toolChoice: 'required',
      prompt: 'Say hello.',
      maxOutputTokens: 256,
      temperature: 0,
    });
    expect(toolCalls.length).toBeGreaterThan(0);
  });

  it('forced tool choice is rejected, not faked, on a model that declines', async () => {
    // Per-model and best-effort rather than constrained decoding: the
    // gateway answers 400 rather than inventing a call.
    await expect(
      generateText({
        model: flexai(VISION),
        tools: { weather },
        toolChoice: 'required',
        prompt: 'Say hello.',
        maxOutputTokens: 256,
        temperature: 0,
      }),
    ).rejects.toThrow();
  });
});

d('structured output', () => {
  const schema = z.object({
    name: z.string(),
    age: z.number().int(),
  });

  it('generateObject returns a schema-conforming object', async () => {
    const { object } = await generateObject({
      model: flexai(TEXT),
      schema,
      prompt: 'Invent a person.',
      maxOutputTokens: 256,
      temperature: 0,
    });
    expect(typeof object.name).toBe('string');
    expect(Number.isInteger(object.age)).toBe(true);
  });

  it('a model without structured-output support rejects rather than ignoring', async () => {
    await expect(
      generateObject({
        model: flexai('Muse-Glimmer-30B'),
        schema,
        prompt: 'Invent a person.',
        maxOutputTokens: 256,
        temperature: 0,
      }),
    ).rejects.toThrow();
  });
});

d('vision', () => {
  it.each([
    ['red', RED_PNG, /red/i],
    ['blue', BLUE_PNG, /blue/i],
  ])(
    'reads a %s image on a vision model',
    async (_name, png, expected) => {
      const { text } = await generateText({
        model: flexai(VISION),
        maxOutputTokens: 512,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What colour fills this image? One word.' },
              { type: 'file', data: png, mediaType: 'image/png' },
            ],
          },
        ],
      });
      expect(text).toMatch(expected);
    },
  );

  it('a non-vision model rejects an image rather than accepting it silently', async () => {
    await expect(
      generateText({
        model: flexai(TEXT),
        maxOutputTokens: 64,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What colour is this?' },
              { type: 'file', data: RED_PNG, mediaType: 'image/png' },
            ],
          },
        ],
      }),
    ).rejects.toThrow(/multimodal/i);
  });
});

d('reasoning', () => {
  it('surfaces a reasoning trace on generateText', async () => {
    const { reasoningText } = await generateText({
      model: flexai(REASONING),
      prompt: 'What is 17*23? Think it through.',
      maxOutputTokens: 1024,
      temperature: 0,
    });
    expect(reasoningText?.length ?? 0).toBeGreaterThan(0);
  });

  it('surfaces a reasoning trace on streamText', async () => {
    const result = streamText({
      model: flexai(REASONING),
      prompt: 'What is 12*9? Think it through.',
      maxOutputTokens: 1024,
      temperature: 0,
    });
    await result.consumeStream();
    expect((await result.reasoningText)?.length ?? 0).toBeGreaterThan(0);
  });
});

d('embeddings', () => {
  it('embeds a string', async () => {
    const { embedding } = await embed({
      model: flexai.embeddingModel(EMBEDDING),
      value: 'speculative decoding',
    });
    expect(embedding.length).toBeGreaterThan(0);
    expect(typeof embedding[0]).toBe('number');
  });
});
