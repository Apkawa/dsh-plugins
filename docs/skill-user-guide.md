# dsh Skills — User Guide

A **skill** is a reusable set of task-specific instructions defined as a Markdown file
with YAML frontmatter. Two surfaces can invoke it:

- **The model** — sees a catalog (name + description) in its request and loads the body
  on demand through the `skill(name)` tool.
- **The user** — types `/` in the Web GUI composer; user-invocable skills appear in the
  slash menu. Selecting one references the skill, and on submit the host injects the
  rendered body into the conversation as an instructions-form context message.

Source of truth (all under the `dsh/` symlink):

- `packages/skill/skill/src/index.ts` — registry, types, model-facing renderer
- `packages/skill/skill-filesystem/src/index.ts` — discovery + frontmatter parsing
- `packages/skill/tool-skill/src/index.ts` — model-facing loader tool and catalog rendering
- `packages/client/ui-skill/src/` — Web GUI slash source

## Where files live

Discovery scans these roots in rank order; **lower rank wins** on duplicate names:

| Rank | Root | Notes |
|---|---|---|
| 100 | `<project>/.dsh/skills` | project = nearest ancestor containing `.git`, else cwd |
| 200 | `<project>/.agents/skills` | shared agent config root |
| 300 | `customSkillDirs` | extra roots from the skill-filesystem plugin config |
| 400 | `~/.dsh/skills` | `$DSH_HOME` (skips its `.system` child) |
| 500 | `~/.agents/skills` | `$DSH_AGENTS_HOME` |
| 600 | bundled root | `$DSH_BUNDLED_SKILL_DIR`, trusted host content |

Two file shapes are recognized, one level deep only:

```
<root>/<name>.md            # flat single-file skill
<root>/<name>/SKILL.md      # bundle directory (may carry references/, scripts/, assets/)
```

Nested `**/SKILL.md` below the bundle root is deliberately not discovered.

## File format

```markdown
---
name: my-skill
description: One-line summary shown in the slash menu and model catalog.
whenToUse: Optional extra routing guidance for the model.
metadata:
  any: provider-specific opaque object
disable-model-invocation: false
user-invocable: true
---

# My Skill

Markdown instructions the model follows when this skill is loaded.
Relative paths here resolve against the skill's base directory.
```

- The first line must be exactly `---` (CRLF tolerated); the block closes at the next
  `---` line. Everything between is YAML, parsed as an **open object** — unknown keys
  are ignored, only the fields below are interpreted.
- The body is everything after the closing delimiter, trimmed and embedded verbatim
  in the model-facing render (skills are trusted local content).

## Frontmatter fields

| Field | Required | Type / values | Meaning |
|---|---|---|---|
| `name` | yes | string, kebab-case `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` | identifier used to address the skill (the `/name` in the menu) |
| `description` | yes | non-empty string | shown in the slash menu and rendered into the model catalog |
| `whenToUse` | no | string | extra routing guidance for the model alongside the description |
| `metadata` | no | YAML object (not an array) | opaque passthrough (`SkillCandidate.metadata`), not interpreted by dsh |
| `disable-model-invocation` | no | boolean | `true` → hidden from model-facing catalogs and the loader tool |
| `user-invocable` | no | boolean | `false` → hidden from the human slash menu |

Boolean spellings: `true/false/yes/no/on/off/1/0`, case-insensitive. Legacy camelCase
keys (`disableModelInvocation`, `modelInvocable`, `userInvocable`) are **rejected with
an error** — the whole skill is dropped, not just the field.

### Invocation policy quadrants

| `disable-model-invocation` | `user-invocable` | Result |
|---|---|---|
| unset / false | unset / true | model + user (default) |
| true | unset / true | user-only; wears a "user-only" marker in the menu |
| unset / false | false | model-only |
| true | false | hidden from both surfaces (trusted/internal callers only) |

Omitted fields default to permitting that surface.

## Validation and failure behavior

Discovery is per-file fault-tolerant: invalid or missing frontmatter, a missing
`name`/`description`, an invalid name, or a bad invocation value causes **that file to
be skipped with a `ctx.logger.warn`** — siblings are unaffected. Invocation policy
fails closed (an invalid value drops the skill rather than falling back to permissive).

Roots are watched (Chokidar) by default: adding/removing/renaming skill entries
invalidates the catalog; changes below `references/`, `scripts/`, `assets/` do not.
Config knobs on the skill-filesystem plugin: `watch`, `watchUsePolling`,
`watchStabilityThresholdMs`, `watchFollowSymlinks`, `customSkillDirs`,
`includeDefaultRoots`, `dshHome`, `agentsHome`.

## Catalog vs body lifecycle

- **Discovery** parses frontmatter only and publishes summaries (name, description,
  whenToUse, invocation policy, source, provider).
- **Loading** (`skill(name)`) re-reads and re-parses the current file on every call —
  there is no body cache, so edits take effect immediately; a frontmatter rename
  between discovery and load rejects the stale name.

## What the model sees

Both invocation paths render one canonical block (`renderSkillContent`):

```xml
<skill_content name="my-skill">
<skill_resources>
Base directory for this skill: /path/to/<root>/my-skill
Resolve relative paths mentioned by this skill against the base directory before using them. Load referenced resources only as needed.
</skill_resources>

<skill_instructions>
…body verbatim…
</skill_instructions>
</skill_content>
```

The resource hint varies by provider: a base **directory** (filesystem skills), a base
**URL**, or an opaque "managed by provider" note. The name attribute is escaped; the
body is embedded verbatim. A user-explicit invocation is durable in the session log as
an `instructions`-form context message with source `{kind: 'skill-invocation', name}`,
so transcript consumers present it from metadata instead of re-parsing model text.

## Minimal example

`.agents/skills/hello/SKILL.md`:

```markdown
---
name: hello
description: Greet the user in a friendly way.
---

Greet the user by name if you know it, then ask how you can help.
```

After that, `/hello` appears in the Web GUI slash menu and the model can also load it
through the `skill` tool.
