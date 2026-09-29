/**
 * Firing a prepared turn (PLAN-turn-order §4.6, R3): the **one** door
 * through which a reply starts.
 *
 * Turn order is state (§3): `core:spec/<genre>-turn-order` writes the prepared
 * turns, and nothing about that write starts anything. What starts a reply
 * is a *fire* — a person pressing Continue, a person picking somebody, or
 * the auto-advance listener acting on a `turn-order-changed` event whose
 * cause allows it. Each one dispatches the entry's subject with the entry's
 * ref as the explicit pick, and the run decides nothing about whose turn
 * it is.
 *
 * ## What is not fired, and why
 *
 * - **A person's entry.** A persona appears in the order — that is how a
 *   session says it is your turn (R15) — and generating it would put words
 *   in somebody's mouth. `{ fired: false, reason: 'person' }`; the UI
 *   renders it as "<name>'s turn" with no Continue.
 * - **An action the person may not use.** An entry may name an action id
 *   as its `subject`; the same enabled-when gate the Actions list runs is
 *   asked before firing, so a strategy cannot route around a gate.
 * - **A subject core does not know.** Refused by name rather than guessed
 *   at, because a typo that silently became a respond turn would be a
 *   pipeline appearing to work.
 *
 * ## The trigger decides nothing (§3)
 *
 * The loop this replaced read the session's strategy, asked whether it
 * "never decides", previewed who was due, and looped until a halt said
 * nobody was. All of that lived in a socket handler, which meant the answer
 * to "why did nobody reply" was in three places. Here there is one: the
 * order says who, and firing is a dispatch.
 */

import { readTurnOrder, type TurnEntryV1 } from "@serene-pub/sdk"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { SessionIo } from "$lib/server/pipelines/runtime/liveRow"
import type { RunLineage } from "$lib/server/pipelines/runtime/lineage"
import type { EventCause } from "@serene-pub/sdk"

export interface FireTurnResult {
	fired: boolean
	runId?: string
	/** Why not, when it was not — one of the reasons named in §4.6. */
	reason?: string
}

/** The default subject: an ordinary reply. */
const RESPOND = "core:event/message-respond@1"

/**
 * The head of a session's stored order, or null when nothing is prepared.
 * The one read every caller shares, so "the head" cannot come to mean two
 * different rows.
 */
export async function headTurnEntry(
	db: Db,
	sessionId: number
): Promise<TurnEntryV1 | null> {
	const [row] = await db
		.select({ metadata: schema.sessions.metadata })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!row) return null
	return readTurnOrder(row.metadata).order[0] ?? null
}

/**
 * The **carry-on** entry (lair pass B9, owner ruling D3 2026-09-27): what an
 * owner's Continue fires when nothing is prepared, or `null` when the
 * session's genre has no narrator to carry on.
 *
 * A narrator genre (`voice: 'narrator'`) prepares its one entry only when
 * a person's line is newest, so after the narrator's own reply the order is
 * empty by design — and "always keep a narrator prepared" was ruled out,
 * because auto-advance would then loop to its cap. The press is the one
 * thing that may ask the narrator to go on with no new direction. This only
 * NAMES the entry; the socket handler decides who may press it.
 */
export async function carryOnEntry(
	db: Db,
	sessionId: number
): Promise<TurnEntryV1 | null> {
	const [session] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return null
	const { getSessionGenre, STANDARD_GENRE_ID } = await import(
		"$lib/server/pipelines/entities/sessionGenres"
	)
	const genre = await getSessionGenre(
		db,
		session.genreId ?? STANDARD_GENRE_ID
	)
	const voice = (genre?.shape as { voice?: unknown } | undefined)?.voice
	return voice === "narrator" ? { ref: null, via: "pick" } : null
}

/**
 * Is this entry a person's — shown as their turn, never generated (R15)?
 *
 * A persona is a character row flagged `is_persona` (0132), so the
 * reference is `character:<id>` and the discriminator is the row (PLAN §8
 * (8)). Checked against the session's own personas rather than the
 * character's flag alone: a character who is somebody's presence *here* is
 * a person here, and the same card in another session is not.
 */
export async function entryIsPersons(
	db: Db,
	sessionId: number,
	entry: TurnEntryV1
): Promise<boolean> {
	const ref = entry.ref
	if (typeof ref !== "string") return false
	if (ref.startsWith("user:")) return true
	if (!ref.startsWith("character:")) return false
	const id = Number(ref.slice("character:".length))
	if (!Number.isInteger(id)) return false
	const rows = await db
		.select({
			personaId: schema.sessionPersonas.personaId,
			removedAt: schema.sessionPersonas.removedAt
		})
		.from(schema.sessionPersonas)
		.where(eq(schema.sessionPersonas.sessionId, sessionId))
	return rows.some((r) => r.personaId === id && !r.removedAt)
}

