# UI guideline — styling the client half of a dsh plugin

Reference for AI sessions: how dsh plugin UIs look and are built (browser half).
First consumer — the `ReasoningSection` (v2), which this document now describes as-built.
All dsh paths go through the `dsh/` symlink.

## 1. Where the design system lives

Tokens and global styles are owned by the `ui-theme` package; the sheets live in
`dsh/packages/client/ui-theme/src/styles/`:

| File | What it gives |
|---|---|
| `design-platform.css` | Static palette `--dsw-static-*` + semantic aliases `--dsw-alias-*`. Light theme on `body`, dark as overrides under `body[data-ds-dark-theme]`. The owner (`ui-layout`) switches themes, **not us**. |
| `gradient-shadow-text.css` | Typography `--dsw-font-*` (size/line-height shortcuts), shadows `--dsw-shadow-lv1..3`, gradients. |
| `base.css` | Font stacks (`--dsw-font-family`, `--ds-font-family-code`), motion curves (`--ds-ease-in-out`, `--ds-transition-duration[-fast/-slow]`). |
| `scrollbar.css` | Scrollbar contract: `--dsh-scrollbar-*` variables. |

The authoritative rules document is **`dsh/docs/web-styling.md`** (short; reread before
disputed decisions): CSS Modules + clsx, no component libraries or Tailwind; feature
components use only `--dsw-alias-*`; theme selectors in component CSS are forbidden.

## 2. How CSS reaches an external plugin's bundle

The mechanism (non-obvious; verify against the code):

1. `*.module.css` imports are intercepted by the tsdown plugin **`dsh-css-inline`**
   (lightningcss compilation, `cssModules: { pattern: '[hash]_[local]' }`). The virtual
   module (a) injects `<style data-plugin="<PLUGIN_ID>" data-plugin-css="<tagId>">` into
   `document.head` at factory execution (deduplicated by `tagId` — HMR-safe), and (b)
   exports the local→hashed class map as default. Plain `.css` is injected the same way
   and exports the string.
2. The reference config: **`examples/tmp/dsh-stickers/tsdown.config.ts`** — vendored from
   the official `dsh/packages/client/tsdown.client.ts`. Our
   `packages/dsh-model-settings/tsdown.config.ts` vendors the same plugin (verified:
   `<style data-plugin>` lands in the DOM, classes are hashed); add devDependency
   `lightningcss` alongside it.
3. A type declaration is needed: `src/client/css-modules.d.ts`
   (`declare module '*.module.css' { const classes: Record<string,string>; export default classes }`) —
   sample at `examples/tmp/ui-status-label/src/css-modules.d.ts`.
4. Bundle purity gate: value-imports of `@deepseek-ai/*` are allowed only from PLATFORM_MODULES
   (react, cordis, dsh-client-store, ui-slots, ui-primitives, …) — everything else is
   inlined into `lib/client.js`. Dependencies like clsx get bundled inside; per KISS prefer a
   local helper `cx(...parts) = parts.filter(Boolean).join(' ')` over a new dependency.

## 3. The settings design language (numbers)

Taken from the native Models section — the closest analog of what we build
(`dsh/packages/client/ui-settings-models/src/client/ModelsSection.module.css`; the file
header documents this): **14/22 body, 12/18 caption, capsules h36 r18 (h28 r14 in dense
rows), fields h32, hairlines `border-l2`**.

| Role | Value |
|---|---|
| Body / caption / section title | 14/22 · 12/18 · 16/24 (weight 500) |
| Row name (route/model) | 14/22, weight 500 |
| Capsule button md / sm | h36 r18, pad `0 14px` · h28 r14, pad `0 10px`, 12/18 |
| Input field | h32 r8, border `border-l2`, bg `bg-layer-1`; focus → ring (see §5) |
| Card (provider/model) | border `border-l2`, r12, pad 12–14px |
| Rhythm | gap 4/8/12; section `max-width: 720px`, flex-column |
| Menu/popup | bg `--dsw-specific-menu`, shadow `--dsw-shadow-lv3`, r12, item min-h 40 r10, hover `interactive-bg-hover` |

Hard rules:

- **`box-sizing: border-box` on every control** — the app has no global border-box reset
  (without it, outlined variants stand 2px taller than their filled neighbors).
- Focus is visible: one shared rule for all interactive elements → `outline: none` +
  `box-shadow: 0 0 0 2px var(--dsw-alias-border-l3)`; never remove without a replacement.
- Motion: only via `--ds-ease-in-out` + the duration tokens (.1/.2/.3s); disable transitions
  under `@media (prefers-reduced-motion: reduce)`.
- Disabled = `opacity: 0.4` + `cursor: default` (buttons and inputs alike).
- Scrollable containers: `overflow-y: auto` + `max-height`; the scrollbar is themed with
  `--dsh-scrollbar-thumb(-hover): var(--dsw-alias-scrollbar-bg-l2 / -hover-l2)`
  (example — `.elevated` in ModelsSection).

## 4. Token cheat-sheet (verified names)

Text: `label-primary`, `label-secondary`, `label-tertiary`, `label-dimmed`,
`label-primary-foreground` (text on a brand background).

States: `state-error-primary/secondary`, `state-success-primary/secondary/tertiary`,
`state-warn-label/primary/secondary/tertiary`.

Backgrounds: `bg-base`, `bg-layer-1/2/3`, `bg-module-platform`; specific — `--dsw-specific-menu`,
`--dsw-specific-tip`.

Borders: `border-l1/l2/l3` (l2 = row hairline), `brand-primary` (focus).

