# dsh-model-settings - plugin for @deepseek-harness/dsh


## Paths

* `dsh/` - symlink to deepseek-harness. use readonly for research

## Principles

* **TDD** — failing test first, then implementation (red → green → refactor). Every exported function has a unit test; probe logic is tested against recorded fixtures, never live network in unit tests. A behavior without a test does not count as done.
* **KISS** — minimal modules, no premature abstractions, no new dependencies beyond declared peers. If a simpler design serves the current iteration, ship it and note the trade-off instead of building for imagined futures.
* **SOLID** — one responsibility per module; orchestration depends on small injected interfaces (`Fetcher`, `SettingsStore`), not concrete dsh seams or `fetch`; new capabilities (T2–T5) are added as new consumers/modules, not by rewriting the core.
