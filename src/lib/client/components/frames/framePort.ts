/**
 * The host's DECISIONS for frame protocol 2 — the paging, the saved view
 * state, and the two replies they produce — with no DOM in them.
 *
 * `PluginFrame.svelte` owns the iframe, the `MessageChannel` and the chrome;
 * what it *decides* lives out here, for the same reason `framePlacement.ts`
 * does: a `.svelte` file cannot be imported as data, so a
 * rule that only existed inside one could only be checked by driving a
 * browser, which is the same as not being checked.
 *
 * ## The twin
 *
 * The SDK's preview harness answers the very same three messages in
 * `serene-pub-sdk/ui-preview/src/lib/framePort.ts` — deliberately DOM-free so
 * core could share it. It is **not exported from a package entry the app can
 * resolve**: `@serene-pub/ui-preview` exports only `./server`, and
 * `@serene-pub/sdk` only `.`, `./testing` and `./tokenizers`. So the
 * decisions are MIRRORED here rather than imported, and the constants below
 * carry the harness's numbers on purpose — an author who paged against the
 * harness must get the same page out of an instance, or the harness has
 * taught them a lie. If either side moves, move both; if the SDK ever exports
 * this module, delete this one and import it.
 *
 * What is NOT mirrored is the scoping: the harness tests a lane with
 * `String(m.channel ?? 'main')`, and the app has one matcher for that
 * (`channelMatcher`, ruled 2026-09-09: a bare slug is the whole channel,
 * every lane under it). A page cut by any other rule would disagree with the
 * `channel` posts the very same panel already received, which is the one bug
 * a widget author cannot fix.
 *
 * ## What the protocol promises, and what it does not
 *
 * A v2 host may DECLINE any of `error`, `request` and `save-state` and still
 * be a v2 host: a request is not a grant, saved state may be capped or
 * dropped, and an error may go no further than a log. What follows is what
 * *this* host chooses to do, never what a frame may rely on — and the cursor's
 * spelling is this host's, opaque by contract. A frame reads `nextCursor` and
 * hands it back; it never parses one.
 */
import { FRAME_PROTOCOL, type HostFrameMessage } from "@serene-pub/sdk"
import { channelMatcher, type SurfaceMessage } from "$lib/shared/widgets/context"

/** The rows this host pages over — the messages as the mount site holds them. */
export type FrameRow = SurfaceMessage

/** What a page request is answered from: what the panel already holds. */
export interface FramePortSource {
	messages: FrameRow[]
	/** The lanes this surface declared, when it declared any (a panel's scoping). */
	channels?: string[]
}

/** The default page a `request` gets when it asks for no size. */
export const FRAME_PAGE_DEFAULT = 50
/** The most rows one page may carry, whatever a frame asks for. */
export const FRAME_PAGE_MAX = 200
/**
 * The most view state this host will hold for a surface. `save-state` is not
 * storage — the declaration says the host may cap or drop it — so it does,
 * loudly, rather than quietly becoming a database a surface comes to rely on.
 */
export const FRAME_STATE_MAX_BYTES = 16 * 1024

/** The host's messages, named off the protocol's union rather than restated. */
export type FrameInitMessage = Extract<HostFrameMessage, { t: "init" }>
export type FramePageMessage = Extract<HostFrameMessage, { t: "page" }>
export type FrameStateMessage = Extract<HostFrameMessage, { t: "state" }>

// ── Paging ──────────────────────────────────────────────────────────────────

/** An offset cursor. Opaque to the frame by contract; this is the host's spelling. */
const CURSOR = /^o:([0-9]+)$/

/** What one `request` produced: a page, or the reason it was declined. */
export interface FramePage {
	rows: FrameRow[]
	nextCursor?: string
	/** Set instead of a page — the frame gets nothing, the host logs this. */
	refused?: string
}

/**
 * One page of a channel's messages, cut from what the mount site already holds.
 *
 * Scoped before it is cut: a panel that declared lanes is answered out of those
 * lanes only, by the same matcher that decided which messages it was pushed, so
 * a frame can never page its way to a lane it was not given. A request naming a
 * channel the surface did not declare is DECLINED rather than answered with an
 * empty page — an empty page says "that lane is empty", which is a different
 * and false thing to tell a frame about somebody else's conversation.
 */
