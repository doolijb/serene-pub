# BRIEF — perf-I worker 3 — LLM lane width overrides: the server half

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

Owner ruling 2026-11-13 (★P2-b follow-up): "offer admin controls over these pools" — **per host, in Admin → Connections**: a table of every host in use `(scheme, host, port)` with its derived default width (1 local/managed, 4 known cloud) and an admin override (1–16), stored in a new small table keyed by host so connections sharing a host share the width. Members never see it. The queue reads width as: override if a row exists, else the derived default. This is the first piece of the Servers direction: it governs **requests in flight per host, never model residency or loading order** (a queue never owns model lifecycle).

You build the server half: the module that owns the override table, its socket read/write, and the wire types. Worker w4 builds the client half at the same time against the wire types below — keep them exactly.

## Already built (read, do not redesign)

- `src/lib/server/connections/llmLanes.ts`: `LlmLaneHost { laneKey, managed, cloud }`, `llmLaneHostOf`, `resolveLlmLaneHost` (resolves a managed KoboldCPP's real address from `koboldCppSettings`), `defaultLlmLaneWidth`, `llmLaneWidthOf(host, laneKey)` (override ?? default, clamped 1–16), `setLlmLaneWidthOverrides(map)`. The `laneKey` is the URL origin (`new URL(base).origin`) or a `connection:<id>` fallback for a connection with no parseable address.
- `src/lib/server/utils/llmQueue.ts`: `llmQueue.widthsChanged()` re-reads every LLM lane's width and starts waiting items.

## The table (the supervisor adds it to `schema.ts` and generates migration `0159` — you do NOT edit `schema.ts` or run `db:generate`)

```ts
/** 🚧 An admin's override of how many model requests one host takes at once (perf-I, 2026-11-13). */
export const llmLaneWidths = pgTable("llm_lane_widths", {
	/** The host: the URL origin `scheme://host[:port]` an LLM lane is keyed by (`llmLaneHostOf`). */
	laneKey: text("lane_key").primaryKey(),
	width: integer("width").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
})
```
If `grep -n "llmLaneWidths" src/lib/server/db/schema.ts` finds nothing when you reach typecheck/tests, finish the code, check again a little later, and if still missing report "tests pending schema" — never add it yourself.

## Files owned (edit only these)

- NEW `src/lib/server/connections/llmLaneWidths.ts` (+ NEW `src/lib/server/connections/llmLaneWidths.int.test.ts`)
- `src/lib/server/connections/llmLanes.ts` — one change only: `resolveLlmLaneHost` awaits `ensureLlmLaneWidthsLoaded()` (dynamic `import("./llmLaneWidths")`, so importing `llmLanes.ts` in a unit test still opens no database) before it returns.
- `src/lib/server/sockets/connections.ts` — **additive**: two new handlers + their two `register(...)` lines in `registerConnectionHandlers`. Nothing else in that file.
- `src/lib/shared/sockets/types.ts` — **additive**: two namespaces inside `namespace Connections` (`:2160`), beside the others. Do not touch `Sockets.Entries.Earmark` or `SessionMessageDelta` blocks or anything else.

## What to build

**`llmLaneWidths.ts`** — owns `llm_lane_widths` and every write to it (P2: no other module reads or writes the table).
- `ensureLlmLaneWidthsLoaded(): Promise<void>` — memoized: reads every row once, feeds `setLlmLaneWidthOverrides(new Map(rows.map(r => [r.laneKey, r.width])))`. A read that throws logs one `console.warn` and leaves the defaults (the queue must still work).
- `listLlmLaneHosts(): Promise<Sockets.Connections.LlmLanes.Host[]>` — the hosts **in use**: every `connections` row whose type is a text model type (`CONNECTION_TYPE.modalityOf(type) === "text-gen"` — only those reach the LLM queue; image and speech renders do not), through `resolveLlmLaneHost` (so the managed KoboldCPP shows its real address), grouped by `laneKey`, skipping `connection:` fallback keys (no address to name). Each host: `laneKey`, `defaultWidth: defaultLlmLaneWidth(host)`, `width` (the override or `null`), `managed`, `cloud`, `connections: [{ id, name }]` sorted by name. Then every override row whose host is no longer in use, with `connections: []` (so a stale override is visible and can be cleared). Sort: in-use hosts by laneKey, then the unused ones.
- `setLlmLaneWidth(laneKey: string, width: number | null): Promise<{ error?: string }>` — validates: `laneKey` must be its own origin (`new URL(laneKey).origin === laneKey`, refuse otherwise with a plain sentence); `width` is `null` (delete the row: back to the default) or an integer 1–16 (refuse otherwise). Upsert (`onConflictDoUpdate`, set `updatedAt`). Then re-read the rows, `setLlmLaneWidthOverrides(...)`, `llmQueue.widthsChanged()`. Use `db` from `$lib/server/db` (await `dbReady` if the module's pattern needs it — check how neighbouring server modules do it; never add a top-level await to `db/index.ts`). No transaction needed; if you use one, use only `tx` inside it.
- A doc comment at the top that says what it owns, what it does not (model residency, loading order — the Servers direction's later work; the managed-server record's own width would plug in at `defaultLlmLaneWidth`'s managed branch in `llmLanes.ts`), and who reads it (the LLM queue, via `llmLaneWidthOf`).

**Wire types (`types.ts`, inside `namespace Connections`)** — exactly:
```ts
/** 🚧 Admin → Connections' requests-at-once card: every host the LLM queue sends to (perf-I). Admin only. */
namespace LlmLanes {
	interface Params {}
	interface Host {
		/** The host's address: the URL origin `scheme://host[:port]` its LLM lane is keyed by. */
		laneKey: string
		/** The derived width: 1 for a local or managed host, 4 for a known cloud host. */
		defaultWidth: number
		/** The admin's override, or null when the default applies. */
		width: number | null
		managed: boolean
		cloud: boolean
		/** The connections that reach this host; empty for an override whose host is no longer used. */
		connections: { id: number; name: string }[]
	}
	interface Response { hosts: Host[] }
}
/** 🚧 Set or clear (`width: null`) one host's override (perf-I). Admin only. */
namespace SetLlmLaneWidth {
	interface Params { laneKey: string; width: number | null }
	interface Response { laneKey: string; width: number | null; error?: string }
}
```
(Match the file's existing style for `export`/`interface` inside namespaces — copy a neighbour like `Capabilities`.)

**Socket handlers (`sockets/connections.ts`)** — follow `connectionsCapabilities` / `connectionsSetCapability` (`:949-1070`) exactly for shape and the admin guard (`if (!socket.user!.isAdmin)` → `:error` event with `CAPABILITY_DENIED`):
- `connections:llmLanes` → `emitToUser("connections:llmLanes", { hosts: await listLlmLaneHosts() })`.
- `connections:setLlmLaneWidth` → `setLlmLaneWidth(...)`; on error `emitToUser("connections:setLlmLaneWidth:error", { error })`; on success `emitToUser("connections:setLlmLaneWidth", { laneKey, width })` then `emitToUser("connections:llmLanes", { hosts: await listLlmLaneHosts() })`.
- Register both plainly (no `afterModelChange` — this changes no model).

## Tests (Done means)

`llmLaneWidths.int.test.ts` (PGlite; follow `src/lib/server/db/surfacedFrom0148.int.test.ts` and `migrationsFolderThrough` from `$lib/server/utils/testDb` for the migration half; follow a neighbouring connections int test for a seeded db):
- migration `0159` creates the table empty on a database migrated through `0158`, and **a second migrate changes nothing** (the house rule for every migration);
- set an override → `listLlmLaneHosts` shows it, `llmLaneWidthOf` returns it; clear it (`null`) → default again; refusals: a non-origin key (`http://x:1/v1`), width 0, 17, 2.5;
- two connections on one host list as ONE host with both names; a local ONNX / image connection is not listed; an override for a host no longer used is listed with `connections: []`;
- a managed KoboldCPP connection lists at the settings address, `managed: true`, `defaultWidth: 1`.
Give each `it` that opens a DB a 60 s timeout. Run capped: `systemd-run --user --scope -p MemoryMax=6G npx vitest run src/lib/server/connections/llmLaneWidths.int.test.ts src/lib/server/connections/llmLanes.test.ts src/lib/server/utils/llmQueue.lanes.test.ts`. Then `npx tsc --noEmit -p . 2>&1 | grep -E "llmLane|sockets/connections\.ts|shared/sockets/types\.ts"` (expect nothing of yours) and `npx prettier --check` on each touched file (if a file already failed at HEAD, say so and do not reformat it).

