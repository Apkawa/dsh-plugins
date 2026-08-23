# e2e-live-dsh — research

Goal: launch an independent dsh instance (clean settings, separate home + port) as infrastructure for e2e tests; e2e checks themselves are out of scope (user's side).

## Findings

### Home / state isolation
- dsh home resolution: `$DSH_HOME` env wins, fallback `~/.dsh` (see `dsh/packages/identity/anonymous-user-id/src/index.ts` — "harness home resolved by `resolveDshHome` (`$DSH_HOME` > `~/.dsh`)").
- `DSH_AGENTS_HOME` is a second, separate home (agents); e2e tests in dsh itself set both to temp dirs (`dsh/packages/examples/acp-demo/tests/built-bin.e2e.ts`, `acp-agent.spec.ts`).
- File-backed state lives under `$DSH_HOME`: `.credentials.yaml` (API keys), `.env` (read-only fallback), `AGENTS.md`, anonymous-user id, settings. So a fresh temp `DSH_HOME` = clean settings.
- Credentials precedence: process env > `.credentials.yaml` > `$DSH_HOME/.env` — a clean home has no API keys; they must be injected via env or written to the temp home.

### Launch patterns in dsh's own tests (to copy)
- `dsh/packages/examples/acp-demo/tests/built-bin.e2e.ts` and `acp-agent.spec.ts` spawn dsh with `DSH_HOME=<tmp>/.dsh`, `DSH_AGENTS_HOME=<tmp>/.agents`.
- Web GUI: only `dsh web` injects `window.__DSH_BOOT__`; the apps/web Vite entry alone is not a standalone app (from dsh `web-app` bundle source).

### dsh's own live-web e2e pattern (apps/web/tests/smoke-real.e2e.ts) — the template to copy
- Spawn: `node --import <tsx-loader> <dsh-repo>/apps/cli/src/bin.ts web --port <N>` (or `--port 0` for an OS-chosen free port; helper `probeFreePort()` in `apps/web/tests/support.ts`).
- Env: `DSH_HOME=<tmp>/.dsh`, `DSH_AGENTS_HOME=<tmp>/.agents`, `DEEPSEEK_API_KEY=...` (required for a real keyless-free boot; a fake key also boots, tests just won't complete LLM calls), optional `DEEPSEEK_BASE_URL=...` to redirect to a mock provider (they even stand up an inline SSE mock for retry tests).
- `cwd` = temp dir matters: the CLI auto-loads `.env` from cwd and sessions land under cwd — temp cwd keeps sessions out of the repo.
- Readiness: parse child stdout/stderr for `dsh web: http://...` (90s timeout); then `fetch(url)` must be 200.
- Headless driver: JSON-RPC over HTTP `POST {base}/api/<method>` with body `{type:'client-request', rpcId, method, payload}`; response `{result: {ok, value|error}}`. Used methods: `session.create`, `session.prompt`, `session.history`, `session.list`. UI-level checks use playwright chromium (repo has the dep; browser binaries via playwright).
- Teardown: SIGTERM → wait close → SIGKILL fallback → `rmSync` temp dir.
- `--patch <overlay.yml>` is a launcher flag (they pin a UI picker this way) — a way to inject extra composition without a profile.

### Plugin install mechanics (docs/user/develop/basic/publish.md)
- `dsh plugin --profile <name> add <spec>`; spec can be local dir path, local tarball (`pnpm pack`), `github:you/repo[#sha]`, or npm name. First use initializes the profile with `@deepseek-ai/dsh-base` first.
- Profiles live under `$DSH_HOME/profiles/<name>` (manifest `dsh.profile` + own `cordis.patch.yml`); boot with `dsh --profile <name>`.
- Layer order: profile bundles (in order) → profile patch → `$DSH_HOME/cordis.patch.yml` (machine-local, shared by all profiles) → `--patch` overlays (argv order).
- `dsh --profile <name> --dump-config` verifies layering without booting.
- Local dir add = pnpm link; no build-script permission issue (that's git-install only).

### Live instance wiring (what "clean + plugin" concretely means)
- The user's live GUI (:3080) is the installed CLI: `/home/apkawa/.nvm/versions/node/v24.19.0/bin/dsh` v0.1.1-rc.2; `dsh web` is a hardcoded alias for `--profile web` (reference: `dsh/apps/cli/reference/README.md`).
- `~/.dsh/profiles/web/package.json` = auto-initialized `web` profile (bundles `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`) plus the user's plugin: dependency `"@apkawa/dsh-model-settings": "link:/home/apkawa/code/dsh-model-settings/packages/dsh-model-settings"` and the bundle appended to `dsh.profile.bundles`. Profile `cordis.patch.yml` is `[]`.
- So a clean home with our plugin = fresh `DSH_HOME` + `dsh plugin --profile web add <abs path>` (local dir spec = pnpm link, no allowBuilds). The `web` profile auto-initializes from the shipped template (base + web-app) on first use, so the add step both creates the profile and wires the plugin.
- `~/.dsh/settings.yaml` does not exist until first settings write — a fresh home truly has clean settings (no providers configured; the live home has a custom `llm-pi-ai` llama.cpp provider with `apiKeyEnv: URABE_API_KEY`).
- Provider credentials resolve from inherited env first — the launcher must inherit `DEEPSEEK_API_KEY` / `URABE_API_KEY` from the calling shell; a clean home has none of its own.

### Boot/shutdown facts (installed CLI)
- `dsh web` serves `http://127.0.0.1:3080` by default; `--port` / `--host` are web-app flags after the alias; `--host 0.0.0.0` is rejected (usage error). Launcher flags come first, app args after the first unknown token.
- SIGTERM = supervisor stop request: graceful drain (≤5s), exit 0; second signal forces exit.
- CLI treats the invoking directory as workspace root, loads `AGENTS.md`/`CLAUDE.md` from it, and sessions land under it — set `cwd` to the temp root.
- `--dump-config` / `--dump-default-config` print the composed tree without booting (useful debug for "is our layer in?").

### Verification surface for "the plugin actually loaded"
- HTTP JSON-RPC: `POST {base}/api/<...>` body `{type:'client-request', rpcId, method, payload}` → `{result:{ok, value|error}}` (proven in dsh smoke tests).
- Our host half registers the `/model-settings` RPC channel with endpoints `listModels`, `fetchModels`, `applyContextWindows`, `listReasoningRows`, `saveModel`, `refreshContextWindow` (src/index.ts). A `listModels` call answering `ok:true` proves host + channel mounted; the channel only exists if our bundle loaded.
- Client-side proof (for the user's own e2e, playwright): page settles without "Failed to load plugins", Settings shows the Model settings section.
- Our package `@apkawa/dsh-model-settings` v0.1.0 is already built (`lib/index.js`, `lib/client.js` present); `package.json` declares `dsh.bundle.patch` + `dsh.client` inject — installable via `dsh plugin add`.

### Open questions
- `--port 0` (OS-chosen free port) on the installed CLI: proven in dsh source smoke tests; verify on installed 0.1.1-rc.2 at implementation time. Fallback: pick a free port ourselves. (Not needed now: default port is fixed 3081.)
- Exact RPC URL form for a named channel (probably `/api/<channel>.<endpoint>`); confirm empirically via `listModels`.

### Implementation findings (green run, in-sandbox)
- Gateway method names carry `/` (e.g. `goals/create`, probe `POST /api/goals/create` in `packages/api/gateway/tests/gateway.host.spec.ts`).
- **Channel RPC wire format (confirmed live)**: the client (dsh-client-connection `createWebConnectionRpc`) posts `URL = <origin><channel>/<endpoint>` — for us `POST http://<host>/model-settings/listModels` — with body `{type:'client-request', rpcId, method: <endpoint>, payload}` (method = endpoint only). Verified live: `listModels` / `listReasoningRows` → `result.ok:true, value:[]` on the clean instance (proves the host half mounted).
- **Harness `/tmp` is per-namespace**: bash calls and background jobs do NOT share `/tmp` (files vanish between calls; within one call/job it is consistent). The launcher's temp-root design is unaffected (single process), but cross-call verification must happen inside one call/job.
- **pnpm global store outside the sandbox**: `dsh plugin add` needs the pnpm store; under the workspace-write sandbox the default store `/home/apkawa/.local/share/pnpm` is EROFS. Workaround for in-session runs only: `pnpm_config_store_dir=<writable dir>` env (honored by pnpm; NOT baked into the script — real terminals have no such limit).
- **Profile desync sharp edge**: running any `dsh` CLI command against the e2e home with a different pnpm-store view (e.g. `--dump-config` from another call without the store env) made dsh reconcile the profile against the broken store and dropped the plugin dependency from the profile `package.json`. In a real terminal (one store everywhere) this cannot happen; noted as a dsh quirk, not a launcher defect.
- Live instance wiring confirmed in a clean home: profile auto-init (base + web-app) + `link:` dep + bundle layer appear exactly like `~/.dsh/profiles/web`.