Buttons/interactivity: `button-primary-fill/hover`, `button-tool-bar-fill/hover`,
`interactive-bg-hover/active`.

Shadows: `--dsw-shadow-lv1/lv2/lv3`. Typography roles: `--dsw-font-s-14` (14/22),
`--dsw-font-xs-13`, `--dsw-font-xxs-12`, `--dsw-font-base-16`, `--dsw-font-base-strong-16`,
`--dsw-font-l-20`; code — `font-family: var(--ds-font-family-code)`.

## 5. Patterns (copy from here)

| Pattern | Source |
|---|---|
| Section wrapper (`.section`/`.title`/`.intro`/`.notice`/`.savedNotice`) | `dsh/packages/client/ui-settings-models/src/client/ModelsSection.module.css` |
| Row card + actions: `.rowCard`/`.rowHead`/`.rowName`/`.rowTag`/`.credentialDot`/`.rowActions`/`.primaryButton`… | same file (lower half) |
| Settings row "title + desc + control" | `examples/tmp/ui-status-label/src/client/StatusLabelRow.module.css` |
| Buttons (primary/ghost/outline/toolbar variants, md/sm) | `dsh/packages/client/ui-primitives/src/Button.tsx` + `Button.module.css` |
| Input field | `dsh/packages/client/ui-primitives/src/Input.module.css` |
| Disclosure row | `dsh/packages/client/ui-primitives/src/DisclosureRow.tsx` + `.module.css` |
| Menu/popup | `dsh/packages/client/ui-primitives/src/Menu.module.css` |
| State coverage in a real plugin (slider, switch, rows, errors) | `examples/tmp/dsh-reasoning-effort/src/client/styles.ts` — the reference for state coverage; but it is an **inline CSS string**, not module.css — take only the state patterns |
| Native `<details>` accordion, zero deps | `packages/dsh-model-settings/src/client/reasoning-section.module.css` — `.accordionSummary`: `list-style: none`, hidden webkit marker, CSS-drawn chevron in `::before` (rotates on `details[open]`), reduced-motion off |
| Theme-aware checkbox | same file — native input + `accent-color: var(--dsw-alias-brand-primary)`; no custom control |
| Aligned columns in dense rows | same file — `.levelName` fixed `width: 72px` keeps the wire inputs aligned across levels |

## 6. Rules (do / don't)

**Do**

1. CSS Modules next to the component + a local `cx()`; all presentation in CSS, inline styles
   only for local custom-property values.
2. Colors/shadows/fonts — only through `--dsw-alias-*` and theme tokens (they switch
   light/dark on their own).
3. `box-sizing: border-box` on every control; focus visible; reduced-motion honored.

**Don't**

1. Literal colors or hex in feature CSS — including the "convenient" `var(--x, #hex)` fallbacks
   from reference examples: `web-styling.md` forbids literal colors; the static palette
   (`--dsw-static-*`) is not for components either.
2. Theme selectors (`body[data-ds-dark-theme]`, `:root` overrides) in plugin CSS — the theme
   owner delivers dark mode through the aliases.
3. Global element/id selectors and `:global` without an explicit reason (CSS Modules already
   isolate).
4. Component libraries, Tailwind, new runtime dependencies (clsx → local helper).
5. Own page-padding on a section: the settings panel provides padding and scroll itself —
   ModelsSection neither pads nor scrolls itself, only `max-width` + flex-column.

## 7. As-built: the ReasoningSection (v2)

Layout (`src/client/ReasoningSection.tsx` + `reasoning-section.module.css`): section → one
`.rowCard` per OpenAI-compatible route (name + "N models" tag) → one `.modelRow` per model:
name + **Refresh** capsule (h28, re-reads the size from the live `/v1/models` listing) +
**Save** capsule (h36, primary fill); a context-window field row (label + h32 input,
placeholder "unset"); the seven-level editor folded behind a native `<details>` accordion
(checkbox + fixed-width level name + wire input; `off` has no wire field — it may only send
nothing). Loading/error/empty are text states (`stateText`, `errorNotice`) with a Retry
capsule on error.

State contracts that keep the UI honest (all in `ModelRow`):

- **Save availability**: `canSave = draftsDirty || ctxWriting || ctxClearing` — one visual
  state maps to exactly one wire part, so a zero-part save is unreachable: an untouched row
  stays gray; unchecked-all posts the clear (`{}`); a changed field posts a value; an emptied
  field over a stored value posts `null` (clear); garbage text over a stored value parses to
  undefined and is NOT empty → nothing to commit → gray.
- **Errors**: one row-level `.errorNotice` (12/18, `state-error-primary`, `role="alert"`).
  The controller throws `Error(message)`; the component renders
  `e instanceof Error ? e.message : String(e)` — never a raw rejection value. Host errors must
  be carrier-conformant (key-moments §8) or this slot shows a wall of zod issues instead.
- **Focus-aware sync**: after a save/refresh re-lists the rows, the stored ctx is adopted into
  the draft only while the field is unfocused (`ctxFocused` ref) — a re-list never yanks the
  user's in-progress edit.

Verification checklist (the user runs this live in `dsh web`): both themes (light/dark hold
through the aliases alone), keyboard focus visible on every interactive element,
`prefers-reduced-motion` breaks nothing.

Related notes: [key-moments.md](./key-moments.md) (§4 slots, §5 events, §8 carrier contract),
[../specs/v2/spec.md](../specs/v2/spec.md) (decision №6 — the section lives in `settings.section`).
