/**
 * The toast a scene save or a session delete shows (plan A18). Both record
 * the session onto the world's timeline, and the lorebook may leave a value
 * out — a story time its calendar cannot place, a slot it retired. The
 * reply's `notRecorded` names each, led by whose it was; nothing left out is
 * the action's plain success. Never an error: the scene is saved, the
 * session deleted, whatever the timeline took.
 */
export function notRecordedToast(
	done: string,
	notRecorded: readonly string[] | undefined
): { kind: "success" | "warning"; title: string; description?: string } {
	if (!notRecorded?.length) return { kind: "success", title: done }
	const one = notRecorded.length === 1
	const shown = notRecorded.slice(0, 3)
	const rest = notRecorded.length - shown.length
	return {
		kind: "warning",
		title: one
			? `${done}, but a value wasn't recorded`
			: `${done}, but ${notRecorded.length} values weren't recorded`,
		description:
			`The lorebook's timeline didn't take ${one ? "it" : "them"}: ` +
			shown.join(" ") +
			(rest ? ` And ${rest} more.` : "")
	}
}
