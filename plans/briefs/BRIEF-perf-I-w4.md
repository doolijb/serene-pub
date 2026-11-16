# BRIEF — perf-I worker 4 — the "Requests at once" card in Admin → Connections (client half)

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

Owner ruling 2026-11-13: "offer admin controls over these pools" — **per host, in Admin → Connections**: one card listing every host in use `(scheme, host, port)` with its derived default (1 local/managed, 4 known cloud) and an override field (1–16), with one sentence of purpose (P4). Members never see it (admin shell only). Socket events under the existing connections family; the connections domain context is their only listener and the only place that toasts.

Worker w3 is building the server half **at the same time** (the module, the socket handlers, and the wire types in `src/lib/shared/sockets/types.ts`). Build against these wire types exactly (w3 writes them; you do not edit `types.ts`):

```ts
namespace Sockets.Connections.LlmLanes {
	interface Params {}
	interface Host {
		laneKey: string            // the host's address: URL origin `scheme://host[:port]`
		defaultWidth: number       // 1 local or managed, 4 known cloud
		width: number | null       // the admin's override, or null when the default applies
		managed: boolean
		cloud: boolean
		connections: { id: number; name: string }[]   // empty for an override whose host is no longer used
	}
	interface Response { hosts: Host[] }
}
namespace Sockets.Connections.SetLlmLaneWidth {
	interface Params { laneKey: string; width: number | null }   // null clears the override
	interface Response { laneKey: string; width: number | null; error?: string }
}
```
Events: `connections:llmLanes` (ask with `{}`; the server answers `connections:llmLanes` to the asking socket, and again after every successful write), `connections:llmLanes:error`, `connections:setLlmLaneWidth` (ack), `connections:setLlmLaneWidth:error`. Both handlers are admin-only on the server.

## Files owned (edit only these)

- `src/lib/client/sockets/typedSocket.ts` — **additive**: the four event-map entries beside `connections:capabilities` / `connections:setCapability` (`:1130-1145`), same shape (`:error` uses `Sockets.ErrorResponse`), with a short comment like its neighbours. Do not add them to `HANDLED_ERROR_EVENTS`: a failed read/write is worth a toast and Layout's `onAny` catch-all gives it one.
- `src/lib/shared/sockets/interest.ts` — **additive**: gate the two SUCCESS events (`connections:llmLanes`, `connections:setLlmLaneWidth`) in the `connections:` group of `GATED_EVENTS` (`:1270-1300`), extending its consumers comment with `client/contexts/connections.svelte.ts`. Never gate an `:error` event (rule 1 in the comment above `GATED_EVENTS`). Not in `SCOPED_EVENTS`.
- `src/lib/client/contexts/connections.svelte.ts` — **additive**: the context holds the hosts list (`$state`), declares the two success interests (+ the list's `:error` only if the existing pattern declares `:error` interests — it does for `connections:list:error`, follow that) inside the same `hold()`-managed `releases` block (`:537-578`), exposes `askLlmLanes()` and `setLlmLaneWidth(laneKey, width | null)` and the list, and toasts ONE `notify.success` ("Saved") only when the ack is for a write THIS tab asked for (the `expectCreate` pattern: remember the keys this tab sent). Errors: no toast here (the catch-all does it); clear any "saving" mark on `:error`.
- `src/lib/client/contexts/connections.dom.test.svelte.ts` — extend: nothing is asked until held; the list lands; an ack for this tab's write toasts once, another tab's does not; interests release with the holder.
- `src/lib/client/admin/sections/connections/Page.svelte` — one card, below the changelist (a sibling after `<AdminChangelist …>`; the page stays a changelist). It reads the list from `useConnections()` (hold it for the page's life as other views do), asks `askLlmLanes()` on mount, never registers its own socket listener, never toasts.
- `src/lib/client/admin/sections/connections/connectionsAdmin.ts` (+ `connectionsAdmin.test.ts`) — pure helpers the card needs, e.g. the row's "used by" words and the override parse (`""` → `null`; an integer 1–16 → that number; anything else → a refusal sentence).
- `docs/connections.md` — under `## Admin › Models › Connections` (`:303`), one paragraph (see Copy below).

## The card (STYLE-GUIDE §6.4 setting cards, §6.11 admin pages, §10 Writing — read those sections first: `grep -n "^### 6.4\|^### 6.11\|^## 10" STYLE-GUIDE.md`, then `sed -n` them)

