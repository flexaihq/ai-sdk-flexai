import {
  OpenAICompatibleChatLanguageModel,
  OpenAICompatibleCompletionLanguageModel,
  OpenAICompatibleEmbeddingModel,
  OpenAICompatibleImageModel,
} from '@ai-sdk/openai-compatible';
import type {
  EmbeddingModelV4,
  ImageModelV4,
  LanguageModelV4,
  ProviderV4,
} from '@ai-sdk/provider';
import {
  type FetchFunction,
  loadApiKey,
  withUserAgentSuffix,
  withoutTrailingSlash,
} from '@ai-sdk/provider-utils';

import { VERSION } from './version.js';

/**
 * Default FlexAI inference endpoint.
 */
export const FLEXAI_DEFAULT_BASE_URL = 'https://api.flex.ai/v1';

/**
 * A FlexAI model id, as returned by `GET /v1/models`.
 *
 * FlexAI requires the canonical id — the bare model name, with no
 * organisation prefix (`'DeepSeek-V4-Flash-0731'`, not
 * `'deepseek-ai/DeepSeek-V4-Flash-0731'`). Typed as a loose string union so
 * that editors suggest known-good ids without rejecting a model that FlexAI
 * started serving after this package was published.
 */
export type FlexAIChatModelId =
  | 'DeepSeek-V4-Flash-0731'
  | 'DeepSeek-V4.1-Flash'
  | 'GLM-5.2'
  | 'GLM-5.3-Flash'
  | 'gpt-oss-120b'
  | 'gpt-oss-20b'
  | 'gemma-4-31b-it'
  | 'Llama-3.3-70B-Instruct-FP8'
  | 'Qwen3-Coder-30B-A3B-Instruct-FP8'
  | (string & {});

export type FlexAICompletionModelId = string & {};
export type FlexAIEmbeddingModelId = 'bge-m3' | (string & {});
export type FlexAIImageModelId = string & {};

export interface FlexAIProviderSettings {
  /**
   * FlexAI API key. Defaults to the `FLEXAI_API_KEY` environment variable.
   *
   * Resolved lazily, on the first request rather than at construction, so
   * that importing the default `flexai` instance never throws in a process
   * that has no key set.
   */
  apiKey?: string;

  /**
   * Endpoint URL. Defaults to the `FLEXAI_API_BASE` environment variable,
   * else {@link FLEXAI_DEFAULT_BASE_URL}.
   */
  baseURL?: string;

  /**
   * Extra headers to send with every request.
   */
  headers?: Record<string, string>;

  /**
   * Custom fetch implementation, for middleware or testing.
   */
  fetch?: FetchFunction;

  /**
   * Ask for token usage on streamed responses.
   *
   * Defaults to `true`, which is NOT the `@ai-sdk/openai-compatible`
   * default. FlexAI only reports usage on a stream when
   * `stream_options.include_usage` is sent; with it absent, `totalUsage` on
   * every `streamText` / `streamObject` call resolves to zero/undefined token
   * counts and cost tracking silently reports nothing. Set `false` to opt out.
   */
  includeUsage?: boolean;

  /**
   * Send a strict `json_schema` response format for schema-constrained
   * requests (`generateObject`, `streamObject`).
   *
   * Defaults to `true`, which is NOT the `@ai-sdk/openai-compatible`
   * default. FlexAI enforces strict JSON schema on most served models. The
   * models that do not support it reject the request with a 400 naming the
   * unsupported parameter, rather than silently ignoring it — so a failure is
   * visible rather than a malformed object. Set `false` to fall back to
   * prompt-guided JSON mode for a model that does not support it.
   */
  supportsStructuredOutputs?: boolean;
}

export interface FlexAIProvider extends ProviderV4 {
  /**
   * Create a chat model. Equivalent to {@link FlexAIProvider.chatModel}.
   */
  (modelId: FlexAIChatModelId): LanguageModelV4;

  languageModel(modelId: FlexAIChatModelId): LanguageModelV4;
  chatModel(modelId: FlexAIChatModelId): LanguageModelV4;
  completionModel(modelId: FlexAICompletionModelId): LanguageModelV4;
  embeddingModel(modelId: FlexAIEmbeddingModelId): EmbeddingModelV4;
  /**
   * @deprecated Use `embeddingModel` instead.
   */
  textEmbeddingModel(modelId: FlexAIEmbeddingModelId): EmbeddingModelV4;
  imageModel(modelId: FlexAIImageModelId): ImageModelV4;
}

/**
 * Create a FlexAI provider instance.
 *
 * FlexAI serves open-weight models behind an OpenAI-compatible API, so this
 * is a thin configuration of `@ai-sdk/openai-compatible` rather than a
 * separate client — with two defaults changed, both documented on
 * {@link FlexAIProviderSettings}.
 */
export function createFlexAI(
  options: FlexAIProviderSettings = {},
): FlexAIProvider {
  const baseURL =
    withoutTrailingSlash(
      options.baseURL ??
        process.env['FLEXAI_API_BASE'] ??
        FLEXAI_DEFAULT_BASE_URL,
    ) ?? FLEXAI_DEFAULT_BASE_URL;

  // A thunk, not a value: `loadApiKey` throws when no key is configured, and
  // resolving it here would make `import { flexai }` fail at module load in
  // any process without the variable set — including unit tests that never
  // make a request.
  const getHeaders = () =>
    withUserAgentSuffix(
      {
        Authorization: `Bearer ${loadApiKey({
          apiKey: options.apiKey,
          environmentVariableName: 'FLEXAI_API_KEY',
          description: "FlexAI's API key",
        })}`,
        ...options.headers,
      },
      `ai-sdk-flexai/${VERSION}`,
    );

  const commonConfig = (modelType: string) => ({
    provider: `flexai.${modelType}`,
    url: ({ path }: { path: string }) => `${baseURL}${path}`,
    headers: getHeaders,
    fetch: options.fetch,
  });

  const includeUsage = options.includeUsage ?? true;

  const createChatModel = (modelId: FlexAIChatModelId): LanguageModelV4 =>
    new OpenAICompatibleChatLanguageModel(modelId, {
      ...commonConfig('chat'),
      includeUsage,
      supportsStructuredOutputs: options.supportsStructuredOutputs ?? true,
    });

  const createCompletionModel = (
    modelId: FlexAICompletionModelId,
  ): LanguageModelV4 =>
    new OpenAICompatibleCompletionLanguageModel(modelId, {
      ...commonConfig('completion'),
      includeUsage,
    });

  const createEmbeddingModel = (
    modelId: FlexAIEmbeddingModelId,
  ): EmbeddingModelV4 =>
    new OpenAICompatibleEmbeddingModel(modelId, commonConfig('embedding'));

  const createImageModel = (modelId: FlexAIImageModelId): ImageModelV4 =>
    new OpenAICompatibleImageModel(modelId, commonConfig('image'));

  const provider = (modelId: FlexAIChatModelId) => createChatModel(modelId);

  provider.specificationVersion = 'v4' as const;
  provider.languageModel = createChatModel;
  provider.chatModel = createChatModel;
  provider.completionModel = createCompletionModel;
  provider.embeddingModel = createEmbeddingModel;
  provider.textEmbeddingModel = createEmbeddingModel;
  provider.imageModel = createImageModel;

  return provider as FlexAIProvider;
}

/**
 * Default FlexAI provider instance, reading `FLEXAI_API_KEY` from the
 * environment on first use.
 */
export const flexai = createFlexAI();
