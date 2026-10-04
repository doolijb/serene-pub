/**
 * Eligibility — the hard gates between the retrieval mechanisms and the ranker
 * (`core:task/eligibility@1`; plan C2, owner rulings R2 and R4, built
 * 2026-10-02).
 *
 * Scoring and eligibility are separate on purpose (`Candidate.ineligible`): a
 * hard rule must not compete numerically with a soft one and lose. This scores
 * nothing and deletes nothing. It returns the same candidates with
 * `ineligible: { reason }` set where a rule fires, and `select` turns each into
 * an `excluded_ineligible` decision carrying the sentence.
 *
 * Three rules, and only these:
 *
 * 1. **Exclusions** — a candidate an exclusion list names (`source:id`). The
 *    keyword lanes publish the entries an author's own selective logic ruled
 *    out, so a copy another mechanism brings in is ruled out the same way.
 * 2. **Secrecy** — a candidate that is somebody's secret (`payload.secretOf`,
 *    the holder's participant reference, set by the relationship read on the
 *    speaker's own secret ties) is ineligible for any other speaker. With no
 *    speaker the producers' scope already decided, and nothing is re-judged.
 * 3. **Presence** (R4) — a candidate about a cast member
 *    (`payload.lorebookBindingId`) whose member has presences on the line and
 *    none holding at the reading's moment. A member with NO presences is always
 *    present (`appearancesOf`' rule), so a book that dates nobody is untouched.
 *
 * ⚠ Pure. The line is the host's (`core:query/cast-presences@1` resolves it);
 * the moment is judged by the one shared rule, `holdsAt`.
 */

import {
	canonicalParticipantRef,
	isBandIntent,
	isParticipantRef,
	withBandIntents,
	type BandIntent
} from "@serene-pub/sdk"
import { holdsAt, type Presence } from "$lib/shared/lorebooks/presence"
import { formatDate, type StoryDate } from "$lib/shared/lorebooks/storyDate"

/** An exclusion verdict, as the keyword lanes publish them. */
export interface Exclusion {
	source: string
	id: number | string
	reason: string
}

/** `core:query/cast-presences@1`'s row. */
export interface PresenceRow {
	bindingId: number
	from: StoryDate
	until: StoryDate | null
	position?: number | null
}

export interface EligibilityInput {
	candidates: readonly unknown[]
	/** One list, or several (a nested literal of lists). */
	exclusions?: unknown
	speaker?: string | null
	presences?: readonly PresenceRow[] | null
	/**
	 * The moment, as `cast-presences` hands it on: a story date, with
	 * `label` — the same date spelled through the book's calendar — when
	 * the host read one (`presencesOnReading`).
	 */
	at?: (StoryDate & { label?: string }) | null
}

export interface EligibilityDiagnostics {
	excluded: number
	secret: number
	absent: number
	/** Candidates that arrived ineligible already, left as they were. */
	alreadyIneligible: number
}

/**
 * The keys a source answers to. The vector index spells a history entry
 * `historyEntry` where the lore read spells it `history`, and an exclusion
 * from one must still find a copy from the other.
 */
const SOURCE_ALIASES: Record<string, string> = { historyEntry: "history" }
const keyOf = (source: unknown, id: unknown) =>
	`${SOURCE_ALIASES[String(source)] ?? String(source)}:${String(id)}`

/** Flatten one list or a list of lists into verdicts; anything else is dropped. */
function exclusionsOf(raw: unknown): Map<string, string> {
	const out = new Map<string, string>()
	const visit = (v: unknown) => {
		if (Array.isArray(v)) {
			for (const item of v) visit(item)
			return
		}
		if (!v || typeof v !== "object") return
		const e = v as Partial<Exclusion>
		if (e.source === undefined || e.id === undefined) return
		const key = keyOf(e.source, e.id)
		if (!out.has(key))
			out.set(
				key,
				typeof e.reason === "string" && e.reason
					? e.reason
					: "Its own conditions rule it out here."
			)
	}
	visit(raw)
	return out
}

const canonical = (ref: unknown): string | null => {
	if (typeof ref !== "string" || !ref.trim()) return null
	return isParticipantRef(ref) ? canonicalParticipantRef(ref) : ref.trim()
}

/** A presence row back in the flat shape `holdsAt` reads. */
function asPresence(row: PresenceRow, i: number): Presence {
	return {
		id: i,
		castId: row.bindingId,
		branchId: null,
		personalPosition: row.position ?? 0,
		fromYear: row.from.year,
		fromMonth: row.from.month ?? null,
		fromDay: row.from.day ?? null,
		untilYear: row.until?.year ?? null,
		untilMonth: row.until?.month ?? null,
		untilDay: row.until?.day ?? null
	}
}

/**
 * Mark what the rules rule out. Band intents pass through first, in the
 * order they came; every candidate stays, in its order.
 */
export function applyEligibility(input: EligibilityInput): {
	candidates: Array<BandIntent | Record<string, any>>
	diagnostics: EligibilityDiagnostics
} {
	const intents: BandIntent[] = []
	const items: Record<string, any>[] = []
	for (const c of input.candidates ?? []) {
		if (isBandIntent(c)) intents.push(c)
		else if (c && typeof c === "object") items.push(c as Record<string, any>)
	}

	const excluded = exclusionsOf(input.exclusions)
	const speaker = canonical(input.speaker)

	/** Member → their presences; only members that have any are judged. */
	const presencesOf = new Map<number, Presence[]>()
	;(input.presences ?? []).forEach((row, i) => {
		if (!row || typeof row.bindingId !== "number" || !row.from) return
		const list = presencesOf.get(row.bindingId) ?? []
		list.push(asPresence(row, i))
		presencesOf.set(row.bindingId, list)
	})
	const at = input.at ?? null
	// Spelled through the book's calendar when the read said how; free-form
	// only for a moment that came without (a custom retrieval's own `at`).
	const when = at
		? `at ${typeof at.label === "string" && at.label ? at.label : formatDate(at)}`
		: "now"

	const diagnostics: EligibilityDiagnostics = {
		excluded: 0,
		secret: 0,
		absent: 0,
		alreadyIneligible: 0
	}

	const judged = items.map((c) => {
		if (c.ineligible) {
			diagnostics.alreadyIneligible++
			return c
		}
		const verdict = excluded.get(keyOf(c.source, c.id))
		if (verdict) {
			diagnostics.excluded++
			return { ...c, ineligible: { reason: verdict } }
		}
		const payload = (c.payload ?? {}) as Record<string, any>
		const holder = canonical(payload.secretOf)
		if (speaker && holder && holder !== speaker) {
			diagnostics.secret++
			return {
				...c,
				ineligible: { reason: "A secret the speaker does not hold." }
			}
		}
		const member = payload.lorebookBindingId
		if (typeof member === "number") {
			const spans = presencesOf.get(member)
			if (spans?.length && !spans.some((p) => holdsAt(p, at))) {
				diagnostics.absent++
				const name =
					(typeof payload.castMember === "string" && payload.castMember) ||
					`Cast member #${member}`
				return {
					...c,
					ineligible: { reason: `${name} is not in the world ${when}.` }
				}
			}
		}
		return c
	})

	return { candidates: withBandIntents(intents, judged), diagnostics }
}
