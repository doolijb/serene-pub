/**
 * What may be in `GATED_EVENTS`, asserted rather than left to review.
 *
 * Two rules, both of which fail SILENTLY in production if they are broken — a
 * gated event with no consumer is a screen that stops updating, and there is no
 * error anywhere to say so:
 *
 *   1. **No `:error` event is ever gated.** `Layout.svelte`'s
 *      `socket.onAny(handleAnyEvent)` toasts every otherwise-unhandled
 *      `*:error`, and a catch-all declares interest in nothing. Gating one
 *      turns a failed request into silence, which is the one failure a client
 *      waiting on a reply cannot recover from (plan ruling 2).
 *   2. **Every entry belongs to a family this migration has actually
 *      converted.** The list grows one family per slice, and the slice that
 *      grows it says so HERE as well — so a family added without its consumers
 *      moving to the registry fails a test instead of going dark in a view
 *      nobody opened during review.
 *
 * Extending rule 2 is the deliberate act: add the family to `MIGRATED_FAMILIES`
 * — or the event itself to `MIGRATED_EVENTS`, for the one gated event that has
 * no family — in the same change that adds its events, with its consumers named
 * in the comment beside them in `interest.ts`.
 *
 * The scope table `SCOPED_EVENTS` is asserted here too, for the same reason: an
 * extractor reading a field the payload does not have takes a scoped client's
 * push away with no error anywhere.
 */
import { describe, expect, test } from "vitest"
import {
	GATED_EVENTS,
	isGatedEvent,
	isScopedEvent,
	scopeOfPayload,
	SCOPED_EVENTS
} from "./interest"

/**
 * The families whose LAST client consumer is on the interest registry.
 *
 * Phase 2, slice 1 (2026-09-14):
 *   - `language:`      — client/i18n/state.svelte.ts
 *   - `widgetStyles:`  — client/stores/widgetStyles.svelte.ts
 *   - `state:`         — client/state/sessionState.svelte.ts
 *   - `backups:`       — client/components/settingsTabs/DataSettingsTab.svelte
 */
const MIGRATED_FAMILIES = [
	"language:",
	"widgetStyles:",
	"state:",
	"backups:",
	// The admin overhaul (2026-09-27): client/admin/adminHealth.svelte.ts.
	"admin:",
	// slice 2 (2026-09-14): every client consumer listed beside the entries.
	"sessions:",
	// slice 3 (2026-09-14): pipelines — a mixed family, never a restricted prefix.
	"pipelines:",
	// slice 4 (2026-09-15): the cast group. `personas:` was one of them and is
	// now gone — 0133 folded the family into `characters:` — so this list is
	// also the record that no gated event may name it again.
	"characters:",
	"characterFolders:",
	"tags:",
	"cardSources:",
	// slice 5 (2026-09-15): the content group.
	"lorebooks:",
	// 2026-09-23: amendments arrive gated — the family was born after the
	// sweep, and its one consumer (LorebooksWorkspace) declares interest.
	"amendments:",
	"entries:",
	"bindingSuggestions:",
	"bindingCheck:",
	// slices 6+7 (2026-09-15): session-adjacent and admin/config.
	"scenes:",
	"sessionGenres:",
	"sessionPresets:",
	"narrativeGraph:",
	"media:",
	"vectorization:",
	"taskQueue:",
	"activity:",
	"import:",
	// C6 P4 (2026-09-26): authored components arrive gated — the family was
	// born after the sweep; its consumers (the admin components pages, and the
	// session page for `components:changed`) are on the registry by construction.
	"components:",
	"users:",
	"userSettings:",
	"systemSettings:",
	"plugins:",
	"totp:",
	"completionTemplates:",
	"samplingConfigs:",
	"customThemes:",
	"tunnels:",
	"invites:",
	"setup:",
	"account:",
	"allowedHosts:",
	// slice 8 (2026-09-15): the connections group, deferred until the
	// model-column work settled; `ner:` and `images:` had their last
	// consumers in these files.
	"connections:",
	"connectionDefaults:",
	"koboldcpp:",
	"ollama:",
	"ner:",
	"images:",
	// The Jump overlay (2026-09-15). A new family rather than a migrated one:
	// its only consumer is the overlay the shell lane builds on top of it, and
	// the interest registry is the one listener path a client has since phase 4
	// retired `on`/`off` — so it cannot be written off the registry.
	"jump:",
	// Per-user plugin settings (2026-09-26): born gated, its one consumer
	// (settingsTabs/PluginUserSettingsCard.svelte) on the registry.
	"pluginUserSettings:",
	// Notifications (2026-09-28): born gated; its consumer is the shell's
	// notifications store, declared at init scope in both shells.
	"notifications:",
	// A lorebook's own stats (plan places-graph L4, 2026-09-29): born gated
	// and scoped by book; its consumer (places/placeStatsApi.ts, the place
	// editor's Stats section) asks through `awaitReply`.
	"lorebookState:",
	// Admin › Updates (2026-10-01): born gated; its one consumer
	// (admin/sections/updates/Page.svelte) is on the registry.
	"updates:"
]

