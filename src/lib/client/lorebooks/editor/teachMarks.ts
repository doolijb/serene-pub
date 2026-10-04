/**
 * "Teach it" (the entry editor's retrieval test): **Always read this in**
 * pins the entry, **Never read this in** turns it off — through
 * `entries:setMarks`, the one door for an entry's marks (plan A14). One
 * mark and nothing else: never a whole-entry save, never a re-embed.
 *
 * The write is to the entry itself; the answer is as the picked session
 * reads it (its line, at its clock), so a mark a dated amendment still
 * decides there comes back named (`heldBy`) and is said in the entry
 * editor's own "an amendment still wins" words (`maskedBaseWarning`).
 *
 * Its buttons follow the entry's marks **as that session reads it**
 * (`marksAsRead`, `teachButtons`), never the base row's: under an amendment
 * the two disagree, and a button offering what the session already has
 * would only rewrite the entry for every other reading.
 *
 * **One reply, one ask.** Both answers — the marks write and the reading —
 * reach every tab of the person and depend on the session asked about, so
 * each ask carries a request token the server echoes, and settles only on
 * the answer carrying it.
 */
import type { TypedSocket } from "$lib/client/sockets/typedSocket"
import { awaitReply } from "$lib/client/utils/awaitReply"

type HeldBy = Sockets.Entries.SetMarks.Response["heldBy"]

/** An entry's two marks as one session reads it. */
export interface MarksHere {
	off: boolean
	pinned: boolean
}

let asked = 0
/** A request token unique to this tab and this ask. */
const tokenFor = (what: string) =>
	`teach-${what}:${Math.random().toString(36).slice(2, 10)}:${++asked}`

/** Whether a reply or a refusal carries this token. */
const carries = (reply: unknown, request: string) =>
	(reply as { request?: unknown } | null)?.request === request

/**
 * The sentence for a mark saved to the entry that an amendment still
 * decides where it was asked, or null when nothing holds it. `sessionId`
 * says where: the session's story, or main at its head without one.
 */
export function markHeldLine(heldBy: HeldBy, sessionId: number | null): string | null {
	if (!heldBy) return null
	const mark = heldBy.field === "enabled" ? "off" : "pinned"
	const where = sessionId != null ? "in this session" : "on main"
	return (
		`Saved to the entry, but an amendment dated ${heldBy.label} still decides ` +
		`whether it is ${mark} ${where}. Edit or delete that amendment to change it from then on.`
	)
}

/**
 * Set one mark and wait for this ask's answer: the sentence when an
 * amendment still decides it, and both marks as the session now reads the
 * entry. Rejects with the server's refusal.
 */
export async function teachMark(
	socket: Pick<TypedSocket, "emit">,
	ask: { entryId: number; sessionId: number | null; mark: "off" | "pinned" }
): Promise<{ held: string | null; marks: MarksHere }> {
	const request = tokenFor("mark")
	const res = await awaitReply({
		socket,
		event: "entries:setMarks",
		params: {
			entryId: ask.entryId,
			...(ask.mark === "off" ? { off: true } : { pinned: true }),
			...(ask.sessionId != null ? { sessionId: ask.sessionId } : {}),
			request
		},
		errorEvent: "entries:setMarks:error",
		fallbackError: "The entry's marks could not be saved.",
		match: (reply) => carries(reply, request) && !reply.error,
		matchError: (reply) => carries(reply, request)
	})
	return {
		held: markHeldLine(res.heldBy, ask.sessionId),
		marks: { off: res.off === true, pinned: res.pinned === true }
	}
}

/**
 * The entry's marks as one session reads it — its line, at its clock — off
 * the lore widget's own read (`entries:sessionEntries`, narrowed to the
 * entry). Null when the session does not read the entry at all (archived
 * there, off its line, dated past its clock) or the book is not the
 * asker's. Rejects with the server's refusal.
 */
export async function marksAsRead(
	socket: Pick<TypedSocket, "emit">,
	ask: { entryId: number; sessionId: number }
): Promise<MarksHere | null> {
	const request = tokenFor("read")
	const res = await awaitReply({
		socket,
		event: "entries:sessionEntries",
		params: { sessionId: ask.sessionId, entryIds: [ask.entryId], limit: 1, request },
		errorEvent: "entries:sessionEntries:error",
		fallbackError: "The session's lore could not be read.",
		match: (reply) => carries(reply, request),
		matchError: (reply) => carries(reply, request)
	})
	if (res.error) throw new Error(res.error)
	const row = res.ownerOnly ? undefined : res.rows.find((r) => r.id === ask.entryId)
	return row ? { off: row.off, pinned: row.pinned } : null
}

/** One Teach it button: whether it is held back, and its tooltip. */
export interface TeachButton {
	disabled: boolean
	title: string
}

/**
 * Teach it's two buttons, from the marks as the session reads the entry.
 * Unknown (not read yet, or the session does not read the entry): neither
 * is held back — the base row is not what the session reads.
 */
export function teachButtons(here: MarksHere | null | undefined): { pin: TeachButton; off: TeachButton } {
	return {
		pin: here?.pinned
			? { disabled: true, title: "Already pinned in this session" }
			: { disabled: false, title: "Pin it, so every turn reads it in" },
		off: here?.off
			? { disabled: true, title: "Already off in this session" }
			: { disabled: false, title: "Switch it off, so no turn reads it in" }
	}
}
