/**
 * Builds a temporally-scoped "known cast" list for character extraction.
 *
 * Post-merge (see the lorebookBindings/narrativeNodes merge plan), every
 * character — real or background/NPC — is exactly one lorebookBindings row,
 * so this now runs a single query instead of the three separate ones
 * (chat characters/personas, lorebook bindings, narrative nodes) it used to.
 * A fourth former source — names mined from prior scenes'
 * participantCharacters/mentionedCharacters — is gone entirely: those
 * columns now store binding ids directly (resolved via this file's
 * resolveCharacterNamesToBindingIds(), called from scenes.ts right after
 * extraction), so every character a prior scene ever mentioned already has
 * a binding row, already covered by the single query below.
 *
 * Real characters/personas (characterId/personaId set) are always in scope
 * regardless of timeline. Background/NPC bindings (neither set) are only
 * in scope once their own historyEntryId/sceneId position is at or before
 * the scene being extracted for — matching how narrativeNodes' timeline
 * filter worked pre-merge.
 *
 * Names are fuzzy-matched and deduplicated so LLM-invented variants collapse
 * onto the canonical entry and their aliases are collected in one place.
 */

import * as schema from "$lib/server/db/schema"
import { eq, sql } from "drizzle-orm"
import type { CastEntry, ExtractedCastRef } from "./templates"
import type { PgliteDatabase } from "drizzle-orm/pglite"
import { deriveNextBindingToken } from "$lib/server/utils/lorebookBindingToken"

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
type DbLike = PgliteDatabase<typeof schema>

