# Changelog

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
