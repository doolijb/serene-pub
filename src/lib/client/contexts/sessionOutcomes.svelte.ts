/**
 * 🚧 The session-outcomes context (pr-6s2): the ONE place two owner verbs' results are said — Share to ‹book› with nothing
 * waiting, and Close out started (also the catch-up offer's press). Views never toast these. Provided by both shells
 * (Layout.svelte, AccessibleShell.svelte) at init; it only subscribes. Errors stay Layout's catch-all's.
 */
import { useInterest } from "$lib/client/sockets/interest.svelte"
import { notify } from "$lib/client/utils/notify"

/** 🚧 Share to ‹book› found nothing waiting (`sessions:applyOverlay` answered `applied: []`). */
export const SHARE_NOTHING_PENDING = Object.freeze({
	title: "Nothing to share",
	description: "This session's notes hold no changes waiting for the lorebook."
})

/** 🚧 Close out started (`sessions:closeOut` answered its `sceneIds`): what it filed, held for review. */
export function closeOutToast(scenes: number): { title: string; description: string } {
	return {
		title: "Closed out",
		description:
			scenes === 1
				? "One closing scene is being summarized for you to review."
				: `${scenes} closing scenes are being summarized for you to review.`
	}
}

export function createSessionOutcomes(): void {
	useInterest<"sessions:applyOverlay">("sessions:applyOverlay", (msg) => {
		if (!msg?.error && Array.isArray(msg?.applied) && msg.applied.length === 0)
			notify.info({ ...SHARE_NOTHING_PENDING, source: "sessions:applyOverlay" })
	})
	useInterest<"sessions:closeOut">("sessions:closeOut", (msg) => {
		const n = msg?.sceneIds?.length ?? 0
		if (!msg?.error && n > 0)
			notify.success({ ...closeOutToast(n), source: "sessions:closeOut" })
	})
}

export function provideSessionOutcomes(): void {
	createSessionOutcomes()
}
