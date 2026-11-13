# BRIEF shelf-B-w1 — `models:hubCard`: the Hugging Face card read, its handler, its types

You are a `lane-worker` in lane `shelf-B` (supervisor: the shelf-B lane-supervisor). Report back to your supervisor in your final message.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

A new admin-only socket request `models:hubCard { repo }` answers one Hugging Face repo's card facts and its GGUF file sizes, for a page in the model finder. It is built on the repo read that already exists in `hfGgufQuants.ts` (`fetchHfRepoSiblings`, URL `https://huggingface.co/api/models/<repo>?blobs=true`, whose JSON also carries `cardData`, `gguf`, `downloads`, `lastModified`, `tags`). One HTTP call per repo fills both caches; the card part is cached **24 h** by repo.

## Files owned (the only files you may edit)

- `src/lib/server/connections/hfGgufQuants.ts` and `src/lib/server/connections/hfGgufQuants.test.ts`
- new `src/lib/server/sockets/modelHubCard.ts` and new `src/lib/server/sockets/modelHubCard.test.ts`
- `src/lib/server/sockets/index.ts` — **only** two lines: one `import { registerModelHubCardHandlers } from "./modelHubCard"` beside the `registerModelPresenceHandlers` import (:64), and one `registerModelHubCardHandlers(socket, emitToUser, register)` beside its call (:311). Nothing else in that file.
- `src/lib/shared/sockets/types.ts` — **only** one new block, `namespace HubCard`, inside `namespace Models` directly after `namespace MachineHardware` (around :3515-3523). Report its line range.

## Files readable

Everything. Start with `hfGgufQuants.ts` (whole, 163 lines), `hfGgufQuants.test.ts` (:118 on, how fetch is mocked), `sockets/modelPresence.ts` (the handler + registration pattern — copy `modelsMachineHardware`'s shape: never throws, failures ride the reply's `error`), `sockets/modelPresence.test.ts` (test pattern), `services/loginRateLimit.ts` (:1-60), `sockets/koboldcpp.ts:1259-1272` (how a search uses the limiter).

## What to build

### 1. `hfGgufQuants.ts`

- Keep `fetchHfRepoSiblings(repoId)` exactly as callers see it today (same return, same 10-minute cache including cached failures). Its HTTP read moves into one private function (e.g. `readHfRepo`) that, on a successful public read, also stores the card in a second cache with a **24 h** TTL. Private / gated (`m.private`, `m.gated === true | "auto"`) and failed reads store no card.
- Export `HfRepoCard` = `{ license?: string; languages?: string[]; contextLength?: number; baseModel?: string; downloads?: number; lastModified?: string }`, and a pure `hfRepoCardFrom(m: any): HfRepoCard` — every field optional and **omitted** when unknown, never `null`/`""`:
  - `license`: `cardData.license` (string; an array → its strings joined `", "`), else the first `license:<id>` entry of `m.tags`.
  - `languages`: `cardData.language` (string → `[it]`; array → its non-empty strings). Omitted when empty.
  - `contextLength`: `m.gguf.context_length` when a positive finite number.
  - `baseModel`: `cardData.base_model` (string; array → first string).
  - `downloads`: `m.downloads` when a finite number ≥ 0.
  - `lastModified`: `m.lastModified` when a non-empty string.
- Export `fetchHfRepoCard(repoId): Promise<{ card: HfRepoCard | null; siblings: HfSibling[] | null }>`:
  - card fresh (< 24 h) **and** siblings cache fresh (< 10 min) → both from cache, no HTTP.
  - siblings cache fresh and holding a cached failure (`null`) → `{ card: cachedCard ?? null, siblings: null }`, no HTTP (the 10-minute failure cache is what stops a retry storm).
  - otherwise exactly **one** `readHfRepo` call, which refreshes both caches.
- Export `hfRepoReadCached(repoId): boolean` — true exactly when `fetchHfRepoCard` would answer without HTTP. (The handler spends the limiter only on real Hub reads.)
- `clearHfSiblingsCache()` also clears the card cache (it is the test seam).

### 2. `sockets/modelHubCard.ts`

Header doc comment in the house style (see `modelPresence.ts`): 🚧 `models:hubCard` — one Hugging Face repo's card facts and file sizes for the finder model page; admin only (members never touch model plumbing); asked only when the page opens; the card is cached a day; failures ride the reply's own `error`.

`export const modelsHubCard: Handler<Sockets.Models.HubCard.Params, Sockets.Models.HubCard.Response>`, event `"models:hubCard"`. It never throws; it always `emitToUser("models:hubCard", res)` and returns `res`. In order:

