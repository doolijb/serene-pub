# BRIEF — adv-E-w2: NOMENCLATURE and STYLE-GUIDE rows for advanced controls

Supervisor: lane adv-E. Repo `/home/jody/github/serene-pub`. Report back in your final message (no report file).

## Goal

Record the **advanced controls** build (2026-11-10) in the vocabulary canon (`NOMENCLATURE.md`) and the design canon (`STYLE-GUIDE.md`). **No code changes.**

## Reading discipline (quoted, binding)

*"Read `NOMENCLATURE.md` and `STYLE-GUIDE.md` by section (`grep -n "^## \|^### "`, then `sed -n`), never whole."* Lines are very long and padded; use `sed -n 'N,Mp' FILE | sed -E 's/ {3,}/ /g' | cut -c1-1500` to read them. Insert rows with the Edit tool on a unique anchor, or a careful script; never reflow or re-pad existing rows. Never `prettier --write` (both files already fail `prettier --check`; that's fine).

## Facts (verified by the supervisor in the code)

- Column `user_settings.show_advanced_controls` boolean NOT NULL default false (migration `0149_familiar_silk_fever`); data upgrade `dataUpgrades/0149_familiar_silk_fever.ts` copies `show_all_character_fields = true` into it once (second boot changes nothing); the 0.5.3 attic restore (`attic/etl/accounts.ts`) does the same.
- Wire `showAdvancedControls` on `userSettings:get`. Event `userSettings:updateShowAdvancedControls` `{ enabled }` → `{ success, enabled }`, error `userSettings:updateShowAdvancedControls:error`, handler `userSettingsUpdateShowAdvancedControls` (`server/sockets/userSettings.ts`), types `Sockets.UserSettings.UpdateShowAdvancedControls` (`shared/sockets/types.ts`). Account-wide, so **not** in `SCOPED_EVENTS`.
- Client helper `showsAdvancedControls(settings)` in `src/lib/client/advancedControls.ts` (`settings?.showAdvancedControls ?? false`).
- UI: **Show advanced controls**, the first card on Settings › User; help *"More choices on sessions, lorebooks and characters. Off keeps the everyday ones."*
- Component `AdvancedHiddenLine` (`src/lib/client/components/AdvancedHiddenLine.svelte`): one muted line (`text-surface-600-400 text-xs`), *Some controls are hidden.* then a quiet `button.anchor` **Show advanced controls** that emits `userSettings:updateShowAdvancedControls { enabled: true }`. No listener, no toast; the form redraws when the shell's `userSettings:get` updates. Drawn by: the session edit form's Settings tab foot, the start form (book pick and rules card), Book settings, the character form (not on Stats, Likeness, Speech), the entry editors (`EntryAdvancedFields`). **Not** in the lens track, message menu, session header or Author's note widget.
- SDK `ViewerV1.advancedControls?: boolean` (`serene-pub-sdk/sdk/src/widgets.ts:548`), an additive v1 key on the base **viewer** section, filled live by core's `envelopeSections.svelte.ts`; absent means shown. The `authors-note` widget now declares `reads: ['viewer']` and hides its depth, interval and *Sent as* when it's `false`. **This replaced the plan's `SessionDossier.advancedControls`** (build ruling ★adv-C-1): there is no dossier field and no new scope.
- `SessionLorebookReading`'s optional prop `lockedByAdvanced`: with `readOnly`, an owner who sees the reading read-only only because the switch is off reads *"Turn on advanced controls to change them."* (★adv-B-2).
- `ActionListDeps.advancedControls(): boolean` (`sessionPage/actionList.svelte.ts`): off leaves core's *Branch from here* out of every venue (a genre action keyed `branch` is never filtered).
- Lens helpers (`client/lorebooks/lenses/registry.ts`): `lensesShown(advanced)` (all lenses, less Graph and Lives unless advanced), `lensShown(lens, advanced)` (falls back to List), `lensForKey(event, advanced)` gained the parameter. `LensTrack` has a required boolean prop `advanced`.
- Hidden never means changed; a preference, never a permission. Admin and the Sampling, Models, Loadouts, Connections views are untouched. The **Advanced fold** (★E-2) and `advanced: true` on a FieldDecl (§5-2) are unchanged and show in both modes.
- Retired: the User-tab card **Show all character fields** and the character form's inline **Show all fields** switch. The column `show_all_character_fields`, the event `userSettings:updateShowAllCharacterFields` and its handler stay, unread (no client reader now), until the RC1 squash.

