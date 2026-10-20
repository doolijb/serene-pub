/**
 * 🚧 **Who the round waits on** (PLAN-dc-after-walk2 Q3-3, the walk's #38: a
 * guest declared, and nothing said the round waited for the host). Read off
 * what the page already holds — never a second turn order:
 *
 *  - only while nothing is prepared on the Story (`main`) and the viewer has
 *    a line there since its newest reply — they have had their say;
 *  - the others are every live, named seat with no line there since that
 *    reply, less a seat out of the fight (its `fate` dead or taken out) and
 *    a seat whose player's Story composer is closed (still making their
 *    character).
 *
 * Their names, in seat order; empty when the viewer waits on nobody. What
 * the turn line says: "Waiting for Maren Holt".
 */

export interface RoundSeat {
	id?: number | null
	personaId?: number | null
	persona?: { name?: string | null } | null
	seatName?: string | null
	userId?: number | null
	removedAt?: unknown
	position?: number | null
}

export interface RoundRow {
	role?: string | null
	channel?: string | null
	userId?: number | null
	personaId?: number | null
	isHidden?: boolean | null
	isNarratorResponse?: boolean | null
	metadata?: unknown
}

/** A seat's reference: its card's (`character:<id>`), else its own (`player-seat:<id>`). */
const refOf = (s: RoundSeat): string | null =>
	s.personaId != null ? `character:${s.personaId}` : s.id != null ? `player-seat:${s.id}` : null

/** A row's speaker as the turn order reads it. */
const speakerOf = (m: RoundRow): string | null => {
	const said = (m.metadata as { speaker?: unknown } | null | undefined)?.speaker
	if (typeof said === "string" && said) return said
	return m.personaId != null ? `character:${m.personaId}` : null
}

export function roundWaitingFor(opts: {
	seats: readonly RoundSeat[] | null | undefined
	rows: readonly RoundRow[] | null | undefined
	viewerUserId: number | null | undefined
	/** The stored order's entries on the Story; anything prepared and nobody waits. */
	preparedOnStory: number
	/** A seat's fate, by its reference — `alive`, `taken-out`, `dead` — when known. */
	fateOf?: (ref: string) => string | null | undefined
	/** Whether this person's Story composer is closed (still making their character). */
	storyClosedFor?: (userId: number) => boolean
}): string[] {
	if (opts.preparedOnStory > 0 || opts.viewerUserId == null) return []
	const rows = opts.rows ?? []
	// The lines since the Story's newest reply: a person's, visible, on main.
	const since: RoundRow[] = []
	for (let i = rows.length - 1; i >= 0; i--) {
		const m = rows[i]!
		if ((m.channel ?? "main") !== "main" || m.isHidden || m.isNarratorResponse) continue
		if (m.role !== "user") break
		since.push(m)
	}
	if (!since.some((m) => m.userId === opts.viewerUserId)) return []
	const declared = new Set(since.map(speakerOf).filter((r): r is string => !!r))
	const live = (opts.seats ?? [])
		.filter((s) => !s.removedAt && (s.seatName?.trim() || s.persona?.name?.trim()))
		.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
	if (live.length < 2) return []
	const out: string[] = []
	for (const s of live) {
		const ref = refOf(s)
		if (!ref || declared.has(ref)) continue
		if (s.userId != null && s.userId === opts.viewerUserId) continue
		const fate = opts.fateOf?.(ref)
		if (fate === "dead" || fate === "taken-out") continue
		if (s.userId != null && opts.storyClosedFor?.(s.userId)) continue
		out.push((s.seatName?.trim() || s.persona?.name?.trim())!)
	}
	return out
}
