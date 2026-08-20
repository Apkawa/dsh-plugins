# @apkawa/dsh-model-settings

Auto-fills `contextWindow` for llama.cpp models in dsh's Models settings. When you add or
edit a model under a candidate provider (openai-completions / llama.cpp with a baseURL),
the plugin fetches the provider's `/v1/models` listing, reads each model's INI preset
(`ctx-size`, else `fit-ctx`), and writes the rounded value into the model's `contextWindow`.

## How it works

- **Watcher** on `settings/updated` (host side, filtered to the `llm-pi-ai` section).
- For each candidate route: one GET `<baseURL>/v1/models`, parse INI presets, fill every
  model that has no nonzero `contextWindow` yet.
- **Self-cycle guard**: a route whose models are all already sized is skipped entirely, so
  our own write never schedules another round.
- The existing Models UI displays the result (no separate card; the client half is disabled).

## Install

```
dsh plugin --profile web add github:apkawa/dsh-plugins#path:/packages/dsh-model-settings
```

## Debugging

Logs are quiet by default. Run dsh with `DEBUG=1` to see the plugin's trace output
(`fetchModels`, autofill rounds); error lines are always printed regardless of the flag.

## Development

See [AGENTS.md](../../AGENTS.md) for principles + pitfalls, and
[docs/ai/key-moments.md](../../docs/ai/key-moments.md) for architectural reference.
