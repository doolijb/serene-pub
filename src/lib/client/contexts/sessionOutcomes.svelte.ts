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

/** 🚧 Apply removed play's knowledge ties because a hand tie stands for the pair (D39). */
export function tiesRemovedToast(n: number): { title: string; description: string } {
	return {
		title: n === 1 ? "1 knowledge tie removed" : `${n} knowledge ties removed`,
		description: "Knows or Kept from is set by hand for " + (n === 1 ? "it" : "them") + " in the lorebook."
	}
}

export function createSessionOutcomes(): void {
	useInterest<"sessions:applyOverlay">("sessions:applyOverlay", (msg) => {
		// Nothing at all was waiting: no note applied, no held change applied or left held.
		if (
			!msg?.error &&
			Array.isArray(msg?.applied) &&
			msg.applied.length === 0 &&
			!(
				msg.appliedChanges?.length ||
				msg.stillHeld?.length ||
				msg.appliedLinks?.length ||
				msg.mergedDays?.length ||
				msg.droppedLinks?.length ||
				msg.appliedTies?.length ||
				msg.droppedTies?.length ||
				msg.supersededTies?.length ||
				msg.heldDays?.length
			)
		)
			notify.info({ ...SHARE_NOTHING_PENDING, source: "sessions:applyOverlay" })
		const removed = msg?.supersededTies?.length ?? 0
		if (!msg?.error && removed > 0) notify.info({ ...tiesRemovedToast(removed), source: "sessions:applyOverlay" })
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