1. Not admin → `{ repo, error: "Access denied. Only admin users can read Hugging Face model cards." }`.
2. `repo` (trimmed string) must match `/^[A-Za-z0-9][\w.-]*\/[\w.-]+$/`, contain no `..`, and be ≤ 200 chars; else `{ repo, error: "That is not a Hugging Face repo id." }`. (It is interpolated into a URL; this is the guard.)
3. If `!hfRepoReadCached(repo)`: `loginRateLimit.isRateLimited("models:hubCard")` → `{ repo, error: "Rate limited. Please wait a moment and try again." }`; else `loginRateLimit.recordFailedAttempt("models:hubCard")`. The key is exactly `models:hubCard` — its own allowance, never the searches' keys. A cached answer spends nothing.
4. `fetchHfRepoCard(repo)`; any throw → `{ repo, error: "Hugging Face would not answer for that repo." }` (log with `console.error`).
5. Both `card` and `siblings` null → `{ repo, error: "Hugging Face would not answer for that repo." }`.
6. Otherwise `{ repo, card?: card (omit when null), files?: siblings filtered to rfilename ending ".gguf", each { rfilename, size? } (size only when a number) }`.

`export function registerModelHubCardHandlers(socket, emitToUser, register)` — same signature and body shape as `registerModelPresenceHandlers`.

### 3. `types.ts` block (inside `namespace Models`, after `MachineHardware`)

```ts
			/**
			 * 🚧 `models:hubCard` — one Hugging Face repo's card facts and its
			 * GGUF file sizes, for the finder model page (admin). Asked only
			 * when the page opens; the card is cached a day by repo, read in
			 * the same call as the quant lists' sibling sizes. Failures ride
			 * the reply's own `error`.
			 */
			namespace HubCard {
				interface Params {
					/** "owner/name", as the Hub spells it. */
					repo: string
				}
				/** Only the facts the Hub stated; an unknown one is absent. */
				interface Card {
					license?: string
					languages?: string[]
					contextLength?: number
					baseModel?: string
					downloads?: number
					lastModified?: string
				}
				/** A `.gguf` sibling and its byte count, in the Hub's own field names. */
				interface File {
					rfilename: string
					size?: number
				}
				interface Response {
					repo: string
					card?: Card
					files?: File[]
					error?: string
				}
			}
```

`HfRepoCard` in `hfGgufQuants.ts` must stay structurally identical to `Sockets.Models.HubCard.Card`.

## Rules (quoted from the lane's brief and CLAUDE.md)

- "`models:hubCard { repo }` → `{ repo, card?: { license, languages, contextLength, baseModel, downloads, lastModified }, files?: sizes per sibling, error? }`. Asked **only when the page opens**. Card part cached **24 h** by repo; reuse `fetchHfRepoSiblings`' read (one HTTP call per repo, not two). Limiter key `models:hubCard`, via `loginRateLimit`, same allowance shape as the searches. Admin-only like the searches."
- "Event names and fields above are ruled; any other new name → stop and ask." Exported code identifiers named in this brief are fine; do not add any other event, wire field, setting or flag.
- "Members never see or touch model plumbing — connections, models, sampling, loadouts."
- Do not change any other caller's behaviour: `koboldcpp.ts` and `ollama.ts` keep calling `fetchHfRepoSiblings` unchanged.
- Decide implementation details yourself and name them in your report; anything a user sees beyond the error sentences above, or any new name → stop and report.

## Tests

- `hfGgufQuants.test.ts`: `hfRepoCardFrom` (each field, string vs array forms, unknowns omitted, licence from tags as fallback); `fetchHfRepoCard` makes **one** fetch that fills both caches (a following `fetchHfRepoSiblings` makes no fetch, and vice versa: a siblings read first, then `fetchHfRepoCard`, makes no second fetch); the card outlives the 10-minute siblings TTL but a stale siblings cache causes one refetch (use `vi.useFakeTimers()` / `vi.setSystemTime`); gated/private stores no card; `hfRepoReadCached` true/false in those cases. Existing tests stay green.
- `modelHubCard.test.ts` (mock `$lib/server/connections/hfGgufQuants` and `$lib/server/services/loginRateLimit` as `modelPresence.test.ts` mocks its deps): non-admin refused with no read; bad repo ids (`a`, `../x/y`, `a/b/c`, `a/b?x=1`) refused with no read; a cached read spends no limiter; an uncached read checks then records `models:hubCard`; rate-limited → error, no read; card + `.gguf` files mapped, non-gguf dropped; both null → error sentence; a throw → error sentence; every path emits `models:hubCard` with the reply.
- Run: `npx vitest run src/lib/server/connections/hfGgufQuants.test.ts src/lib/server/sockets/modelHubCard.test.ts` and `npx prettier --check` on every file you changed (use `npx prettier --write` on your own files first).

Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout (none expected here).

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (No SDK change is expected in this task.)

## Report (your final message)

Changed files with what changed; the `types.ts` line range; tests run with results; implementation choices you made; anything you stopped on.
