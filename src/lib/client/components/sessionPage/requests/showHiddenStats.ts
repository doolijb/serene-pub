/**
 * 🚧 `show-hidden-stats` (*Show hidden stats*): core's Stats widget switches the viewer
 * reading the holder-only values of an AI character seat they seated. The page
 * tells the session state store (`setShowingHiddenStats`), which re-reads the state
 * naming the seats; the values arrive on the next `session_state` push, never
 * in the reply. The server keeps only the seats the viewer seated, so a seat
 * that is not theirs shows nothing. Core's widgets only (the askers table).
 */
import type { WidgetRequests } from "@serene-pub/sdk"

type Params = WidgetRequests["show-hidden-stats"]["params"]

/** The page's write: the store's `setShowingHiddenStats`. */
export type ShowHiddenStatsWrite = (ref: string, on: boolean) => void

/** Answer one `show-hidden-stats`. Rejects, in words. */
export async function answerShowHiddenStats(
	params: unknown,
	set: ShowHiddenStatsWrite
): Promise<void> {
	const p = (params ?? {}) as Partial<Record<keyof Params, unknown>>
	const owner = p.owner as { kind?: unknown; id?: unknown } | undefined
	if (!owner || typeof owner !== "object" || owner.kind !== "seated_member")
		throw new Error("show-hidden-stats needs an AI character seat as its owner")
	if (
		typeof owner.id !== "number" ||
		!Number.isInteger(owner.id) ||
		owner.id <= 0
	)
		throw new Error("show-hidden-stats needs the seat's id")
	if (typeof p.on !== "boolean")
		throw new Error("show-hidden-stats takes on: true or false")
	set(`seated-member:${owner.id}`, p.on)
}
