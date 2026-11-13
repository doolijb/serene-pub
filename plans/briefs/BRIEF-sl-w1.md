# BRIEF sl-w1 — the SDK's sheet-latitude module, its judge, `handLocked`, and the judge's test

Lane **sl** (SDK), worker 1. Supervisor: the sl lane-supervisor. Report: in your final message (your hand-back), not a file.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

Add the SDK vocabulary for **sheet latitude** (how far each role may change sheets by hand) and **item-move latitude** (how far each role may give, drop or pick up items by hand), one pure judge both the server and the sheet will share, and a per-slot hand-lock fact on the sheet's owner view. Owner rulings 2026-11-05 (plan §25, "★1 two shared fields + a per-stat lock on the sheet (`handLocked`) — as proposed"; "★7 moves are their own permission"). The app is NOT yours: lane `ed` wires the server gate later from what you export.

## Files owned (edit only these)

- `/home/jody/github/serene-pub-sdk/sdk/src/sheetLatitude.ts` — **new**
- `/home/jody/github/serene-pub-sdk/sdk/src/index.ts` — one `export * from './sheetLatitude.js'` line (put it right after the `rulesetSections.js` line, ~86)
- `/home/jody/github/serene-pub-sdk/sdk/src/widgets.ts` — additive: one optional field on `SessionStateOwnerV1` (~883–1000)
- `/home/jody/github/serene-pub-sdk/sdk-tests/sheetLatitude.test.ts` — **new**

## Files readable

`sdk/src/rulesetSections.ts` (~205–215: `ATTRIBUTE_CHANGERS`, `AttributeChanger`), `sdk/src/widgets.ts`, `sdk-tests/scopes.test.ts` (test style), the app's current gates for reference only (never edit): `/home/jody/github/serene-pub/src/lib/server/rulesets/scopes.ts` ~96–112 (`changedByAllows`), `/home/jody/github/serene-pub/src/lib/server/state/write.ts` ~1355–1395 (`SLOT_LOCKS`, `lockAllows`).

## Out of scope

No app code. No `core-catalog` (worker 2 owns the genre fields). No sentences a person reads (the app owns the refusal sentences). No `defineVerdict` registration. Nothing beyond the names below.

## What to build — exactly these names (all 🚧, all `@experimental`, exactly ONE stability tag per export)

### `sdk/src/sheetLatitude.ts`

A module doc comment carrying the **charter** (NOMENCLATURE P6: purpose, why it exists, what it owns, what it does not and who does):
- purpose: say how far each role (the session owner, a player) may change sheets and move items **by hand**, and judge one hand edit against it — one pure function the host's write gate and the sheet's edit controls both call, so the two never disagree;
- owns: the levels, the judge, its types;
- does NOT own: who a person is in the session, whose a sheet is, the stored setting (the app resolves those and passes them in); the refusal sentences (the app's); runs and pipelines (never judged here — the latitude limits a person's hand only).
- Say what it is **not** (NOMENCLATURE §24 step 5, near-neighbours): not `changedBy` (an attribute's own word for who may change it — the judge *reads* it), not a slot lock (`configs[slot].lock`, `none · people · all` — the judge *reads* it), not `reach` (a setting's word for who sees it), not earshot (which prompts read a value).

Exports:

