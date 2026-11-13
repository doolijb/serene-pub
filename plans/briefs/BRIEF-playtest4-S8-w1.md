# BRIEF playtest4-S8-w1 — the SDK half: the `compile-history-entry` request kind and the Chronicle's per-day Compile

Lane `playtest4-S8`, worker w1. Supervisor: the lane-supervisor. Report: your final message (the supervisor reads it). Edit with the Edit tool (never Write over an existing file); re-read each file immediately before editing it — other programmes (M2e) edit other parts of the same SDK tree right now.

## Goal
The owner (2026-11-04) ruled: the Chronicle widget's *Not yet compiled* list gets a **Compile** per day that triggers the lorebook's compile (by date). A widget can act only through a host request kind, so:

1. **`/home/jody/github/serene-pub-sdk/sdk/src/widgets.ts`**
   - In `interface WidgetRequests`, directly after `'summarize-scenes'` (~line 1926), add:
     ```ts
     /**
      * 🚧 Core's Chronicle: compile the session's line's scenes not yet
      * compiled of one day (`date`; null is *Undated*, the scenes opened
      * with no story clock) into the history entry of that date, which the
      * host makes when the line has none — the lorebook's *Not yet
      * compiled* **Compile**, with no window: the run and its review arrive
      * in the activity list as any compile's do. Takes every scene of that
      * day on the line that no entry holds, other sessions' too. The
      * lorebook's owner only. Resolves once the compile has started;
      * refused in words.
      * @ruling ★S6-1 (owner, 2026-11-04)
      */
     'compile-history-entry': { params: { date: StoryTime | null }; result: void }
     ```
     (`StoryTime` is already imported/used in this file — `'set-story-clock'` uses it; check.)
   - `WIDGET_REQUEST_ASKERS` (~2663, the `// 🚧 Chronicle (W3)` group): add `'compile-history-entry': 'core',` right after `'summarize-scenes': 'core',`. It is `'core'` because the table says WHICH WIDGET may ask, and every lorebook-writing sibling (`start-history-entry`, `summarize-scenes`, the scene boundaries) is `'core'`.
   - `WIDGET_REQUEST_APIS` (~2781): add `'compile-history-entry': 'session',` right after `'summarize-scenes': 'session',`.
   - Nothing else in widgets.ts.

2. **`/home/jody/github/serene-pub-sdk/core-catalog/src/shared/ui/chronicle/index.ts`** (the plain half)
   - `ChronicleView.unfiled` item type (~279) gains one field, documented:
     `/** 🚧 ★S6-1: the day's **Compile** (`compile-history-entry` with this `date`); null unless the viewer may write. */ compile: { date: StoryTime | null; label: string; title: string } | null`
     (import `StoryTime` type from `@serene-pub/sdk` if not already imported).
   - In `chronicleView`'s `unfiled:` mapping (~475) set `compile: canWrite ? { date: d.date, label: t('Compile'), title: <title> } : null`, where the title is
     - dated day: `t("Compile this day's scenes into the history entry of {date}, making it if there is none").replace('{date}', <the day's label as the item's `date` string>)`
     - Undated (`d.date === null`): `t('Compile the undated scenes into the newest dated history entry, making one if there is none')`
   - Pass `d.date` through as given (the server takes the day; hour and minute never count).

3. **`/home/jody/github/serene-pub-sdk/core-catalog/components/shared/chronicle/ChronicleWidget.svelte`**
   - In `chronicle.unfiled-day-head` (~556), after the `chronicle.unfiled-count` span, add:
     ```svelte
     {#if day.compile}
       <button
         type="button"
         data-widget-part="chronicle.unfiled-compile"
         title={day.compile.title}
         disabled={!!busy}
         onclick={() => compileDay(day.compile!.date)}
       >
         <sp-icon name="wand" size="14"></sp-icon>
         {day.compile.label}
       </button>
     {/if}
     ```
     Match the markup/attribute style of the existing `chronicle.extend` button (~535–545) — same element shape; the icon `wand` is the lorebook History lens's Compile glyph (`Icons.Wand` in `HistoryUnfiledGroup.svelte`).
   - Add, next to `summarizeScenes` (~174):
     ```ts
     /** 🚧 ★S6-1: compile one day's scenes not yet compiled (null = Undated); the run shows in the activity list. */
     async function compileDay(date: StoryTime | null) {
       await press('compile', 'compile-history-entry', { date })
     }
     ```
     `press` already says a refusal in place as the widget's `alert` (*Not done: …*). No `ask()` afterwards (nothing is filed until the review is applied). Import the `StoryTime` type if the component does not have it.
   - Update the component's top doc comment only if it enumerates the requests the widget asks (it does around line 27 — add `compile-history-entry` (★S6-1) where the list is).

