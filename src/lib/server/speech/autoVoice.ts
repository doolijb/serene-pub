/**
 * 🚧 **Auto** — the per-session sticky voice pick for a speaker with no voice
 * of its own (narration-fallback lane, 2026-10-30). Pure: no db, no `$lib`
 * runtime imports. The caller loads the candidates (the speaking loadout's
 * enabled, usable entries), the narrator's slug, the slugs already spoken for,
 * and the stored pick.
 *
 *  1. A stored pick that is still a candidate and not the narrator's is reused.
 *  2. Else pool = candidates minus the narrator's; empty → no pick (`only-narrator`).
 *  3. Prefer the pool minus `usedSlugs` (`avoids-narrator`); if empty, the whole pool (`shared`).
 *  4. `casting` keeps only the best label-match score (all zero = no filtering).
 *  5. Sort by slug; a 32-bit FNV-1a hash of `speakerRef|sessionId` picks the index.
 */

export interface AutoCandidate {
	slug: string
	labels?: Record<string, unknown> | null
}

/** Casting tags a genre may put on an envoy. */
export interface AutoCasting {
	role?: "narrator-like" | "speaker"
	gender?: string
	age?: string
}

export interface AutoVoiceInput {
	candidates: readonly AutoCandidate[]
	narratorSlug: string | null
	usedSlugs: Iterable<string>
	stored: string | null
	casting?: AutoCasting | null
	speakerRef: string
	sessionId: number | null
}

export type AutoVoiceReason = "sticky" | "avoids-narrator" | "shared" | "only-narrator"

export interface AutoVoicePick {
	/** The picked slug; null = nothing but the narrator's voice to give. */
	slug: string | null
	reason: AutoVoiceReason
	/** True when the pick is new (the caller stores it); false for a reused one or none. */
	fresh: boolean
	/** A stored pick that was not reusable (gone, disabled, or the narrator's) — the caller drops its key. */
	staleStored: boolean
}

/** 32-bit FNV-1a. */
export function fnv1a(s: string): number {
	let h = 0x811c9dc5
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i)
		h = Math.imul(h, 0x01000193) >>> 0
	}
	return h >>> 0
}

const labelOf = (c: AutoCandidate, key: string): string => {
	const v = c.labels?.[key]
	return typeof v === "string" ? v.trim().toLowerCase() : ""
}

const score = (c: AutoCandidate, casting: AutoCasting): number => {
	let n = 0
	for (const key of ["gender", "age"] as const) {
		const want = casting[key]?.trim().toLowerCase()
		if (want && labelOf(c, key) === want) n++
	}
	if (casting.role === "narrator-like") {
		const values = Object.values(c.labels ?? {}).map((v) => (typeof v === "string" ? v.toLowerCase() : ""))
		if (values.some((v) => v.includes("narrat"))) n++
	}
	return n
}

export function pickAutoVoice(input: AutoVoiceInput): AutoVoicePick {
	const bySlug = new Map(input.candidates.map((c) => [c.slug, c]))
	const stored = input.stored?.trim() || null
	if (stored && bySlug.has(stored) && stored !== input.narratorSlug)
		return { slug: stored, reason: "sticky", fresh: false, staleStored: false }
	const staleStored = stored != null
	const pool = [...bySlug.values()].filter((c) => c.slug !== input.narratorSlug)
	if (!pool.length) return { slug: null, reason: "only-narrator", fresh: false, staleStored }
	const used = new Set(input.usedSlugs)
	const unused = pool.filter((c) => !used.has(c.slug))
	const reason: AutoVoiceReason = unused.length ? "avoids-narrator" : "shared"
	let choices = unused.length ? unused : pool
	if (input.casting) {
		const scores = choices.map((c) => score(c, input.casting!))
		const best = Math.max(...scores)
		if (best > 0) choices = choices.filter((_, i) => scores[i] === best)
	}
	choices = [...choices].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
	const i = fnv1a(`${input.speakerRef}|${input.sessionId ?? ""}`) % choices.length
	return { slug: choices[i]!.slug, reason, fresh: true, staleStored }
}