/**
 * Gated events that are not in a family at all — one entry, and the reason the
 * rule above is worded as a family rather than as a prefix.
 *
 * Phase 3 (2026-09-14):
 *   - `sessionMessage` — the streamed reply. A legacy name with no colon in it,
 *     so no prefix can cover it. Consumers: routes/sessions/[id]/+page.svelte,
 *     routes/document-view/sessions/[id]/+page.svelte,
 *     client/lorebooks/LorebooksWorkspace.svelte — all three on the registry,
 *     all three declaring the SCOPED key.
 */
const MIGRATED_EVENTS = ["sessionMessage"]

describe("GATED_EVENTS", () => {
	test("gates no error event", () => {
		expect([...GATED_EVENTS].filter((e) => e.endsWith(":error"))).toEqual(
			[]
		)
	})

	test("holds nothing but events of a migrated family", () => {
		const strays = [...GATED_EVENTS].filter(
			(event) =>
				!MIGRATED_FAMILIES.some((f) => event.startsWith(f)) &&
				!MIGRATED_EVENTS.includes(event)
		)
		expect(
			strays,
			`Gating a family means its last consumer has moved to the interest ` +
				`registry. Add the family to MIGRATED_FAMILIES in the same ` +
				`change that adds its events — and only after grepping ` +
				`on("<family>: across src/lib/client and src/routes.`
		).toEqual([])
	})

	test("every entry is a bare event name, never a scoped key", () => {
		// The server looks a gated event up by name; a scope belongs to the
		// key a CLIENT declares, never to this set.
		expect([...GATED_EVENTS].filter((e) => e.includes("#"))).toEqual([])
	})

	test("isGatedEvent answers for the set, and for nothing else", () => {
		expect(isGatedEvent("backups:list")).toBe(true)
		expect(isGatedEvent("backups:list:error")).toBe(false)
		// Slice 8 closed the last deferred family; a name that no handler
		// emits stays outside the set.
		expect(isGatedEvent("connections:list")).toBe(true)
		expect(isGatedEvent("connections:nothingEmitsThis")).toBe(false)
	})
})

/**
 * The scope table, which is the one thing both sides read.
 *
 * A mismatch here is silent in exactly the same way as a stray gated event: a
 * client declaring `event#42` for an event whose extractor looks in the wrong
 * field receives nothing, and there is no error anywhere to say so. So each
 * entry is asserted against the payload shape the server actually broadcasts.
 */