4. **`/home/jody/github/serene-pub-sdk/sdk-tests/coreChronicle.test.ts`** — in the `describe('🚧 ★S2-1b: Not yet compiled', …)` block (~490), or a new describe `'🚧 ★S6-1: Compile per day'` right after it, add tests:
   - an owner's view: every day's `compile` carries THAT day's `date` (the dated day's StoryTime object, deep-equal; `null` for Undated), label `'Compile'`, and the two titles above (dated title names the day's label);
   - a guest (`GUEST`) or `ownerOnly` view: `compile` is null on every day (or `unfiled` empty where it already is);
   - `WIDGET_REQUEST_ASKERS['compile-history-entry']` is `'core'` and `WIDGET_REQUEST_APIS['compile-history-entry']` is `'session'` (import `WIDGET_REQUEST_APIS` from `@serene-pub/sdk`).
   - Also update any existing `deepEqual` over whole unfiled items that now lack `compile` (e.g. ~511 maps fields, fine; check the rest).

5. **Regenerate the widgets guide**: `cd /home/jody/github/serene-pub-sdk && npm run gen:widget-parts` (writes `guides/widgets.md`; the new part `unfiled-compile` must appear in the `chronicle` list). Do not hand-edit `guides/widgets.md`.

## Files owned (only these)
`/home/jody/github/serene-pub-sdk/sdk/src/widgets.ts` (the three spots above only), `/home/jody/github/serene-pub-sdk/core-catalog/src/shared/ui/chronicle/index.ts`, `/home/jody/github/serene-pub-sdk/core-catalog/components/shared/chronicle/ChronicleWidget.svelte`, `/home/jody/github/serene-pub-sdk/sdk-tests/coreChronicle.test.ts`, `/home/jody/github/serene-pub-sdk/guides/widgets.md` (generated only).

## Files readable
Everything. Useful: `/home/jody/github/serene-pub/src/lib/client/lorebooks/sections/HistoryUnfiledGroup.svelte` (the lorebook's per-day Compile and its titles).

## Out of scope — never built
A modal from the Chronicle; a setting; any other request kind; changing `press`; any other file. No new names beyond: `compile-history-entry`, the part `chronicle.unfiled-compile`, the view field `compile` on `ChronicleView.unfiled` items, the UI strings *Compile* and the two titles above. If you think you need another name, stop and say so in your report.

## Rules your work depends on (quoted)
- NOMENCLATURE R3: "Qualify, never abbreviate to the bare noun." R6: mark provisional vocabulary 🚧 (done in the doc comments above).
- SDK: "`@serene-pub/{sdk,…}` resolve by `file:` link to `../serene-pub-sdk/<name>/`. Edit the SDK there. Its `main` is `./dist/index.js`, so after any SDK change run `npm run sdk:build` before app tests or builds — never while a serene-pub `vite dev` runs."
- Never `git checkout` / `restore` / `stash` / `clean` in `../serene-pub-sdk` — most of it is uncommitted.

## Tests (Done means)
1. Build the SDK dist so `sdk-tests` sees the new kind: first `pgrep -af "[v]ite dev"`; if it prints a serene-pub server, do NOT build — report "blocked on your dev server". If none: `cd /home/jody/github/serene-pub && flock /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/sdk-build.lock npm run sdk:build > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest4-S8-w1-build.log 2>&1; echo exit=$?` and read the log tail.
2. Run, capped: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub-sdk/sdk-tests && NODE_OPTIONS=--max-old-space-size=4096 npx tsx --test coreChronicle.test.ts widgetParts.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest4-S8-w1.log 2>&1; echo exit=$?'` then read the log. Both files green.
3. `npx prettier --check` is NOT required for widgets.ts / chronicle index.ts / coreChronicle.test.ts (they fail at HEAD already); don't reformat whole files.

## Verbatim
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*

## Report (your final message)
Changed files with a one-line summary each; the exact test commands and pass/fail counts; anything you could not do; Noticed, not done.
