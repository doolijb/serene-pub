/**
 * The session list rows, kept current between lists by `sessions:rowChanged`.
 *
 * `sessions:list` is the app's widest read, and a session card quotes two
 * things that move constantly — how many messages the session holds and its
 * last visible line. Rather than re-list on every message, the server pushes
 * the moved row (`server/sessions/rowPush.ts`) and this layers it over
 * whatever the last list said, exactly as `SessionsSidebar` layers
 * `sessions:runStatus` over the list's `runStatus`.
 *
 * ONE store for every surface that shows a card — the sidebar, the session
 * detail panel, the home page's "continue" row — because they are all quoting
 * the same rows and a push is addressed to the session, not to a view. Each
 * clears it when its own fresh list arrives, on the same reasoning the run
 * statuses clear: a list is the server's current answer for every row, and
 * what this map heard before it is older than that.
 *
 * `SvelteMap`, not a `Map` in `$state` — mutation is what changes here.
 */

import { SvelteMap } from "svelte/reactivity"

/** What a push says about one row. */
export interface RowPatch {
	messageCount: number
	/** `null` is an answer: the row has no visible line to quote now. */
	lastMessage: Sockets.Sessions.List.LastMessage | null
	updatedAt: string
}

/** The shape every surface's row satisfies — the list's own. */
type ListRow = Sockets.Sessions.List.Response["sessionList"][number]

/** Session id → the newest push for it. Empty between lists. */
export const sessionRowPatches = new SvelteMap<number, RowPatch>()

/**
 * Take a push in.
 *
 * Last one wins: a push carries the row's whole state as of the read behind
 * it, never a delta, so there is nothing to merge across two of them.
 */
export function applyRowChanged(
	payload: Sockets.Sessions.RowChanged.Response | undefined | null
): void {
	if (!payload || typeof payload.sessionId !== "number") return
	sessionRowPatches.set(payload.sessionId, {
		messageCount: payload.messageCount,
		lastMessage: payload.lastMessage ?? null,
		updatedAt: payload.updatedAt
	})
}

/** Forget every push. What a fresh `sessions:list` supersedes. */
export function clearRowPatches(): void {
	sessionRowPatches.clear()
}

/**
 * A list row as the pushes since that list say it now reads.
 *
 * The SAME object back when nothing has been heard about this session, so a
 * keyed `{#each}` and any identity comparison over an unpatched list are
 * untouched by this store existing.
 *
 * A null `lastMessage` REMOVES the field rather than setting it to null: the
 * list omits it on a session with nothing to show, and every consumer reads
 * `lastMessage ?` as "has a line". A deleted or hidden last message has to
 * leave the row in that same state.
 */
export function patchedRow<T extends ListRow>(row: T): T {
	const id = row?.id
	if (typeof id !== "number") return row
	const patch = sessionRowPatches.get(id)
	if (!patch) return row
	// Built in one expression rather than mutated afterwards, so the absent
	// field is absent the same way the server's row makes it absent.
	const { lastMessage: _replaced, ...rest } = row
	return {
		...rest,
		messageCount: patch.messageCount,
		updatedAt: patch.updatedAt,
		...(patch.lastMessage ? { lastMessage: patch.lastMessage } : {})
	} as T
}