- A `panel-card` (every admin card is `panel-card`, §6.11). Title (sentence case): **Requests at once**. Purpose, one sentence, the owner's own wording: _How many requests this server takes at once; one for a local model, more for a cloud provider._
- One row per host: the address (`laneKey`, mono), under it the connections that use it (names, comma-joined; for an empty list, _No connection uses this address now._), the default (`Default 1` / `Default 4`), and a small number input (min 1, max 16, step 1, placeholder = the default, `aria-label="Requests at once for <address>"`) whose value is the override or empty. Saving: on change/blur of a valid value, `setLlmLaneWidth(laneKey, n)`; emptying it sends `null` (back to the default). An invalid value shows the refusal sentence under the field (no toast) and sends nothing. Remember `bind:value` on a number input yields a number (or null), not a string.
- Empty list: say nothing beyond the purpose sentence plus one invitation line: _Add a connection and its address shows here._ (§10: empty states are invitations, no "No items found".)
- Loading: the card's own quiet state, the way the page's changelist shows loading; no spinner wall.
- Container queries / phone width: rows stack below the card's narrow width (§5.3 container rules — use the existing `@container` idiom you find in the section's siblings).
- A doc comment at the top of the card's markup block (an HTML comment or in the script) that says: this governs **requests in flight per host, never model residency or loading order** — the first piece of the Servers direction (`project_model_lane_lifecycle`).
- Members never see it: Admin → Connections is admin-shell only already; add nothing for members.

## Copy (★ — the owner reviews; use exactly this, the supervisor lists it as open)

- Card title: **Requests at once**
- Purpose: _How many requests this server takes at once; one for a local model, more for a cloud provider._
- Row: `Default N`; used-by line: `<name>, <name>`; no user: _No connection uses this address now._
- Empty: _Add a connection and its address shows here._
- Refusal: _Use a whole number from 1 to 16, or leave it empty for the default._
- Toast on this tab's save: **Saved**
- docs paragraph (under Admin › Models › Connections): "**Requests at once**, under the table, lists every address your text connections reach and how many requests each takes at the same time. A server on your own machine or network, or one Serene Pub runs, takes one at a time, so two replies never share a graphics card; a known cloud provider takes four. Calls to different addresses always run side by side, and connections that share an address share its count. Type a number from 1 to 16 to change an address's count, or empty the field to go back to its default. It sets how many requests are sent at once, never which models are loaded."

## Rules (quoted by the supervisor)

- **CLAUDE.md Sockets:** "one domain context per event family (provided by both shells) is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`." So the card never listens and never toasts.
- **CLAUDE.md:** `socket.off(event)` with no handler removes every listener app-wide — always pass the handler. `$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`. Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`.
- **Standing ruling:** members never see or touch model plumbing; this is admin-only.
- **P3/P4:** one control, grouped by its task, one sentence of purpose. Add no other setting, toggle or field.
- **STYLE-GUIDE §10 Writing:** sentence case; "Help is one sentence"; "Labels are nouns, hints are sentences, empty states are invitations"; errors say what went wrong and what to do; one installation is a **pub**, never _the server_ — here "server" means the model server at an address, which is allowed (NOMENCLATURE §26: a pub is "not a KoboldCPP/Ollama process").
- **NOMENCLATURE R1/R3:** in code say **LLM lane**, never bare "lane" (bare "lane" is indexing; the session sense is "channel lane"). New names allowed: the context's `llmLanes` list, `askLlmLanes`, `setLlmLaneWidth`, and helper names inside `connectionsAdmin.ts` prefixed `llmLane…`. Ask before any other exported name. Do not edit NOMENCLATURE.md or STYLE-GUIDE.md.
- Out of scope: the server half, `types.ts`, `schema.ts`, `sockets/connections.ts`, anything outside the owned files.

## Tests (Done means)

`npx vitest run src/lib/client/admin/sections/connections/connectionsAdmin.test.ts` and, capped, `systemd-run --user --scope -p MemoryMax=6G npx vitest run src/lib/client/contexts/connections.dom.test.svelte.ts src/lib/shared/sockets/gatedEvents.test.ts src/lib/client/admin/sections/connections/comesWithApp.dom.test.svelte.ts`. Then `npx tsc --noEmit -p . 2>&1 | grep -E "typedSocket|interest\.ts|contexts/connections|sections/connections"` and `npx svelte-check --threshold error 2>&1 | grep -A3 "sections/connections/Page.svelte\|contexts/connections"` (types from w3 may land while you work; if `Sockets.Connections.LlmLanes` is still missing at the end, report "typecheck pending w3"). `npx prettier --check` on each touched file (if a file already failed at HEAD, say so; do not reformat it).

## Hazards (verbatim)

- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You need no sdk:build.)
- "Never pipe vitest into `head`. Run int tests in a capped scope: `systemd-run --user --scope -p MemoryMax=6G npx vitest run <files>`."

## Report

`plans/REPORT-perf-I-w4.md`: changed files (line ranges in the three shared files), tests with counts, tsc/svelte-check/prettier results, noticed-not-done.
