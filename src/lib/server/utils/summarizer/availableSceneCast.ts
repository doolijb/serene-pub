/**
 * Fuzzy name matching and cast-reference resolution for the graph build's
 * character extraction, and the one place a named cast member is created.
 *
 * Names are fuzzy-matched so extracted variants collapse onto the canonical
 * entry; aliases are collected in one place.
 */

import * as schema from "$lib/server/db/schema"
import { eq, sql } from "drizzle-orm"
import type { CastEntry, ExtractedCastRef } from "./templates"
import { deriveNextBindingToken } from "$lib/server/utils/lorebookBindingToken"
import { insertCastMember } from "$lib/server/characters/versions"

export type { CastEntry, ExtractedCastRef }

// Optional trailing `dbInstance` param on the exports below, defaulting to a
// lazy dynamic import of the app's shared `db`, so callers can supply their own
// connection (tests do; so does anything running inside a transaction).
//
// The lazy import is deliberate rather than stylistic: it keeps this module
// free of a static `$lib/server/db` edge. Unlike characterBindingSync.ts this
// one is not currently on db/index.ts's boot path, so the constraint is weaker
// here — but the failure mode if it ever gets pulled onto that path is a
// bundling-dependent `Cannot access 'index' before initialization` at startup,
// which is worth not courting. Do not "simplify" it to a top-level import.
//
// A previous version of this note attributed the pattern to
// `scripts/backfill-scene-character-ids.ts`. No such script exists in the repo.
async function defaultDb(): Promise<Db> {
	return (await import("$lib/server/db")).db
}

// ── Fuzzy matching ────────────────────────────────────────────────────────────

function normalize(s: string): string {
	return s
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9 ]/g, "")
		.replace(/\s+/g, " ")
}

function levenshtein(a: string, b: string): number {
	const m = a.length,
		n = b.length
	const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => [
		i,
		...Array(n).fill(0)
	])
	for (let j = 0; j <= n; j++) dp[0][j] = j
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			dp[i][j] =
				a[i - 1] === b[j - 1]
					? dp[i - 1][j - 1]
					: 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
		}
	}
	return dp[m][n]
}

/**
 * Words stripped before comparing names — honorifics, titles, filler
 * prepositions.
 *
 * Lived in graphBuilder.ts, which meant the build could reconcile "Commander
 * Thorne" with "Maren Thorne" while cast resolution — the earlier step, and the
 * one where a duplicate binding is actually minted — could not, because
 * namesMatch below compared raw words. The codebase had the right answer in the
 * wrong file.
 */
const TITLE_WORDS = new Set([
	"lord",
	"lady",
	"sir",
	"dame",
	"king",
	"queen",
	"prince",
	"princess",
	"duke",
	"duchess",
	"count",
	"countess",
	"baron",
	"baroness",
	"emperor",
	"empress",
	"captain",
	"general",
	"admiral",
	"commander",
	"the",
	"of",
	"von",
	"de",
	"van",
	"der",
	"el",
	"al"
])

/** A name's words with titles and one-letter fragments removed. */
export function distinctiveWords(name: string): string[] {
	return name
		.toLowerCase()
		.trim()
		.split(/\s+/)
		.filter((w) => w.length > 1 && !TITLE_WORDS.has(w))
}

/** True if a and b refer to the same person. */
export function namesMatch(a: string, b: string): boolean {
	const na = normalize(a)
	const nb = normalize(b)
	if (!na || !nb) return false
	if (na === nb) return true

	// Word-subset on DISTINCTIVE words: "Alice" matches "Alice Vance", and an
	// honorific no longer blocks a match — "Commander Thorne" and "Maren
	// Thorne" share "thorne". Falls back to the raw words when a name is
	// nothing but titles ("The Baron"), which would otherwise compare empty and
	// match everything.
	const wa = distinctiveWords(na)
	const wb = distinctiveWords(nb)
	const [ua, ub] =
		wa.length && wb.length ? [wa, wb] : [na.split(" "), nb.split(" ")]
	if (ua.every((w) => ub.includes(w))) return true
	if (ub.every((w) => ua.includes(w))) return true

	// Levenshtein for short strings (handles LLM typos)
	const shorter = Math.min(na.length, nb.length)
	if (shorter >= 4) {
		const threshold = shorter <= 6 ? 1 : Math.floor(shorter / 6)
		if (levenshtein(na, nb) <= threshold) return true
	}

	return false
}

/** True if `name` matches the canonical name or any alias of `entry`. */
export function entryMatches(entry: CastEntry, name: string): boolean {
	return (
		namesMatch(entry.name, name) ||
		entry.aliases.some((a) => namesMatch(a, name))
	)
}

/**
 * The schema-mandated alias union for a binding: `aliases` ∪ `absorbedAliases`.
 *
 * lorebookBindings.absorbedAliases' own schema comment states the invariant —
 * "Every consumer that reads `aliases` for name-matching or display must union
 * it with this column" — and then points at a `collectAliases()` that did not
 * exist; the union was open-coded at three sites and simply missing at a
 * fourth, the graph build's seed list, which is exactly where a duplicate gets
 * re-proposed after every merge. This is that function, so the comment is now
 * true and the invariant has one enforcement point.
 *
 * Scope is deliberately *only* the mandated pair. Callers with additional
 * name sources add them on top — the graph build unions child-binding names,
 * duplicate detection prepends the canonical name — because those are
 * caller-specific concerns, not part of the invariant. Folding them in here
 * would either bloat the helper or tempt someone to "simplify" them away.
 *
 * Returns a fresh, mutable, deduped array; callers push onto it.
 */