```ts
/** The sheet-latitude levels, one per role. */
export const SHEET_LATITUDES = Object.freeze(['as-ruled', 'no-edits', 'all-own', 'all-any'] as const)
export type SheetLatitude = (typeof SHEET_LATITUDES)[number]

/** The item-move levels, one per role. */
export const ITEM_MOVE_LATITUDES = Object.freeze(['follow-sheet', 'no-moves', 'own-items', 'any-items'] as const)
export type ItemMoveLatitude = (typeof ITEM_MOVE_LATITUDES)[number]

/** Who puts a hand on the sheet. A watcher is a guest who is not a player. */
export type HandEditorRole = 'owner' | 'player' | 'watcher'

/** What the hand does: change a value, set or clear a stat's lock, or one side of an item move. */
export type HandEditAct = 'set' | 'configure' | 'take-from' | 'put-on'

/** Why a hand edit is refused — the app maps each to its sentence. */
export const HAND_EDIT_CAUSES = Object.freeze(['watching', 'owner-locks', 'unheard', 'locked', 'no-edits', 'not-theirs', 'changed-by', 'no-moves'] as const)
export type HandEditCause = (typeof HAND_EDIT_CAUSES)[number]

export interface SheetLatitudeQuestion {
  role: HandEditorRole
  act: HandEditAct
  /** Whose the value's owner is, seen from `role` (the caller resolves it): `own` or `other`. */
  whose: 'own' | 'other'
  /** The role's sheet latitude in force. Ignored for a watcher and for `configure`. */
  latitude: SheetLatitude
  /** The role's item-move latitude in force, for `take-from` / `put-on`. Absent: `follow-sheet`. */
  itemMoves?: ItemMoveLatitude
  /** The attribute's `changedBy`, when the slot files under one of the session's rules' attributes. Absent or empty: anyone. */
  changedBy?: readonly AttributeChanger[]
  /** The slot's lock (`configs[slot].lock`). Absent: `none`. */
  lock?: 'none' | 'people' | 'all'
  /** False when the value's earshot keeps it from this person. Absent: heard. */
  heard?: boolean
}

export type SheetLatitudeVerdict = { ok: true } | { ok: false; cause: HandEditCause }

export function sheetLatitudeAllows(q: SheetLatitudeQuestion): SheetLatitudeVerdict

/** A stored value read defensively: one of the levels, else `as-ruled` (the default when a genre says nothing). */
export function sheetLatitudeOf(value: unknown): SheetLatitude
/** A stored value read defensively: one of the levels, else `follow-sheet`. */
export function itemMoveLatitudeOf(value: unknown): ItemMoveLatitude
```

Import `AttributeChanger` with `import type { AttributeChanger } from './rulesetSections.js'` (type-only, so the module stays a leaf).

Doc each level (on the constants, as a bullet list), with what "own" means per role:
- `as-ruled` — _As the rules say_: the session owner changes anyone's values as the game master; a player changes their own as the holder; each attribute's `changedBy` decides (writer `gm` for the owner, `holder` for a player; the game master may change what the holder may).
- `no-edits` — _No editing by hand_.
- `all-own` — _Everything on their own characters_: every value on the role's own, `changedBy` set aside.
- `all-any` — _Everything on anyone's_: every value on anyone's (the world and places too), `changedBy` set aside.
- **Own**: for a player, the cards they own (`characters.userId`) and their card-less seat; for the session owner, their own cards plus the world, the people nobody plays (NPCs) and the places. Watchers never change anything (no setting).
- Item-move levels: `follow-sheet` — _Follow sheet editing_: each side of a move is judged as a `set` under the sheet latitude; `no-moves` — _No moving by hand_; `own-items` — _Their own items_: a side on the role's own passes, `changedBy` set aside (so a player gives their own items away: the receiving side becomes an offer the receiver accepts as their own `put-on`); `any-items` — _Anyone's_.
- Moves (plan §25 D): a **give** is two sides judged separately (`take-from` on the giver, `put-on` on the receiver); a **drop** is the giver's side only; a **pick-up** the receiver's side only.
- Override (`all-own`, `all-any`, `own-items`, `any-items`) passes `changedBy` — `rules` included — but **never** a lock `all` and **never** an unheard value (owner ruling ★4, 2026-11-05).

### The judge — exact semantics (first cause that applies wins, in this order)