export function pageOf(
	source: FramePortSource,
	req: { channel?: string; cursor?: string; limit?: number }
): FramePage {
	const declared = source.channels ?? []
	if (
		req.channel !== undefined &&
		declared.length &&
		!channelMatcher(declared)(req.channel)
	)
		return {
			rows: [],
			refused: `'${req.channel}' is not a lane this surface declared`
		}
	const lanes = req.channel !== undefined ? [req.channel] : declared
	// `channelMatcher([])` matches everything, which is exactly the rule for an
	// undeclared surface (a session-view frame sees the whole log) — so the one
	// matcher covers both arms and there is no second spelling of "every lane".
	const matches = channelMatcher(lanes)
	const rows = source.messages.filter((m) => matches(m?.channel))

	let start = 0
	if (req.cursor !== undefined) {
		const m = CURSOR.exec(String(req.cursor))
		if (!m)
			return {
				rows: [],
				refused: `cursor '${req.cursor}' is not one this host issued`
			}
		start = Number(m[1])
	}
	const want = Math.floor(Number(req.limit))
	const limit = Math.max(
		1,
		Math.min(
			FRAME_PAGE_MAX,
			Number.isFinite(want) && want > 0 ? want : FRAME_PAGE_DEFAULT
		)
	)
	const slice = rows.slice(start, start + limit)
	return start + limit < rows.length
		? { rows: slice, nextCursor: `o:${start + limit}` }
		: { rows: slice }
}

// ── Saved view state ────────────────────────────────────────────────────────

/** What the host did with one `save-state`. */
export interface FrameStateOutcome {
	kept: boolean
	reason?: string
	bytes: number
}

export interface FrameStateStore {
	get(key: string): Record<string, unknown> | undefined
	/** Returns what the host did: kept it, or dropped it and why. */
	set(key: string, state: unknown): FrameStateOutcome
	clear(key?: string): void
}

export function frameStateStore(): FrameStateStore {
	const held = new Map<string, Record<string, unknown>>()
	return {
		get: (key) => held.get(key),
		set: (key, state) => {
			if (!state || typeof state !== "object" || Array.isArray(state))
				return {
					kept: false,
					reason: "state is an object of small values",
					bytes: 0
				}
			let json: string
			try {
				json = JSON.stringify(state)
			} catch {
				return {
					kept: false,
					reason: "state must be JSON a host can store",
					bytes: 0
				}
			}
			const bytes = new TextEncoder().encode(json).length
			if (bytes > FRAME_STATE_MAX_BYTES)
				return {
					kept: false,
					bytes,
					reason: `state is ${bytes} bytes, over the host's ${FRAME_STATE_MAX_BYTES} — the host may cap or drop it`
				}
			// Re-parsed, never the frame's own object: what is held has to be a
			// detached plain copy, or a later mutation on either side would
			// silently disagree with what was saved.
			held.set(key, JSON.parse(json) as Record<string, unknown>)
			return { kept: true, bytes }
		},
		clear: (key) => {
			if (key === undefined) held.clear()
			else held.delete(key)
		}
	}
}

/**
 * The app's store, module-level on purpose: a surface's state has to survive
 * the remount that a document reload is — which is the whole point of
 * `save-state` — and a store owned by the component would die with it.
 *
 * MEMORY, not `localStorage`: it survives an iframe reload, a panel being
 * suspended and woken, and a navigation within the app, which is the span
 * `save-state` exists for. A full page reload drops it, and that is the
 * declared behaviour rather than a regression — a frame must already tolerate
 * `state` never arriving.
 */
export const savedFrameState: FrameStateStore = frameStateStore()

/**
 * What saved state is keyed on: the session it belongs to and the surface
 * within it. Both, because the same panel in two sessions is two views — a
 * scroll offset or an open tab from another session is worse than none — and
 * because a frame surface is not always a panel, so the key has to survive a
 * page or session-view frame that has no panel id.
 */
export const frameStateKey = (
	sessionId: number | null | undefined,
	surfaceId: string
): string => `${sessionId ?? "-"}:${surfaceId}`

// ── The host's replies ──────────────────────────────────────────────────────

/**
 * `init`, as a protocol-2 host sends it.
 *
 * `FRAME_PROTOCOL`, never a literal: the number a frame reads to know which
 * members of the union it may use has exactly one home, and it is the same
 * package the frame's author compiled against.
 */
export const initMessage = (
	surface: FrameInitMessage["surface"]
): FrameInitMessage => ({ t: "init", protocol: FRAME_PROTOCOL, surface })

/** The `page` reply to a `request`, echoing the frame's own `requestId`. */
export const buildPageMessage = (
	requestId: string,
	page: FramePage
): FramePageMessage => ({
	t: "page",
	requestId,
	rows: page.rows,
	...(page.nextCursor ? { nextCursor: page.nextCursor } : {})
})

/** The `state` reply — what this surface last saved, returned on mount. */
export const buildStateMessage = (
	state: Record<string, unknown>
): FrameStateMessage => ({ t: "state", state })
