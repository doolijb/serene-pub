/**
 * The page's **waiting rows**, kept live (`pendingReply.ts` says what one is
 * and when it is drawn): this session's reply runs in flight, heard off
 * `sessions:runStatus`, and the runs whose own row has been seen generating
 * (`opened` — never drawn again, whatever they do after). The session page
 * hands it every `sessions:runStatus` frame (`hear`) and reads `rows`.
 */
import { untrack } from "svelte"
import { SvelteMap, SvelteSet } from "svelte/reactivity"
import {
	openedReplyRuns,
	pendingReplyRows,
	type PendingReplyRowLike,
	type ReplyRunStatus
} from "$lib/client/components/sessionPage/pendingReply"

/** One `sessions:runStatus` frame, as far as a waiting row reads it. */
export interface RunStatusFrameLike {
	sessionId: number
	runId: string
	status: ReplyRunStatus["status"] | null
	reply?: { channel: string }
}

export function createPendingReplies(opts: {
	/** The session on screen. */
	sessionId: () => number
	/** Its rows, as loaded — undefined while it loads. */
	rows: () => readonly PendingReplyRowLike[] | undefined
}) {
	const runs = new SvelteMap<string, ReplyRunStatus>()
	const opened = new SvelteSet<string>()
	const inFlight = $derived([...runs.values()])

	// Another session: none of its runs are this one's. (Not on the first
	// run — a frame heard before the effects settle is this session's.)
	let shown = untrack(opts.sessionId)
	$effect(() => {
		const id = opts.sessionId()
		if (id === shown) return
		shown = id
		untrack(() => {
			runs.clear()
			opened.clear()
		})
	})
	// A run whose row is generating has opened it, for good.
	$effect(() => {
		const rows = opts.rows() ?? []
		for (const id of openedReplyRuns(inFlight, rows))
			if (!untrack(() => opened.has(id))) opened.add(id)
	})

	const rows = $derived.by(() => {
		const loaded = opts.rows()
		return loaded
			? pendingReplyRows(opts.sessionId(), inFlight, loaded, opened)
			: []
	})

	return {
		/** The waiting rows to draw after the session's own. */
		get rows() {
			return rows
		},
		/** A `sessions:runStatus` frame: a reply's status, or a run's end. */
		hear(msg: RunStatusFrameLike) {
			if (msg.sessionId !== opts.sessionId()) return
			if (!msg.status) {
				runs.delete(msg.runId)
				opened.delete(msg.runId)
				return
			}
			if (!msg.reply) return
			runs.set(msg.runId, {
				runId: msg.runId,
				status: msg.status,
				channel: msg.reply.channel
			})
		}
	}
}
