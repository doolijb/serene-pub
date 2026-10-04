/**
 * Every SCOPED lorebook-family reply carries the key its extractor reads —
 * asserted twice, once by the compiler and once at run time.
 *
 * A scoped reply without its scope key is dropped by the interest gate with
 * no error anywhere: `scopeOfPayload` answers null, a client that declared
 * `event#<id>` hears nothing, and the view simply stops updating. That is how
 * `scenes:listByLorebook` went dark (it answered `{ sceneList }` with no
 * `lorebookId`) — finding #159.
 *
 * 1. **The type.** `SCOPE_PATHS` names, per event, the field the extractor in
 *    `SCOPED_EVENTS` reads. `ScopeVerdicts` walks that path through the
 *    event's declared Response type and demands every step be REQUIRED and
 *    non-null, ending in an id. An optional or missing scope field fails
 *    `tsc` with the offending field in the message — so a handler that
 *    builds its reply as the declared Response (every one does) cannot leave
 *    the key out.
 * 2. **The extractor.** At run time each path is built into a payload and
 *    `scopeOfPayload` must read the id back, so the table and the type cannot
 *    drift apart: renaming the field in one place fails here.
 * 3. **Coverage.** Every SCOPED event of the lorebook families must be in
 *    `SCOPE_PATHS`, so a new one cannot skip the type check.
 *
 * The handlers' REAL replies are driven in
 * `server/sockets/scopedReplies.lorebooks.int.test.ts`.
 */
import { describe, expect, test } from "vitest"
import type { SocketEventMap } from "$lib/client/sockets/typedSocket"
import { SCOPED_EVENTS, scopeOfPayload } from "./interest"

/** The families this check covers — the lorebook side of the app. */
const LOREBOOK_FAMILIES = [
	"lorebooks:",
	"entries:",
	"amendments:",
	"bindingSuggestions:",
	"bindingCheck:",
	"scenes:",
	"narrativeGraph:",
	// The summarize modal's run, which writes lore (Phase D).
	"sessions:summarize:"
] as const

/**
 * The field each scoped event's extractor reads, as a path into the payload.
 * Where the extractor has a fallback (`lorebooks:get`'s `lorebook?.id ??
 * lorebookId`), the path named is the one EVERY reply carries.
 */
const SCOPE_PATHS = {
	"lorebooks:bindingList": ["lorebookId"],
	"lorebooks:get": ["lorebookId"],
	"lorebooks:storyTime": ["lorebookId"],
	"lorebooks:checkCalendar": ["lorebookId"],
	"lorebooks:setCalendar": ["lorebookId"],
	"lorebooks:setClock": ["lorebookId"],
	"lorebooks:lines": ["lorebookId"],
	"entries:list": ["lorebookId"],
	"entries:counts": ["lorebookId"],
	"entries:recentDecisions": ["lorebookId"],
	"entries:delete": ["lorebookId"],
	"entries:create": ["entry", "lorebookId"],
	"entries:update": ["entry", "lorebookId"],
	"entries:iterateNext": ["entry", "lorebookId"],
	"entries:updatePositions": ["lorebookId"],
	"amendments:list": ["lorebookId"],
	"bindingSuggestions:list": ["lorebookId"],
	"bindingCheck:result": ["sessionId"],
	"scenes:listByLorebook": ["lorebookId"],
	"scenes:list": ["sessionId"],
	"scenes:scenedMessageIds": ["sessionId"],
	"scenes:process:progress": ["sceneId"],
	"scenes:process:complete": ["sceneId"],
	"scenes:process:error": ["sceneId"],
	"scenes:compile:progress": ["historyEntryId"],
	"scenes:compile:complete": ["historyEntryId"],
	"narrativeGraph:list": ["lorebookId"],
	"narrativeGraph:duplicateCandidates": ["lorebookId"],
	"narrativeGraph:listMergeLogs": ["lorebookId"],
	"sessions:summarize:progress": ["sessionId"],
	"sessions:summarize:complete": ["sessionId"]
} as const satisfies Partial<
	Record<keyof SocketEventMap, readonly [string, ...string[]]>
>

type ScopePaths = typeof SCOPE_PATHS

/**
 * `true` when every step of `P` is a required, non-null field of `T` and the
 * last one is an id; otherwise a sentence naming the step that is not.
 */
type ScopeAt<T, P extends readonly string[]> = P extends readonly [
	infer Head extends string,
	...infer Rest extends string[]
]
	? Head extends keyof T
		? {} extends Pick<T, Head>
			? `"${Head}" is optional`
			: null extends T[Head]
				? `"${Head}" may be null`
				: undefined extends T[Head]
					? `"${Head}" may be undefined`
					: ScopeAt<T[Head], Rest>
		: `"${Head}" is not on the Response`
	: T extends number | string
		? true
		: "the scope field is not an id"

type ScopeVerdicts = {
	[E in keyof ScopePaths]: ScopeAt<
		SocketEventMap[E]["response"],
		ScopePaths[E]
	>
}

/**
 * THE COMPILE-TIME CHECK. A scope field that is missing, optional or
 * nullable on its Response type makes this line fail `tsc`, with the event
 * and the reason in the error.
 */
type AllScoped<V extends { [E in keyof ScopePaths]: true }> = V
export type LorebookScopedRepliesCarryTheirScope = AllScoped<ScopeVerdicts>

/** Build `{ a: { b: id } }` from `["a", "b"]`. */
function payloadAt(path: readonly string[], id: number): unknown {
	return path.reduceRight<unknown>((inner, key) => ({ [key]: inner }), id)
}

describe("lorebook-family SCOPED replies", () => {
	test("every scoped event of the families has a declared scope path", () => {
		const scoped = [...SCOPED_EVENTS.keys()].filter((event) =>
			LOREBOOK_FAMILIES.some((family) => event.startsWith(family))
		)
		expect(
			scoped.filter((event) => !(event in SCOPE_PATHS)),
			"Add the event to SCOPE_PATHS so tsc checks its Response carries the key"
		).toEqual([])
		// And nothing stale: a path for an event no longer scoped is a check
		// on nothing.
		expect(
			Object.keys(SCOPE_PATHS).filter((event) => !SCOPED_EVENTS.has(event))
		).toEqual([])
	})

	test.each(Object.entries(SCOPE_PATHS))(
		"%s: the extractor reads the declared field",
		(event, path) => {
			expect(scopeOfPayload(event, payloadAt(path, 42))).toBe("42")
		}
	)

	test("the lorebook side never scopes on a field named only in the event", () => {
		// The trap `SCOPED_EVENTS` warns about: `entries:create` names an
		// entry, and a top-level `lorebookId` is NOT where its book rides.
		expect(scopeOfPayload("entries:create", { lorebookId: 42 })).toBeNull()
		expect(
			scopeOfPayload("entries:create", { entry: { lorebookId: 42 } })
		).toBe("42")
	})

	test("a summarize frame from another session is another scope", () => {
		// Two tabs on two sessions each run a summary: each frame names its
		// own session, so neither modal is fed the other's (Phase D).
		expect(
			scopeOfPayload("sessions:summarize:progress", {
				sessionId: 3,
				phase: "drafting"
			})
		).toBe("3")
		expect(
			scopeOfPayload("sessions:summarize:complete", { content: "x" })
		).toBeNull()
	})
})