1. `role === 'watcher'` → `{ ok: false, cause: 'watching' }` (every act, `configure` included).
2. `act === 'configure'` → `role === 'owner'` ? ok : `'owner-locks'` (only the session owner sets or clears a lock; nothing else is read).
3. `heard === false` → `'unheard'`.
4. `lock === 'all'` → `'locked'`; `lock === 'people' && role === 'player'` → `'locked'` (the session owner still writes a `people` lock — today's `lockAllows`; latitude never passes a lock).
5. For `take-from` / `put-on` with `itemMoves` (default `follow-sheet`):
   - `follow-sheet` → continue to step 6 exactly as a `set`;
   - `no-moves` → `'no-moves'`;
   - `own-items` → `whose === 'own'` ? ok : `'not-theirs'`;
   - `any-items` → ok.
6. Sheet latitude (for `set`, and for a move under `follow-sheet`):
   - `no-edits` → `'no-edits'`;
   - `all-any` → ok;
   - `all-own` → `whose === 'own'` ? ok : `'not-theirs'`;
   - `as-ruled` → a player with `whose === 'other'` → `'not-theirs'`; otherwise judge `changedBy` with writer `gm` (owner) or `holder` (player): absent/empty or includes `everyone` → ok; includes the writer → ok; writer `gm` and includes `holder` → ok; else `'changed-by'`.

Pure: no I/O, no imports beyond the type. Never throws.

### `widgets.ts` — on `SessionStateOwnerV1`, after `configs` (~933)

```ts
/**
 * 🚧 **Hand-locked stats** (owner ruling 2026-11-05, plan §25 ★1): per slot id, the sentence the
 * viewer reads for why they may not change that value by hand here — the cause shown (P1). A
 * widget draws a slot listed here without edit controls and shows the sentence. Worked out by the
 * host with `sheetLatitudeAllows`. ⚠ Not the slot lock (`configs[slot].lock`, which says what the
 * owner set) and not `editable` (the whole owner). Absent: nothing is hand-locked for the viewer,
 * or a host that predates it.
 * @experimental
 */
handLocked?: Record<string, string>
```

### `sdk-tests/sheetLatitude.test.ts`

`node:test` + `node:assert/strict`, importing from `'@serene-pub/sdk'` (paths resolve to source). A header doc comment (what and why, dated 2026-11-05, plan §25). Cover:
- the level lists, in order, and the cause list;
- `watching` for every act incl. `configure`; `configure` ok for the owner, `owner-locks` for a player — whatever the latitude and lock;
- the matrix: each sheet level × role (`owner`, `player`) × `whose` (`own`, `other`) × `changedBy` (absent, `['everyone']`, `['holder']`, `['gm']`, `['rules']`) for `set` — write the expected table explicitly (a small array of rows), never computed by re-implementing the judge;
- lock `all` refuses every level incl. `all-any` and the owner; lock `people` refuses a player at `all-any`, passes the owner; `heard: false` refuses the owner at `all-any`;
- moves: each item-move level × role × `whose` × `take-from`/`put-on`; `follow-sheet` equals the `set` verdict under the same latitude (incl. `changedBy`); absent `itemMoves` behaves as `follow-sheet`; `own-items` passes `changedBy: ['rules']` on own; a give judged as two sides: a player at `own-items` gives own→other = `take-from` ok, `put-on` `not-theirs` (the receiver's offer), the receiver's own `put-on` ok;
- `sheetLatitudeOf` / `itemMoveLatitudeOf` with each level, `undefined`, `'none'`, `42`.

Run it: `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test sheetLatitude.test.ts`. Typecheck: `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsc --noEmit -p .` — report only errors in your files (other lanes' in-flight errors may exist; name them, don't fix them). Format: `npx prettier --check <file>` on your files (match the file's existing style; SDK src uses tabs and no semicolons — check a neighbour).

## Rules you work under (quoted)

- NOMENCLATURE R1 "One word, one meaning." · R3 "Qualify, never abbreviate to the bare noun." · R6 "🚧 Provisional — designed but not built, so the words may still move on contact with implementation." Every new name above carries 🚧 in its doc.
- NOMENCLATURE §24: "5. Say what it is **not**, in the declaration, if a near-neighbour exists." · "6. UI labels are prose and need not match internal names — but must not _contradict_ them."
- The surface audit: every export carries exactly ONE of `@public` / `@experimental` / `@internal` — use `@experimental`.
- CLAUDE.md Decisions: "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later': no option, hook or extension point nobody asked for." A name not in this brief is a question for the supervisor — put it in your report, don't invent it.
- CLAUDE.md Hard rule: "Never `git checkout` / `restore` / `stash` in `../serene-pub-sdk` — most of it is uncommitted."
- "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`." (The judge runs in the browser too.)

Verbatim:
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* — you do not run `sdk:build` at all; the supervisor does.

## Stop and ask (in your report) when

CLAUDE.md §Decisions applies, a ★ is unruled, a name is new beyond this brief, or anything outside the owned files seems needed.

## Done means

`sheetLatitude.test.ts` green; no new `tsc` error in your files; prettier clean on your files. Report: changed files, tests run with results, anything you decided, Noticed-not-done.