## Rules (quoted by the supervisor)

- **P1:** "Same inputs, same result." The key is a pure function of base URL and type; the width is override ?? derived default, nothing time- or load-based.
- **P2:** "A module owns its data and every write to it; peers use its contract … never its tables." `llmLaneWidths.ts` is the only reader/writer of `llm_lane_widths`.
- **P3 / owner ruling:** this override is the one admin control the owner asked for; add no other setting, flag or field. Members never see it (admin guard on both handlers).
- **CLAUDE.md Sockets:** "one domain context per event family (provided by both shells) is the only listener, and the only place that toasts". Server side: reply with `emitToUser`; no toasts here. An event in `SCOPED_EVENTS` must carry its scope key — these are not scoped; do not add them there.
- **Hard rules:** inside `db.transaction(async (tx) => …)` use only `tx`; never seed a row at a hardcoded id; no `crypto.randomUUID`.
- **NOMENCLATURE R1/R3, §11:** bare "lane" means the indexing lanes; say **LLM lane**. New names allowed: `llmLaneWidths` / `llm_lane_widths`, `ensureLlmLaneWidthsLoaded`, `listLlmLaneHosts`, `setLlmLaneWidth`, the events `connections:llmLanes` / `connections:setLlmLaneWidth` (+ `:error`), the namespaces `LlmLanes` / `SetLlmLaneWidth`. Ask before any other exported name. Do not edit NOMENCLATURE.md.
- Out of scope: model residency, loading order, per-user caps, per-connection fields, adapters, the managed supervisor. Do not touch `runtime/host.ts`, `runtime/bindings.ts`, `routines/run.ts`, `schema.ts`, the drizzle folder.

## Hazards (verbatim)

- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You need no sdk:build.)
- "Never pipe vitest into `head`. Run int tests in a capped scope: `systemd-run --user --scope -p MemoryMax=6G npx vitest run <files>`."

## Report

`plans/REPORT-perf-I-w3.md`: changed files (line ranges in `sockets/connections.ts` and `types.ts`), tests with counts, tsc/prettier results, noticed-not-done.
