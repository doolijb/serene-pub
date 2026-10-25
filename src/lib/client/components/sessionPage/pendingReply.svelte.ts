/**
 * The page's **waiting rows**, kept live (`pendingReply.ts` says what one is
 * and when it is drawn): this session's reply runs in flight, read from the
 * session store's runs (`sessions:runStatus` frames, which the store keeps),
 * and the runs whose own row has been seen generating (`opened` — never drawn
 * again, whatever they do after). The session page hands it no frames: the
 * store holds them, and the page reads `rows`.
 */
import { untrack } from "svelte"
import { SvelteSet } from "svelte/reactivity"
import {
	openedReplyRuns,
	pendingReplyRows,
	type PendingReplyRowLike,
	type ReplyRunStatus
} from "$lib/client/components/sessionPage/pendingReply"
import type { SessionRunRecord } from "$lib/client/sessions/store/records"

export function createPendingReplies(opts: {
	/** The session on screen. */
	sessionId: () => number
	/** Its rows, as loaded — undefined while it loads. */
	rows: () => readonly PendingReplyRowLike[] | undefined
	/** 🚧 The session's runs in flight, as the session store holds them (`sessionStore.runsOf`), in the order first heard. */
	runs: () => readonly SessionRunRecord[]
}) {
	const opened = new SvelteSet<string>()
	const inFlight: ReplyRunStatus[] = $derived(
		opts
			.runs()
			.filter((r) => r.reply != null)
			.map((r) => ({ runId: r.runId, status: r.status, channel: r.reply!.channel }))
	)

	// Another session: none of its runs are this one's. (Not on the first
	// run — a frame heard before the effects settle is this session's.)
	let shown = untrack(opts.sessionId)
	$effect(() => {
		const id = opts.sessionId()
		if (id === shown) return
		shown = id
		untrack(() => opened.clear())
	})
	// A run whose row is generating has opened it, for good. A run that has
	// left the store (its end frame) is forgotten.
	$effect(() => {
		const rows = opts.rows() ?? []
		for (const id of openedReplyRuns(inFlight, rows))
			if (!untrack(() => opened.has(id))) opened.add(id)
		for (const id of untrack(() => [...opened]))
			if (!inFlight.some((r) => r.runId === id)) opened.delete(id)
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
		}
	}
}