## Two R1 hazards (the supervisor is asking the owner; write around them, don't resolve them)

1. **"hidden line"** already means a message line hidden from the story (STYLE-GUIDE §6.16 `messages.message-badge-hidden`, "the hidden line's badge"). So never use the bare phrase *hidden line* as a term for `AdvancedHiddenLine`. Name it by its code name `AdvancedHiddenLine` and describe it as "the line that says controls are hidden" / by its words *Some controls are hidden.* Add a ⚠ note: not a hidden line (a message hidden from the story).
2. **Bare `advanced`** as `LensTrack`'s prop and `lensesShown`/`lensShown`'s parameter means "this viewer's advanced controls are on", while `advanced: true` on a FieldDecl means "fold this field". Record them as built, with a ⚠ saying so. Don't rename anything.

## Work

### NOMENCLATURE.md

Rules to apply (quoted from §1/§24): *"R1 — One word, one meaning."* · *"R3 — Qualify, never abbreviate to the bare noun."* · *"R6 … 🚧 Provisional — designed but not built, so the words may still move on contact with implementation."* · §24.5 *"Say what it is **not**, in the declaration, if a near-neighbour exists."* · CLAUDE.md P6: *"Everything that exists states its purpose, why it exists, what it owns and what it does not (and who does) — in its NOMENCLATURE row."*

Match the row shape of neighbouring rows: `| **term** 🚧 | **Built 2026-11-10 (owner GO; PLAN-advanced-controls-2026-11-10, lane adv-X).** … |`. Charters use **Purpose:** · **Why:** · **Owns:** · **Not:** as the §24 **fold** row does (grep `foldInParent` for an example).

1. **§26 Shell** — append after the **view toolbar** row (the last row before `---` / `## 27. Documentation`):
   - **advanced controls** 🚧 (UI **Show advanced controls**) — charter: **Purpose:** keep everyday surfaces short. **Why:** P3/P4 (few settings; power controls are purposeful). **Owns:** the per-user switch and its `AdvancedHiddenLine`. **Not:** a permission (it never shows what a role hides); the admin views (Admin, Sampling, Models, Loadouts, Connections, Pipelines, Rulesets); the **Advanced fold** or `advanced: true` on a FieldDecl — both unchanged and shown in both modes (R1: the switch never acts on them). Then the code names (column, wire, event, `:error`, handler, type namespace, helper), the data upgrade, what it hides in one compact list by area (session start, session edit, session view, characters, lorebooks; link `docs/themes-and-settings.md#show-advanced-controls`), "hidden never means changed", and *Replaces **Show all character fields** (§23).*
   - **`AdvancedHiddenLine`** 🚧 — what it is, where it is drawn and not drawn, static/counts nothing/never toasts, STYLE-GUIDE §6.21; the ⚠ from hazard 1.
2. **§9 Session** — append three rows at the end of §9's term table (the last `| … |` row before the bulleted interest prose / `## 10.`):
   - **`ViewerV1.advancedControls`** 🚧 — as above; note it replaced the plan's `SessionDossier.advancedControls`.
   - **`lockedByAdvanced`** (`SessionLorebookReading`) 🚧.
   - **`ActionListDeps.advancedControls`** 🚧.
