/**
 * What the indexing notice in the composer's footer (`RagNotice.svelte`) says
 * and offers, pure so it is tested (`ragNotice.test.ts`) apart from the
 * sockets the component speaks.
 *
 * The vocabulary is NOMENCLATURE §11's (less-confusing H1): the feature is
 * **Search by meaning**, a lorebook entry is **indexed**, **not indexed yet**
 * or **needs re-indexing**, and **Embeddings** names only the connection job
 * that does the indexing. The notice never says vectors, embedded or RAG.
 *
 * What it counts is the session lorebook's entries and nothing else: the one
 * thing Search by meaning searches (`SEMANTIC_SEARCH_SOURCES`).
 *
 * It speaks only of what a viewer can act on. Progress (some entries indexed,
 * the rest on their way) lives in Activity (`lorebook_indexing`), not here
 * (playtest 2, 2026-11-04, §0-C).
 */

/** The lorebook's entries, split by index state, as the server counts them. */
export interface RagNoticeCounts {
	total: number
	/** Entries with no index at all. */
	nullCount: number
	/** Entries indexed by a model other than the current one. */
	staleCount: number
	readyCount: number
}

/**
 *   "none"       — no entry is indexed yet
 *   "stale"      — every entry that is indexed needs re-indexing, and none is missing
 */
export type RagNoticeVariant = "none" | "stale"

/**
 * What the notice has to say about these counts; null when every entry is
 * indexed, and null part way (some indexed, the rest on their way): that is
 * progress, and Activity shows it.
 */
export function ragNoticeVariant(
	counts: RagNoticeCounts | null | undefined
): RagNoticeVariant | null {
	if (!counts) return null
	const { total, nullCount, staleCount, readyCount } = counts
	if (total === 0) return null
	if (readyCount === total) return null
	if (staleCount > 0 && nullCount === 0) return "stale"
	if (nullCount === total) return "none"
	return null
}

/** The notice's sentence for a variant. */
export function ragNoticeSentence(
	variant: RagNoticeVariant,
	facts: {
		modelName: string | null | undefined
	}
): string {
	switch (variant) {
		case "none":
			return "Lorebook entries aren't indexed yet, so Search by meaning can't find them."
		case "stale":
			return `Lorebook entries were indexed with a different model and need re-indexing with ${facts.modelName || "the current model"}.`
	}
}

/** Where the notice sends an administrator to set up Search by meaning. */
export const SEARCH_BY_MEANING_SETUP_HREF = "/admin/defaults"

/**
 * One press the notice offers.
 *
 * `queue` puts the session at the front of the indexing queue and starts it
 * (`vectorization:addToQueue`), which is also how stale entries are re-indexed:
 * the queue re-embeds any entry whose index another model made. `link` goes to
 * Admin › Models › Defaults, where the Embeddings job is chosen.
 */
export type RagNoticeAction =
	| { kind: "queue"; label: string; title: string }
	| { kind: "link"; label: string; href: string; title: string }

/**
 * What the notice offers for a variant. Every one of these is an
 * administrator's: the server refuses `vectorization:addToQueue` to anyone
 * else, and Admin is theirs alone, so a member gets the sentence and nothing
 * to press but Hide.
 */
export function ragNoticeActions(
	variant: RagNoticeVariant,
	isAdmin: boolean
): RagNoticeAction[] {
	if (!isAdmin) return []
	const prioritize: RagNoticeAction = {
		kind: "queue",
		label: "Prioritize in queue",
		title: "Move this session to the front of the indexing queue"
	}
	switch (variant) {
		case "stale":
			return [
				{
					kind: "queue",
					label: "Re-index now",
					title: "Re-index this session's lorebook entries with the current model, ahead of anything else waiting"
				}
			]
		case "none":
			return [
				prioritize,
				{
					kind: "link",
					label: "Set up search by meaning",
					href: SEARCH_BY_MEANING_SETUP_HREF,
					title: "Fill the Embeddings loadout in Admin › Models › Loadouts"
				}
			]
	}
}

/**
 * Where this device keeps the sessions whose notice it has shown: the line
 * shows the first time a session needs it, and an icon in the composer's
 * footer stands for it after that (polish parity L1, 2026-10-24). A per-viewer
 * convenience, never shared and never relied on: a storage that fails or
 * forgets just shows the line again.
 */
export const RETRIEVAL_NOTICE_READ_KEY = "serene-pub:retrievalNoticeRead"

/** How many sessions the list remembers; the oldest go first. */
const NOTICE_READ_KEEP = 200

type NoticeStore = Pick<Storage, "getItem" | "setItem">

function deviceStore(): NoticeStore | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage
	} catch {
		return null
	}
}

function readIds(store: NoticeStore): number[] {
	const raw = store.getItem(RETRIEVAL_NOTICE_READ_KEY)
	const parsed: unknown = raw ? JSON.parse(raw) : []
	return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === "number") : []
}

/** Has this device shown the notice for this session before? */
export function noticeRead(sessionId: number, store: NoticeStore | null = deviceStore()): boolean {
	try {
		return !!store && readIds(store).includes(sessionId)
	} catch {
		return false
	}
}

/** Remember that this device has shown the notice for this session. */
export function markNoticeRead(sessionId: number, store: NoticeStore | null = deviceStore()): void {
	try {
		if (!store) return
		const ids = readIds(store).filter((n) => n !== sessionId)
		ids.push(sessionId)
		store.setItem(RETRIEVAL_NOTICE_READ_KEY, JSON.stringify(ids.slice(-NOTICE_READ_KEEP)))
	} catch {
		// A convenience: the line shows again next time.
	}
}

/** The trailing-throttle window of `statusAsker().soon()`, in milliseconds. */
export const STATUS_ASK_THROTTLE_MS = 500

/**
 * How the notice asks the server for its status: one ask in flight at a time.
 *
 * The server answers each ask with one reply, and replies are not matched to
 * asks, so with several asks out the first reply to land would stand for all
 * of them and an older figure could be the last word. Here a trigger that
 * arrives while an ask is out only marks the answer stale; when the reply
 * lands, exactly one more ask goes out. `soon()` is for noisy triggers (a
 * count that moves per entry): a trailing throttle that ends in `now()`.
 */
export function statusAsker(
	send: () => void,
	opts: {
		throttleMs?: number
		setTimer?: (fn: () => void, ms: number) => unknown
		clearTimer?: (timer: unknown) => void
	} = {}
) {
	const throttleMs = opts.throttleMs ?? STATUS_ASK_THROTTLE_MS
	const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
	const clearTimer =
		opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>))
	let inFlight = false
	let dirty = false
	let timer: unknown = null

	function now() {
		if (inFlight) {
			dirty = true
			return
		}
		inFlight = true
		send()
	}

	function soon() {
		if (timer !== null) return
		timer = setTimer(() => {
			timer = null
			now()
		}, throttleMs)
	}

	/** Call on every reply. */
	function answered() {
		inFlight = false
		if (dirty) {
			dirty = false
			now()
		}
	}

	/** Forget the ask in flight and any stale mark; sends nothing. */
	function reset() {
		inFlight = false
		dirty = false
		if (timer !== null) {
			clearTimer(timer)
			timer = null
		}
	}

	return { now, soon, answered, reset, dispose: reset }
}
