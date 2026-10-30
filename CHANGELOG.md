# Changelog

## Unreleased

- README: strict `json_schema` is now accepted on every chat model in the
  capability matrix (re-measured 2026-10-29); the matrix replaces the delisted
  `DeepSeek-V4.1-Flash` with `DeepSeek-V4.1-Flash-1017`.
- `FlexAIChatModelId` suggests `DeepSeek-V4.1-Flash-1017` instead of the
  delisted `DeepSeek-V4.1-Flash`.

## 0.1.0

Initial release.

- `createFlexAI()` and a default `flexai` instance reading `FLEXAI_API_KEY`.
- Chat, completion, embedding and image model kinds over FlexAI's
  OpenAI-compatible API.
- `includeUsage` defaults to `true` — FlexAI reports no usage on a stream
  without `stream_options.include_usage`.
- `supportsStructuredOutputs` defaults to `true` — FlexAI enforces strict
  `json_schema` on most served models.
- API key resolved per request, so importing the default instance never throws.
