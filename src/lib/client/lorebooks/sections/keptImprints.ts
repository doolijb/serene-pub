/**
 * 🚧 **What a replaced reply wrote that stayed** (RF fix 4, 2026-10-23): the
 * words of an entry's note and its two buttons.
 *
 * A swipe, a regenerate or a delete takes back what the replaced reply wrote
 * on the lorebook — unless someone changed it since, and then it stays and
 * the entry says so (`LorebookEntry.keptImprints`). **Revert** puts back what
 * the field held before that reply (an entry the reply added is removed);
 * **Keep** keeps it. The server re-sends the book's list, so the note leaves
 * the row once either is pressed.
 */
import type { TypedSocket } from "$lib/client/sockets/typedSocket"
import { awaitReply } from "$lib/client/utils/awaitReply"
import type { KeptImprint } from "$lib/shared/entries/types"

/** The note's heading, on the entry and as the list mark's title. */
export const KEPT_IMPRINT_HEADING = "Written by a reply that was since replaced"

/** Why it is still here, in a sentence. */
export const KEPT_IMPRINT_WHY = "It was changed after that reply, so it was left as it is."

/** A value as a person reads it: words in quotes, nothing as "nothing". */
export function keptValueWords(v: unknown): string {
	if (v === undefined || v === null || v === "") return "nothing"
	if (typeof v === "string") return `“${v.length > 80 ? `${v.slice(0, 79).trimEnd()}…` : v}”`
	if (typeof v === "number" || typeof v === "boolean") return String(v)
	const json = JSON.stringify(v)
	return json.length > 80 ? `${json.slice(0, 79)}…` : json
}

/** One kept write, said: what the reply set, and what Revert does. */
export function keptImprintLine(k: KeptImprint): string {
	if (k.field === null) return "The reply added this entry. Revert removes it."
	const label = k.label ?? k.field
	const back =
		k.before === undefined || k.before === null || k.before === ""
			? "Revert clears it."
			: `Revert puts back ${keptValueWords(k.before)}.`
	return `${label}: the reply set ${keptValueWords(k.after)}. ${back}`
}

/** Revert or keep one kept write, and wait for this ask's answer. Rejects with the server's sentence. */
export async function settleImprint(
	socket: Pick<TypedSocket, "emit">,
	ask: { imprintId: number; choice: "revert" | "keep" }
): Promise<void> {
	await awaitReply({
		socket,
		event: "lorebooks:settleImprint",
		params: ask,
		errorEvent: "lorebooks:settleImprint:error",
		fallbackError: "The change could not be settled.",
		match: (reply) => reply.imprintId === ask.imprintId,
		matchError: (reply) => (reply as { imprintId?: unknown } | null)?.imprintId === ask.imprintId
	})
}