3. **§8 Content** — add one row right after the **lens track** (`LensTrack`) row (≈ line 360): **`lensesShown`** · **`lensShown`** · `LensTrack`'s **`advanced`** prop 🚧 (with `lensForKey(event, advanced)`), and the ⚠ from hazard 2. Graph and Lives hidden with advanced controls off, their Alt+Shift 4 and 6 shortcuts too; an address naming either draws List with no redirect.
4. **§23 Retired words** — append a row at the end of the table (after the **Clone with changes and attach** row): **Show all character fields** (the Settings › User card) · **Show all fields** (the character form's inline switch) · the client's `showAllCharacterFields` reads — **Retired 2026-11-10** (★B, owner; PLAN-advanced-controls-2026-11-10, lanes adv-A, adv-D). Replaced by **Show advanced controls** (§26 **advanced controls**); people who had it on start with advanced controls on (data upgrade 0149, attic restore). ⏳ The column `show_all_character_fields`, the event `userSettings:updateShowAllCharacterFields` and its handler stay, unread, until the RC1 squash. ⚠ Not **Show all characters** (the persona picker) nor a list's **Show all** (pages of 50), both unchanged. Never reintroduce.
5. **§25 Change ledger** — one new block, placed after the **Models view tidy shelf** block and before `## 26. Shell`, headed exactly:
   `### advanced controls — 2026-11-10 (owner GO; PLAN-advanced-controls-2026-11-10, lanes adv-A…F)`
   with a `| Was | Is | Cost |` table (copy the Runs block's shape): one row per new name above (`_(new)_ | 🚧 … (§26/§9/§8) | file`), a row for the retired card (`**Show all character fields** · **Show all fields** | **Show advanced controls** (§23) | …`), a row `SessionDossier.advancedControls` (planned) → `ViewerV1.advancedControls?` (★adv-C-1), and a row for `authors-note` `reads: []` → `reads: ['viewer']`.

### STYLE-GUIDE.md

6. **§6.21 Notices and toasts** — add one paragraph at the end of the section (after the paragraph ending "…that ends by itself (§0-C, 2026-11-04)."), describing the pattern by its words (hazard 1), e.g. starting *The **Some controls are hidden.** line* (`AdvancedHiddenLine`, advanced controls, 2026-11-10): one muted line (`text-surface-600-400 text-xs`) at the foot of a form that hid something for this viewer: *Some controls are hidden.* then the quiet `anchor` link **Show advanced controls** (§6.1), which turns the switch on in place. It is static and counts nothing; it shows only when something was actually hidden for this viewer; it is never a toast and never dismissible or collapsed (it is the way back); a surface with nowhere honest to put it (the **Show as** track, the message menu, the session header, a widget) draws none. A form keeps a hidden editor mounted when its draft lives inside it (Book settings' calendar sits in a `hidden` wrapper, so flipping the switch mid-edit keeps the draft and the unsaved prompt honest).
7. **§10 Writing** — its first bullet uses the retired label as its example: *"Sentence case everywhere: "Show all fields", …"*. Replace only `"Show all fields"` with `"Show advanced controls"`.

## Files owned

`NOMENCLATURE.md`, `STYLE-GUIDE.md`. Nothing else.

## Files readable

Anything; the code paths above if you need to check a detail.

## Out of scope

Docs pages, code, plan files, reports. Anything else you notice goes in your report under **Noticed, not done**.

## Stop and ask when

A name you'd need isn't in this brief; a fact here disagrees with the code (say where).

## Done means

- Every row above exists (grep each code name and paste the line numbers).
- `diff /tmp/claude-1000/-home-jody-github-serene-pub/c1ff1652-0bf9-4b2c-bd9d-ed98fac4505f/scratchpad/adv-E-before/NOMENCLATURE.md NOMENCLATURE.md` and the same for `STYLE-GUIDE.md` (snapshots taken before you started; the files hold other uncommitted work, so never judge by `git diff`) show only insertions plus the one-word §10 change.
- Report: rows added with line numbers, and Noticed-not-done.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`.)
- Never `git checkout`, `restore` or `clean` in either repo.
- Scratch files start with `adv-E-`.