export function collectAliases(binding: {
	aliases?: string[] | null
	absorbedAliases?: string[] | null
}): string[] {
	const out: string[] = []
	const seen = new Set<string>()
	for (const alias of [
		...(binding.aliases ?? []),
		...(binding.absorbedAliases ?? [])
	]) {
		const trimmed = alias?.trim()
		if (!trimmed) continue
		const key = trimmed.toLowerCase()
		if (seen.has(key)) continue
		seen.add(key)
		out.push(trimmed)
	}
	return out
}

/**
 * Resolves character-extraction refs against a known-cast list WITHOUT
 * creating any new lorebookBindings rows — pure, no I/O, does not mutate
 * `castEntries`. A `{castId}` ref is trusted only if it verifies against
 * castEntries. A `{name}` ref that fuzzy-matches an existing entry
 * resolves to that entry's id. A name that matches nothing is returned as a
 * plain suggested name (deduped case-insensitively) instead of being minted
 * into a row — creation is deferred to the caller's own review/Save step
 * (see resolveOrCreateBindingByName below, used at Save time by the
 * scenes:process and sessions:summarize review screens).
 */
/**
 * The single cast entry `name` refers to, or undefined if that is ambiguous.
 *
 * Ambiguity must mean "no match", not "first match". This call site used to be
 * `castEntries.find(...)`, which was survivable only because namesMatch was
 * narrow. Now that it strips honorifics it is strictly more permissive, and
 * more permissive matching plus first-match-wins means silent MIS-merges: with
 * both "Maren Thorne" and "Thorne Blackwood" in the cast, "Commander Thorne"
 * would bind to whichever happened to sort first. A visible duplicate the user
 * can merge is a far better failure than a wrong identity they will not notice.
 *
 * graphBuilder's fuzzyMatchName has always had exactly this rule
 * ("candidates.length === 1 ? … : undefined"); this brings the earlier stage
 * into line with it.
 *
 * An exact canonical-name hit still wins: fuzzy matching legitimately reaches
 * a neighbour ("Thorne" also matching "Thorne Blackwood") without making an
 * exact name ambiguous.
 */
function resolveUniqueEntry(
	castEntries: CastEntry[],
	name: string
): CastEntry | undefined {
	const matches = castEntries.filter((e) => entryMatches(e, name))
	if (matches.length <= 1) return matches[0]
	const normalized = normalize(name)
	const exact = matches.filter((e) => normalize(e.name) === normalized)
	return exact.length === 1 ? exact[0] : undefined
}

export function resolveCharacterRefs(
	refs: ExtractedCastRef[],
	castEntries: CastEntry[]
): { ids: number[]; suggestedNames: string[] } {
	const ids: number[] = []
	const suggestedNames: string[] = []
	for (const ref of refs) {
		if ("castId" in ref) {
			const existing = castEntries.find((e) => e.id === ref.castId)
			if (existing?.id != null) ids.push(existing.id)
			continue
		}

		const name = ref.name.trim()
		if (!name) continue

		const existing = resolveUniqueEntry(castEntries, name)
		if (existing?.id != null) {
			ids.push(existing.id)
			continue
		}

		if (
			!suggestedNames.some((n) => n.toLowerCase() === name.toLowerCase())
		) {
			suggestedNames.push(name)
		}
	}
	return { ids: [...new Set(ids)], suggestedNames }
}

/**
 * Resolves a single free-form name to a real lorebookBindings id, creating
 * a new unbound (background/NPC) binding only if nothing in the lorebook's
 * current cast already matches — used at Save time by scenes:process and
 * sessions:summarize's review screens to turn an accepted "suggested new
 * character" (from extraction or manually typed) into a real binding,
 * without risking a duplicate.
 *
 * Unlike resolveCharacterRefs (which resolves against a `castEntries`
 * snapshot built earlier in the request), this re-reads the
 * lorebook's *current* bindings right before matching — the whole point is
 * to catch a match that appeared after extraction ran (another user, or an
 * earlier suggestion in the same save, created it in the meantime). A
 * Postgres advisory lock scoped to `lorebookId` serializes concurrent calls
 * for the same lorebook so two callers racing to resolve the same unmatched
 * name can't both insert a row for it.
 */
export async function resolveOrCreateBindingByName(
	lorebookId: number,
	name: string,
	dbInstance?: Db
): Promise<{ id: number; created: boolean }> {
	const db = dbInstance ?? (await defaultDb())
	const trimmed = name.trim()
	if (!trimmed) throw new Error("Name required")

	return db.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(${lorebookId})`)

		const rows = await tx.query.lorebookBindings.findMany({
			where: eq(schema.lorebookBindings.lorebookId, lorebookId),
			columns: {
				id: true,
				name: true,
				aliases: true,
				absorbedAliases: true
			}
		})
		const existing = rows.find((r) =>
			entryMatches(
				{ name: r.name, aliases: collectAliases(r), id: r.id },
				trimmed
			)
		)
		if (existing) return { id: existing.id, created: false }

		const token = await deriveNextBindingToken(lorebookId, tx)
		const { member } = await insertCastMember(tx, {
			lorebookId,
			characterId: null,
			binding: token,
			name: trimmed
		})
		return { id: member.id, created: true }
	})
}