async function defaultDb(): Promise<DbLike> {
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
 * Try to merge `name` + `extraAliases` into an existing entry.
 * Returns the matched entry if found (and updates it in place), else null.
 */
function mergeIntoExisting(
	entries: CastEntry[],
	name: string,
	extraAliases: string[],
	id: number | null
): CastEntry | null {
	for (const entry of entries) {
		if (!entryMatches(entry, name)) continue

		// Add name as alias if it's meaningfully different from the canonical
		if (
			!namesMatch(entry.name, name) &&
			!entry.aliases.some((a) => namesMatch(a, name))
		) {
			entry.aliases.push(name)
		}
		for (const alias of extraAliases) {
			if (
				!namesMatch(entry.name, alias) &&
				!entry.aliases.some((a) => namesMatch(a, alias))
			) {
				entry.aliases.push(alias)
			}
		}
		// A real binding id always wins over a placeholder null — this can
		// happen if an earlier merge (e.g. a chat character resolved before
		// its binding was confirmed) recorded null first.
		if (entry.id === null && id !== null) entry.id = id
		return entry
	}
	return null
}

// Round-12 audit fix (MEDIUM): mergeIntoExisting is O(entries) per call, and
// buildSceneCastList calls it once per chat char/persona and once per
// binding — net O(n^2) Levenshtein-based fuzzy matching, synchronous JS on
// Node's single event loop. Same cap/rationale as the sibling
// duplicateBindingDetection.ts's MAX_BINDINGS_FOR_DUPLICATE_DETECTION, but
// this list is actively used (not purely advisory), so above the cap this
// skips only the fuzzy-dedup scan — entries are still pushed directly,
// just without cross-entry name-matching merges — rather than returning
// nothing.
export const MAX_BINDINGS_FOR_SCENE_CAST = 300

/** mergeIntoExisting, or an unconditional push when skipDedup (over the cap) — see MAX_BINDINGS_FOR_SCENE_CAST above. */
function mergeOrPush(
	entries: CastEntry[],
	name: string,
	aliases: string[],
	id: number | null,
	skipDedup: boolean
): void {
	if (!skipDedup) {
		const existing = mergeIntoExisting(entries, name, aliases, id)
		if (existing) return
	}
	entries.push({ name, aliases, id })
}

// ── Timeline comparison ───────────────────────────────────────────────────────

interface TimelinePos {
	entryId: number
	year: number
	month: number | null
	day: number | null
}

/** True if position A is strictly before position B (or same entry, earlier scene). */
function isStrictlyBefore(
	a: TimelinePos,
	aSceneId: number | null,
	b: TimelinePos,
	bSceneId: number
): boolean {
	if (a.year !== b.year) return a.year < b.year
	const am = a.month ?? 0,
		bm = b.month ?? 0
	if (am !== bm) return am < bm
	const ad = a.day ?? 0,
		bd = b.day ?? 0
	if (ad !== bd) return ad < bd
	if (a.entryId !== b.entryId) return a.entryId < b.entryId
	// Same history entry — scene id is the tiebreaker
	return (aSceneId ?? 0) < bSceneId
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function buildSceneCastList(
	sceneId: number | null,
	lorebookId: number,
	chatId: number | null,
	dbInstance?: DbLike
): Promise<CastEntry[]> {
	const db = dbInstance ?? (await defaultDb())
	const entries: CastEntry[] = []

	// ── Current scene's timeline position ─────────────────────────────────
	// `sceneId` is null when drafting a brand-new scene that doesn't exist
	// yet (chats:summarize, before scenes:create) — there's no timeline
	// position to filter against, so every background/NPC binding is left
	// in scope (see the `currentPos` guard below, which then never fires).
	const currentScene =
		sceneId !== null
			? await db.query.scenes.findFirst({
					where: eq(schema.scenes.id, sceneId),
					columns: { historyEntryId: true }
				})
			: null
	const currentHistoryEntryId = currentScene?.historyEntryId ?? null

	let currentPos: TimelinePos | null = null
	if (currentHistoryEntryId) {
		const he = await db.query.historyEntries.findFirst({
			where: eq(schema.historyEntries.id, currentHistoryEntryId),
			columns: { id: true, year: true, month: true, day: true }
		})
		if (he) {
			currentPos = {
				entryId: he.id,
				year: he.year ?? 0,
				month: he.month,
				day: he.day
			}
		}
	}

	// ── Every binding in the lorebook, in one query ──────────────────────────
	const allBindings = await db.query.lorebookBindings.findMany({
		where: eq(schema.lorebookBindings.lorebookId, lorebookId),
		with: {
			historyEntry: {
				columns: { id: true, year: true, month: true, day: true }
			}
		}
	})
	const bindingById = new Map(allBindings.map((b) => [b.id, b]))
	const bindingByCharacterId = new Map(
		allBindings
			.filter((b) => b.characterId != null)
			.map((b) => [b.characterId!, b])
	)
	const bindingByPersonaId = new Map(
		allBindings
			.filter((b) => b.personaId != null)
			.map((b) => [b.personaId!, b])
	)

	const skipDedup = allBindings.length > MAX_BINDINGS_FOR_SCENE_CAST
	if (skipDedup) {
		console.warn(
			`buildSceneCastList: skipping fuzzy dedup for lorebook ${lorebookId} — ${allBindings.length} bindings exceeds the ${MAX_BINDINGS_FOR_SCENE_CAST} cap.`
		)
	}

	// ── Chat characters/personas — priority merge slot (their binding, if
	// one exists yet, always wins the canonical name/id) ────────────────────
	if (chatId) {
		const [chatChars, chatPersonas] = await Promise.all([
			db.query.chatCharacters.findMany({
				where: eq(schema.chatCharacters.chatId, chatId),
				with: {
					character: {
						columns: {
							id: true,
							name: true,
							nickname: true,
							aliases: true
						}
					}
				}
			}),
			db.query.chatPersonas.findMany({
				where: eq(schema.chatPersonas.chatId, chatId),
				with: {
					persona: {
						columns: { id: true, name: true, aliases: true }
					}
				}
			})
		])

		for (const cc of chatChars) {
			const char = (cc as any).character
			if (!char?.name) continue
			const binding = bindingByCharacterId.get(char.id)
			const name = binding ? binding.name || char.name : char.name
			const aliases = [
				...(char.nickname ? [char.nickname] : []),
				...(char.aliases ?? [])
			].filter((a: string) => !namesMatch(a, name))
			mergeOrPush(entries, name, aliases, binding?.id ?? null, skipDedup)
		}

		for (const cp of chatPersonas) {
			const persona = (cp as any).persona
			if (!persona?.name) continue
			const binding = bindingByPersonaId.get(persona.id)
			const name = binding ? binding.name || persona.name : persona.name
			const aliases = (persona.aliases ?? []).filter(
				(a: string) => !namesMatch(a, name)
			)
			mergeOrPush(entries, name, aliases, binding?.id ?? null, skipDedup)
		}
	}

	// ── Every binding: real characters/personas always in scope,
	// background/NPC bindings only once chronologically eligible ────────────
	for (const binding of allBindings) {
		const isReal = binding.characterId != null || binding.personaId != null

		if (!isReal) {
			const he = (binding as any).historyEntry
			if (
				binding.historyEntryId &&
				he &&
				currentPos &&
				sceneId !== null
			) {
				const bindingPos: TimelinePos = {
					entryId: he.id,
					year: he.year ?? 0,
					month: he.month,
					day: he.day
				}
				const eligible =
					isStrictlyBefore(
						bindingPos,
						binding.sceneId,
						currentPos,
						sceneId
					) ||
					(bindingPos.entryId === currentPos.entryId &&
						(binding.sceneId ?? 0) <= sceneId)
				if (!eligible) continue
			}
		}

		const name = binding.name?.trim()
		if (!name) continue

		const nodeAliases: string[] = collectAliases(binding)
		// Inherit aliases from parent (merged) binding — legacy pre-absorb
		// merge data (parentNodeId tagging); kept for backward compatibility
		// with pairs merged before the consolidating absorb redesign.
		if (binding.parentNodeId) {
			const parent = bindingById.get(binding.parentNodeId)
			if (parent) {
				nodeAliases.push(...(parent.aliases ?? []))
				if (parent.name && !namesMatch(parent.name, name)) {
					nodeAliases.push(parent.name)
				}
			}
		}
		const uniqueAliases = nodeAliases.filter((a) => !namesMatch(a, name))

		mergeOrPush(entries, name, uniqueAliases, binding.id, skipDedup)
	}

	// ── Final dedup pass — collapse entries whose canonical names match ────
	const merged: CastEntry[] = []
	for (const entry of entries) {
		const match = skipDedup
			? null
			: mergeIntoExisting(merged, entry.name, entry.aliases, entry.id)
		if (!match) {
			merged.push({
				name: entry.name,
				aliases: [...new Set(entry.aliases)],
				id: entry.id
			})
		}
	}

	// Deduplicate aliases within each entry
	for (const entry of merged) {
		entry.aliases = [...new Set(entry.aliases)]
	}

	return merged
}

/**
 * Resolves character-extraction refs against a known-cast list WITHOUT
 * creating any new lorebookBindings rows — pure, no I/O, does not mutate
 * `castEntries`. A `{castId}` ref resolves the same way
 * resolveCharacterNamesToBindingIds does (trusted only if it verifies
 * against castEntries). A `{name}` ref that fuzzy-matches an existing entry
 * resolves to that entry's id. A name that matches nothing is returned as a
 * plain suggested name (deduped case-insensitively) instead of being minted
 * into a row — creation is deferred to the caller's own review/Save step
 * (see resolveOrCreateBindingByName below, used at Save time by the
 * scenes:process and chats:summarize review screens).
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
 * Resolves character-extraction output to real lorebookBindings ids,
 * against a known-cast list already built for this scene by
 * buildSceneCastList(). Delegates matching to resolveCharacterRefs() above,
 * then creates a brand-new unbound (background/NPC) binding on the spot for
 * every name that didn't match — this is the same "unmatched name → new
 * node" responsibility graphBuilder.ts's old Phase 1 used to have, now
 * resolved once, here, at summarization time instead of later at
 * graph-build time (see the merge plan's scene character presence
 * redesign).
 *
 * Only used by callers with no review step downstream (narrativeGraph.ts's
 * direct-history-entry path and the scene-character-ids backfill script) —
 * scenes:process and chats:summarize, which do have a Review & Save screen,
 * use resolveCharacterRefs()'s non-creating suggestions instead and only
 * create bindings via resolveOrCreateBindingByName() once the user accepts
 * them at Save.
 *
 * `castEntries` is mutated in place — a name that appears in both the
 * participants and mentioned lists (or repeats across calls for the same
 * scene) resolves to the same newly-created row rather than two duplicates.
 */
export async function resolveCharacterNamesToBindingIds(
	refs: ExtractedCastRef[],
	lorebookId: number,
	castEntries: CastEntry[],
	dbInstance?: DbLike
): Promise<number[]> {
	const db = dbInstance ?? (await defaultDb())
	const { ids, suggestedNames } = resolveCharacterRefs(refs, castEntries)

	for (const name of suggestedNames) {
		// New name — create an unbound background/NPC binding for it.
		// Token derived from the lorebook's own per-lorebook counter
		// (decision 1), never a recomputed max/count.
		const newId = await db.transaction(async (tx) => {
			const token = await deriveNextBindingToken(lorebookId, tx)
			const [inserted] = await tx
				.insert(schema.lorebookBindings)
				.values({
					lorebookId,
					characterId: null,
					personaId: null,
					binding: token,
					name
				})
				.returning({ id: schema.lorebookBindings.id })
			return inserted.id
		})

		// A transitional null-id entry for this name (shouldn't normally
		// happen post-migration, but handled defensively) gets backfilled
		// with the new row's id rather than duplicated.
		const existing = castEntries.find((e) => entryMatches(e, name))
		if (existing) {
			existing.id = newId
		} else {
			castEntries.push({ name, aliases: [], id: newId })
		}
		ids.push(newId)
	}
	return [...new Set(ids)]
}

/**
 * Resolves a single free-form name to a real lorebookBindings id, creating
 * a new unbound (background/NPC) binding only if nothing in the lorebook's
 * current cast already matches — used at Save time by scenes:process and
 * chats:summarize's review screens to turn an accepted "suggested new
 * character" (from extraction or manually typed) into a real binding,
 * without risking a duplicate.
 *
 * Unlike resolveCharacterNamesToBindingIds (which resolves against a
 * `castEntries` snapshot built earlier in the request), this re-reads the
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
	dbInstance?: DbLike
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
		const [inserted] = await tx
			.insert(schema.lorebookBindings)
			.values({
				lorebookId,
				characterId: null,
				personaId: null,
				binding: token,
				name: trimmed
			})
			.returning({ id: schema.lorebookBindings.id })
		return { id: inserted.id, created: true }
	})
}

/**
 * Merge auto-detected message-sender binding ids into the LLM-extracted
 * participant list, then remove any resulting participant from the
 * mentioned list. `mentioned = mentioned - participants`, evaluated
 * against the *final* participant set (LLM-extracted plus every actual
 * sender) — not narrowly scoped to just the sender-derived ids — so a
 * character the LLM itself double-listed in both arrays never survives in
 * mentioned just because it wasn't a message sender. Pure/no I/O: used by
 * both chats:summarize and scenes:process after each resolves its own
 * sender binding ids.
 */
export function reconcileParticipantsAndMentioned(
	participants: number[],
	mentioned: number[],
	senderBindingIds: Iterable<number>
): { participants: number[]; mentioned: number[] } {
	const participantSet = new Set(participants)
	for (const id of senderBindingIds) participantSet.add(id)
	const finalMentioned = mentioned.filter((id) => !participantSet.has(id))
	return { participants: [...participantSet], mentioned: finalMentioned }
}

/**
 * Same "participant wins over mentioned" rule as
 * reconcileParticipantsAndMentioned, applied to suggested (not-yet-created)
 * names instead of resolved ids — a name suggested in both lists is kept
 * only as a participant suggestion. Case-insensitive.
 */
export function reconcileSuggestedNames(
	participantNames: string[],
	mentionedNames: string[]
): { participants: string[]; mentioned: string[] } {
	const participantLower = new Set(
		participantNames.map((n) => n.toLowerCase())
	)
	return {
		participants: participantNames,
		mentioned: mentionedNames.filter(
			(n) => !participantLower.has(n.toLowerCase())
		)
	}
}