/**
 * Fire one prepared turn (§4.6).
 *
 * `cause` is the fire's own — `{ kind: 'user', userId }` for a press,
 * `{ kind: 'run', runId, auto: true }` for auto-advance — and it travels
 * onto the run so every write the run makes carries it. That is what lets
 * the next recompute's `turn-order-changed` say whether the run it answers
 * was fired automatically, which is the whole of `round`'s continuation
 * rule.
 */
export async function fireTurnEntry(
	db: Db,
	opts: {
		sessionId: number
		userId: number
		entry: TurnEntryV1
		cause: EventCause
		io?: SessionIo
		lineage?: RunLineage
		/** The socket the reply road announces through, when a press has one. */
		socket?: unknown
		emitToUser?: (event: string, data: unknown) => void
	}
): Promise<FireTurnResult> {
	const { entry } = opts

	// A person's turn is shown, never generated.
	if (await entryIsPersons(db, opts.sessionId, entry))
		return { fired: false, reason: "person" }

	const subject = entry.subject ?? RESPOND

	if (subject === RESPOND) {
		const ref = typeof entry.ref === "string" ? entry.ref : null
		const characterId =
			ref && ref.startsWith("character:")
				? Number(ref.slice("character:".length))
				: null
		/**
		 * The own voice off `main` is its fallback envoy TALKING (lair
		 * re-plan R6) — the Castellan in the Sanctum — and needs that envoy
		 * seated. Only that talk stops: story turns run under its name
		 * whether it is seated or not.
		 */
		// A narration lands on `main` whichever composer fired it (R8), so a
		// Narrate pressed in the Sanctum is not the envoy talking there.
		if (ref === null && entry.channel && entry.via !== "narrate") {
			const { ownVoiceSeatRefusal } = await import(
				"$lib/server/pipelines/entities/envoys"
			)
			const unseated = await ownVoiceSeatRefusal(
				db,
				opts.sessionId,
				entry.channel
			)
			if (unseated) return { fired: false, reason: unseated }
		}
		const { runReply } = await import("$lib/server/utils/runReply")
		const outcome = await runReply({
			socket: opts.socket ?? { io: opts.io },
			emitToUser: (opts.emitToUser as any) ?? (() => {}),
			sessionId: opts.sessionId,
			userId: opts.userId,
			/**
			 * The entry's ref as the explicit pick. A narrator entry
			 * (`ref: null`) names nobody, and the spec's own prompts say
			 * whose voice that is — which is exactly what a planner genre
			 * wants and what `turn-narrator` prepares.
			 */
			turn:
				characterId !== null && Number.isInteger(characterId)
					? { kind: "respond", characterId }
					: ref && ref.startsWith("envoy:")
						? { kind: "respond", speaker: ref as `envoy:${string}` }
						: { kind: "respond" },
			...(entry.channel ? { channel: entry.channel } : {}),
			// How the entry was reached, for the inlet's `via` port (R8): a
			// genre routes a `narrate` press ahead of everything else.
			...(entry.via ? { via: entry.via } : {}),
			// Whether this run was started by auto-advance, carried so every
			// write it makes says so (§4.6).
			auto: opts.cause.auto === true
		})
		if (outcome.ok)
			return { fired: true, ...(outcome.receipt ? { runId: outcome.receipt.runId } : {}) }
		return {
			fired: false,
			reason: outcome.stopped
				? "stopped"
				: (outcome.error ?? "the turn produced no reply")
		}
	}

	/**
	 * An action subject (§4.6): the entry names an action identity rather
	 * than a reply. It must be enabled for this user and venue through the
	 * existing path — the same listing the Actions surface renders — so an
	 * order cannot route around a gate a person can see.
	 */
	const { listSessionActions } = await import(
		"$lib/server/pipelines/entities/sessionActions"
	)
	let offered: Array<{ identity?: string; enabled?: boolean }> = []
	try {
		const venues = await listSessionActions(db, opts.sessionId, {
			userId: opts.userId
		})
		// Every venue's list, flattened: an entry may name an action the
		// person reaches anywhere, and which venue it is drawn in is a
		// question about the UI rather than about permission.
		offered = Object.values(venues ?? {}).flatMap((v) =>
			Object.values(v ?? {}).flat()
		) as never
	} catch {
		offered = []
	}
	const known = offered.some(
		(a) => a?.identity === subject && a.enabled !== false
	)
	if (!known) return { fired: false, reason: "action not enabled" }

	const { fireAction } = await import(
		"$lib/server/pipelines/runtime/fireAction"
	)
	try {
		const result = await fireAction(db, {
			sessionId: opts.sessionId,
			actionId: subject,
			actor: {
				userId: opts.userId,
				...(typeof entry.ref === "string"
					? { as: entry.ref as never }
					: {})
			},
			io: opts.io,
			...(opts.lineage ? { lineage: opts.lineage } : {})
		} as never)
		const runId = (result as { runId?: string } | null)?.runId
		return { fired: true, ...(runId ? { runId } : {}) }
	} catch (err) {
		return {
			fired: false,
			reason: err instanceof Error ? err.message : "the action refused"
		}
	}
}