describe("scopeOfPayload", () => {
	test("reads the streamed reply's scope off the message row", () => {
		// `broadcastToSessionUsers(io, id, "sessionMessage", { sessionMessage: row })`
		expect(
			scopeOfPayload("sessionMessage", {
				sessionMessage: { id: 9, sessionId: 42 }
			})
		).toBe("42")
	})

	test("reads `sessionId` for state:changed and sessions:userTyping", () => {
		expect(scopeOfPayload("state:changed", { sessionId: 42 })).toBe("42")
		expect(
			scopeOfPayload("sessions:userTyping", {
				sessionId: 7,
				personaId: 3,
				personaName: "Ann"
			})
		).toBe("7")
	})

	test("reads `sessionId` off a run's status frame (R-19), end frame included", () => {
		// `broadcastToSessionUsers(io, id, "sessions:runStatus", { sessionId, runId, status })`
		expect(
			scopeOfPayload("sessions:runStatus", {
				sessionId: 7,
				runId: "r1",
				status: {
					i18n: { en: "{speaker} is typing" },
					vars: { speaker: "Ann" }
				}
			})
		).toBe("7")
		expect(
			scopeOfPayload("sessions:runStatus", {
				sessionId: 7,
				runId: "r1",
				status: null
			})
		).toBe("7")
		expect(isGatedEvent("sessions:runStatus")).toBe(true)
	})

	test("reads `sessionId` off a list-row push, a cleared quote included", () => {
		// `broadcastToSessionUsers(io, id, "sessions:rowChanged", thunk)` —
		// the thunk builds `{ sessionId, messageCount, lastMessage, updatedAt }`.
		expect(
			scopeOfPayload("sessions:rowChanged", {
				sessionId: 7,
				messageCount: 3,
				lastMessage: {
					excerpt: "The candles have not been lit since Tuesday.",
					speakerName: "Brother Alder",
					isUser: false,
					createdAt: "2026-09-16T12:00:00.000Z"
				},
				updatedAt: "2026-09-16"
			})
		).toBe("7")
		// Deleting the last visible line pushes a null quote, and the scope is
		// still read off the same field.
		expect(
			scopeOfPayload("sessions:rowChanged", {
				sessionId: 7,
				messageCount: 0,
				lastMessage: null,
				updatedAt: "2026-09-16"
			})
		).toBe("7")
		expect(isGatedEvent("sessions:rowChanged")).toBe(true)
	})

	test("reads sessions:get's scope off the session, which is where it is", () => {
		// The successful reply carries the id on the session and nowhere else —
		// the trap this table exists to keep out of a client's key.
		expect(scopeOfPayload("sessions:get", { session: { id: 42 } })).toBe(
			"42"
		)
	})

	test("falls through to sessionId on a not-found sessions:get reply", () => {
		// The one reply with no session in it. The server puts the requested id
		// beside the null so this still has a scope: without it the payload
		// would reach only a BARE `sessions:get` key, and a bare key hears every
		// other session's reply too — the gate would pass for every id while any
		// session view was open.
		expect(
			scopeOfPayload("sessions:get", { session: null, sessionId: 7 })
		).toBe("7")
		// A reply with neither is still scopeless, and must stay so rather than
		// inventing a scope no server named.
		expect(scopeOfPayload("sessions:get", { session: null })).toBeNull()
	})

	test("reads `sessionId` for the two pipeline run pushes", () => {
		// Both are pushed with the run beside the session, from three sites:
		// `server/utils/runReply.ts` (the reply path) and
		// `server/sockets/sessions.ts` (a triggered function, including the
		// terminal `{ done: true }` its `finally` sends). The scope is the
		// SESSION rather than the run: a tab shows the card for the session it
		// has open, and it does not know a run id until the card arrives.
		expect(
			scopeOfPayload("pipelines:runStarted", {
				runId: "r-1",
				sessionId: 42,
				specId: 3,
				label: "respond",
				steps: 2
			})
		).toBe("42")
		expect(
			scopeOfPayload("pipelines:progress", {
				runId: "r-1",
				sessionId: 7,
				specId: 3,
				label: "respond",
				node: "provider"
			})
		).toBe("7")
		// The terminal emit is the thinnest of the three and still carries it.
		expect(
			scopeOfPayload("pipelines:progress", {
				runId: "r-1",
				sessionId: 7,
				done: true
			})
		).toBe("7")
		// The run id is NOT the scope, however tempting: a client holds a
		// session, and a run it has never heard of is exactly the one whose
		// first frame it must not miss.
		expect(
			scopeOfPayload("pipelines:progress", { runId: "r-1" })
		).toBeNull()
	})

	test("reads `lorebookId` off a lorebook's own stats replies (L4)", () => {
		const reply = { lorebookId: 12, owner: { kind: "location", id: 40 }, branchId: null }
		expect(scopeOfPayload("lorebookState:get", reply)).toBe("12")
		expect(scopeOfPayload("lorebookState:set", reply)).toBe("12")
		expect(isGatedEvent("lorebookState:set")).toBe(true)
		expect(isGatedEvent("lorebookState:set:error")).toBe(false)
	})

	test("is null for an event with no scope", () => {
		expect(scopeOfPayload("backups:list", { sessionId: 42 })).toBeNull()
		expect(scopeOfPayload("state:get", { sessionId: 42 })).toBeNull()
	})

	test("is null when the payload does not carry the id", () => {
		for (const event of [...SCOPED_EVENTS.keys()]) {
			expect(scopeOfPayload(event, {}), event).toBeNull()
			expect(scopeOfPayload(event, undefined), event).toBeNull()
			expect(scopeOfPayload(event, null), event).toBeNull()
			expect(scopeOfPayload(event, "not an object"), event).toBeNull()
		}
	})

	test("always answers with a string, so a number id and its key agree", () => {
		const scope = scopeOfPayload("state:changed", { sessionId: 42 })
		expect(typeof scope).toBe("string")
		expect(scope).not.toBe(42 as unknown as string)
	})

	test("does not mistake a prototype member for an entry", () => {
		expect(isScopedEvent("toString")).toBe(false)
		expect(scopeOfPayload("toString", { sessionId: 42 })).toBeNull()
	})
})

describe("isScopedEvent", () => {
	test("answers for the table, and for nothing else", () => {
		expect(isScopedEvent("sessionMessage")).toBe(true)
		expect(isScopedEvent("state:changed")).toBe(true)
		expect(isScopedEvent("backups:list")).toBe(false)
	})
})

describe("names no server emits", () => {
	test("are neither gated nor scoped (2026-09-28)", () => {
		// Each of these answers on its family's LIST (`amendments:list`,
		// `bindingSuggestions:list`) or — `lorebooks:export`, while export is
		// paused — only on its `:error`. A table entry for a name nothing
		// emits reads as a contract and checks nothing.
		for (const event of [
			"amendments:create",
			"amendments:update",
			"amendments:delete",
			"amendments:fork",
			"amendments:renameBranch",
			"amendments:deleteBranch",
			"amendments:place",
			"amendments:unplace",
			"bindingSuggestions:add",
			"bindingSuggestions:ignore",
			"bindingSuggestions:unignore",
			"lorebooks:export"
		]) {
			expect(isGatedEvent(event), event).toBe(false)
			expect(isScopedEvent(event), event).toBe(false)
		}
		expect(isGatedEvent("amendments:list")).toBe(true)
		expect(isScopedEvent("amendments:list")).toBe(true)
	})
})

describe("the streamed reply", () => {
	test("is gated, and its error sibling is not", () => {
		expect(isGatedEvent("sessionMessage")).toBe(true)
		expect(isGatedEvent("sessionMessage:error")).toBe(false)
	})
})
