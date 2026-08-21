# dsh-plugins

Plugins for [@deepseek-harness/dsh](https://github.com/deepseek-ai/deepseek-harness).
Each plugin lives under `packages/<name>/` and has its own README.

## Plugins

| Package | What it does |
|---------|--------------|
| [`dsh-model-settings`](./packages/dsh-model-settings/) | Per-model reasoning effort + context window management (autofill from `/v1/models` INI presets). |

## Install

Each plugin is installed as a profile layer via `dsh plugin add`. See the individual
README for the exact command. General form:

```
dsh plugin --profile web add github:apkawa/dsh-plugins#path:/packages/<name>
```
