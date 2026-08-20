# dsh-plugins — plugins for @deepseek-harness/dsh


## Paths

* `dsh/` - symlink to deepseek-harness. use readonly for research
* `docs/ai/` - reference notes for AI sessions (key moments, links into dsh source)

## Principles

* **TDD** — failing test first, then implementation (red → green → refactor). Every exported function has a unit test; probe logic is tested against recorded fixtures, never live network in unit tests. A behavior without a test does not count as done.
* **KISS** — minimal modules, no premature abstractions, no new dependencies beyond declared peers. If a simpler design serves the current iteration, ship it and note the trade-off instead of building for imagined futures.
* **SOLID** — one responsibility per module; orchestration depends on small injected interfaces (`Fetcher`, `SettingsStore`), not concrete dsh seams or `fetch`; new capabilities (T2–T5) are added as new consumers/modules, not by rewriting the core.

## Pitfalls (learned the hard way)

1. **URL construction from a user-configurable base**: always verify against a LIVE endpoint, not just fixtures. The double-`/v1` bug (`.../v1/v1/models`) passed every fixture test but 404'd in production because the real `baseURL` already ended with `/v1`. When joining a base + path, detect whether the base already carries the version prefix; handle both spellings.

2. **Install mechanism**: a plugin package is installable via `dsh plugin add` only if its `package.json` declares `"dsh": {"bundle": {"patch": "./cordis.patch.yml"}}` and ships a `cordis.patch.yml`. Without it, the loader cannot derive the host/client halves from the `.` / `./client` exports. The row references the package by NAME; the loader resolves the rest.

3. **Slot hierarchy**: `settings.plugin.item` is a CHILD slot (under the Plugins section's configurable tab), NOT a top-level settings row. Registering there lands your card inside the Plugins accordion, not beside General/Models. For a top-level card use `settings.section`; or extend the existing Models UI instead of building a new widget. Query the slot tree (`Slots.listSubTree`) before registering — do not guess the parent.

4. **Event names (host vs client)**: `settings/updated(ns, next, prev, source)` is the HOST-side event (fires after each commit when the resolved value changes; never for a deep-equal value). `settings/document-updated(ns, revision)` is the CLIENT-forwarded version (fires on raw user-section change). Verify against dsh's types: `packages/settings/settings/src/types.ts` in the dsh tree.

5. **Make failures LOUD during development**: a quiet-skip design (`fetchModels` → `null` on any failure) hid the 404 for hours. During dev/debugging, throw + log so the error is immediately visible in the console. Restore quiet-skip (catch + skip) only once the happy path is confirmed working.

## Notes

* У меня интернет может шалить, если не получается что то загрузить, останавливайся и пиши команду которую хотел выполнить, я подопну.
