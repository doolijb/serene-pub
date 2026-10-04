/**
 * Binding suggestions — *"this was named, and it resolves to nothing"*.
 *
 * ## What this module is, and what it deliberately is not
 *
 * It is **not** an extractor. Plan §4's whole premise is that the candidates
 * already exist: `entry_annotations` and `message_annotations` record every
 * occurrence of every name a passage used, and the ones that resolved to no row
 * are exactly the open tier — `open:<normalized>`, minted in `ranking/entities.ts`
 * as `` `open:${normalise(surface)}` ``. So this file *reads* those two tables and
 * groups them. A second extraction here would be a second answer to a question
 * that already has one, and the two would disagree the first time either moved.
 *
 * ⚠ **The open tier shrinks as the vocabulary widens**, by design — a concurrent
 * lane is feeding `aliases` and `absorbedAliases` into the gazetteer, which turns
 * open hits into resolved ones. That makes candidates *fewer and better*, so
 * nothing here may assume a volume, and nothing here may widen what counts as
 * unresolved to keep the list full. `entityKey LIKE 'open:%'` is the definition
 * and it is the extractor's, not this module's.
 *
 * ## Freshness: two readers already exist, and each side keeps its own
 *
 * A stale annotation is not evidence — §13.3's rule, and the reason every row
 * carries `(extractorVersion, sourceHash, gazetteerHash)`. Rather than invent a
 * third freshness policy, each side here mirrors the reader that already owns
 * it: the version and the gazetteer hash on both, plus the source hash, compared
 * with the column the lane's picker compares it with (`annotationTextHash`) so
 * there is still exactly one spelling of *"did this text move"*.
 *
 * ## "Nothing found" and "not looked yet" are different answers
 *
 * Plan §1's second caveat, and the one that decides this module's return shape.
 * Annotation is a background lane; a book whose messages have not been walked yet
 * has **no candidates yet**, which a bare empty list reports as *"nothing to
 * add"* — confidently, and wrongly. So the scan reports coverage: how many
 * sources exist and how many carry a fresh annotation. The UI says which state it
 * is in, and the difference is visible rather than inferred.
 *
 * The counting rests on a detail of the annotation store: **a passage that names
 * nothing is still a row** (`entityKey = ''`, `tier = 'none'` — the sentinel).
 * So "has at least one fresh annotation row" is a faithful test of *"this source
 * has been looked at"*, and it does not quietly count a source that was examined
 * and found empty as unexamined.
 */

import { and, eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	annotationTextHash,
	entryAnnotationText,
	amendedNamesOf,
	loadVocabulary,
	MAX_ANNOTATED_LENGTH,
	type AnnotationVocabulary
} from "$lib/server/annotations"
import {
	bindingNames,
	EXTRACTOR_VERSION
} from "$lib/server/pipelines/ranking/entities"

// db is the global Db — see db/types.d.ts

/** The prefix `ranking/entities.ts` puts on an entity that resolved to nothing. */
export const OPEN_TIER_PREFIX = "open:"

/** The three states a suggestion can be in. `pending` is the only proposition. */
export const SUGGESTION_STATUSES = ["pending", "ignored", "added"] as const
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number]

export const isSuggestionStatus = (v: unknown): v is SuggestionStatus =>
	typeof v === "string" &&
	(SUGGESTION_STATUSES as readonly string[]).includes(v)

/**
 * How much text rides along as the example.
 *
 * Long enough to be a sentence, short enough that twenty of them are a list
 * rather than a transcript. The point is to make the decision possible *in
 * place*: a suggestion whose evidence is elsewhere is one a person dismisses by
 * default, which is the failure mode this whole surface exists to avoid.
 */
export const EXAMPLE_CONTEXT_RADIUS = 90

/** A candidate, as derived. Nothing here is a decision. */
export interface SuggestionCandidate {
	/** `open:<normalized>` — the annotation's own key, verbatim. */
	entityKey: string
	/** The fullest surface form any source used. */
	surface: string
	/** Total mentions, summed across every source that named it. */
	occurrences: number
	/** How many distinct entries/messages named it. */
	sourceCount: number
	/** Earliest/latest *source* timestamp among those sources. */
	firstSeenAt: Date
	lastSeenAt: Date
	exampleContext: string
	exampleSourceKind: "entry" | "message"
	exampleSourceId: number
}

/** How much of the book the annotation lane has actually walked. */
export interface AnnotationCoverage {
	entries: { annotated: number; total: number }
	messages: { annotated: number; total: number }
}

export interface CandidateScan {
	candidates: SuggestionCandidate[]
	coverage: AnnotationCoverage
}

/** No source of either kind carries a fresh annotation — nothing has been looked at. */
export const isUnscanned = (c: AnnotationCoverage): boolean =>
	c.entries.annotated === 0 && c.messages.annotated === 0

/** Sources that exist but have no fresh annotation — what the lane still owes. */
export const outstandingSources = (c: AnnotationCoverage): number =>
	Math.max(0, c.entries.total - c.entries.annotated) +
	Math.max(0, c.messages.total - c.messages.annotated)

/**
 * One line of the text around a mention.
 *
 * Offsets come off the annotation's `spans`, which the extractor recorded
 * against the text it was *handed* — `entryAnnotationText(row)` for an entry,
 * `content.slice(0, MAX_ANNOTATED_LENGTH)` for a message — so a caller must
 * slice the same string it hashed, or the window lands somewhere else entirely.
 */
export function exampleAround(
	text: string,
	span: { start: number; end: number } | undefined
): string {
	if (!text) return ""
	const start = span ? Math.max(0, span.start - EXAMPLE_CONTEXT_RADIUS) : 0
	const end = span
		? Math.min(text.length, span.end + EXAMPLE_CONTEXT_RADIUS)
		: Math.min(text.length, EXAMPLE_CONTEXT_RADIUS * 2)
	const slice = text.slice(start, end).replace(/\s+/g, " ").trim()
	// Ellipses only where text was actually cut, so a short passage does not
	// claim to be an excerpt of something longer.
	return `${start > 0 ? "…" : ""}${slice}${end < text.length ? "…" : ""}`
}

/** The accumulator one candidate is built up in as sources are walked. */
interface Accumulator extends SuggestionCandidate {
	/** The mention count of the source the current example came from. */
	exampleWeight: number
	/**
	 * That source's own timestamp.
	 *
	 * ⚠ Held separately from `lastSeenAt`, which has already absorbed the
	 * incoming row by the time the example is judged — comparing against it
	 * would make the recency tie-break silently unreachable.
	 */
	exampleAt: Date
}

/**
 * Fold one source's annotation into the candidate set.
 *
 * The example is taken from the source with the **most** mentions of this name,
 * ties broken by the later timestamp and then by the higher id. A name's best
 * evidence is the passage that dwells on it, not whichever row the query
 * happened to return first — and the choice has to be total and deterministic,
 * or the same unchanged book shows a different quote on every scan.
 */
function offer(
	into: Map<string, Accumulator>,
	row: {
		entityKey: string
		surface: string
		mentions: number
		spans: Array<{ start: number; end: number }>
	},
	source: {
		kind: "entry" | "message"
		id: number
		at: Date
		text: string
	}
) {
	const mentions = Math.max(0, row.mentions)
	const existing = into.get(row.entityKey)
	if (!existing) {
		into.set(row.entityKey, {
			entityKey: row.entityKey,
			surface:
				row.surface || row.entityKey.slice(OPEN_TIER_PREFIX.length),
			occurrences: mentions,
			sourceCount: 1,
			firstSeenAt: source.at,
			lastSeenAt: source.at,
			exampleContext: exampleAround(source.text, row.spans[0]),
			exampleSourceKind: source.kind,
			exampleSourceId: source.id,
			exampleWeight: mentions,
			exampleAt: source.at
		})
		return
	}
	existing.occurrences += mentions
	existing.sourceCount += 1
	if (source.at < existing.firstSeenAt) existing.firstSeenAt = source.at
	if (source.at > existing.lastSeenAt) existing.lastSeenAt = source.at
	// The longest surface form wins — "Ashguard Riders" reads better than the
	// "Ashguard" some other passage used, and both are the same key.
	if (row.surface.length > existing.surface.length)
		existing.surface = row.surface

	// Lexicographic on (mentions, timestamp, id) — spelled out rather than
	// folded into one expression, because a total order that reads as clever is
	// how the recency tie-break got written unreachable the first time.
	const incoming: [number, number, number] = [
		mentions,
		source.at.getTime(),
		source.id
	]
	const held: [number, number, number] = [
		existing.exampleWeight,
		existing.exampleAt.getTime(),
		existing.exampleSourceId
	]
	let better = false
	for (let i = 0; i < incoming.length; i++) {
		if (incoming[i] === held[i]) continue
		better = incoming[i]! > held[i]!
		break
	}
	if (better) {
		existing.exampleContext = exampleAround(source.text, row.spans[0])
		existing.exampleSourceKind = source.kind
		existing.exampleSourceId = source.id
		existing.exampleWeight = mentions
		existing.exampleAt = source.at
	}
}

/**
 * Every open-tier name in one lorebook, grouped, with how much of the book was
 * actually read to find them.
 *
 * ⚠ **Derivation only — this writes nothing.** `reconcileSuggestions` is what
 * turns a scan into rows, and the split is the plan's §1 rule made structural:
 * the thing that can be recomputed has no side effects, so it can be run twice,
 * in a test, or against a book nobody has decided anything about.
 */
export async function scanCandidates(
	db: Db,
	lorebookId: number,
	vocabularyOverride?: AnnotationVocabulary
): Promise<CandidateScan> {
	const vocabulary =
		vocabularyOverride ?? (await loadVocabulary(db, lorebookId))
	const into = new Map<string, Accumulator>()

	/**
	 * ⚠ **Sources first, annotations second — never one joined query.**
	 *
	 * The obvious shape is a single join projecting the annotation columns
	 * *and* the source text. It is wrong by a factor of `MAX_ENTITIES`: an entry
	 * has up to 32 annotation rows, so its content — bounded only by
	 * `MAX_ANNOTATED_LENGTH`, twenty thousand characters, and a pasted lore
	 * document really does reach that — comes back thirty-two times. A hundred
	 * such entries is tens of megabytes crossing the wire to be thrown away.
	 *
	 * Two reads and an in-memory join instead. The source read doubles as the
	 * coverage denominator, so this is also one query fewer than the joined
	 * version needed.
	 */

	// ── Entries ───────────────────────────────────────────────────────────
	const entries = await db
		.select({
			id: schema.lorebookEntries.id,
			createdAt: schema.lorebookEntries.createdAt,
			title: schema.lorebookEntries.title,
			keys: schema.lorebookEntries.keys,
			content: schema.lorebookEntries.content,
			currentHash: annotationTextHash.entry
		})
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.lorebookId, lorebookId))
	const entryById = new Map(entries.map((e) => [e.id, e]))

	const entryRows = entries.length
		? await db
				.select({
					entryId: schema.entryAnnotations.entryId,
					entityKey: schema.entryAnnotations.entityKey,
					surface: schema.entryAnnotations.surface,
					mentions: schema.entryAnnotations.mentions,
					spans: schema.entryAnnotations.spans,
					extractorVersion: schema.entryAnnotations.extractorVersion,
					sourceHash: schema.entryAnnotations.sourceHash,
					gazetteerHash: schema.entryAnnotations.gazetteerHash
				})
				.from(schema.entryAnnotations)
				.innerJoin(
					schema.lorebookEntries,
					eq(
						schema.lorebookEntries.id,
						schema.entryAnnotations.entryId
					)
				)
				.where(eq(schema.lorebookEntries.lorebookId, lorebookId))
		: []

	const freshEntries = new Set<number>()
	for (const row of entryRows) {
		if (row.extractorVersion !== EXTRACTOR_VERSION) continue
		if (row.gazetteerHash !== vocabulary.hash) continue
		const entry = entryById.get(row.entryId)
		if (!entry) continue
		if (row.sourceHash !== entry.currentHash) continue
		const text = entryAnnotationText(entry)
		// Counted before the tier filter: a source that was examined and named
		// nothing has been examined, and the sentinel is how it says so.
		freshEntries.add(row.entryId)
		if (!row.entityKey.startsWith(OPEN_TIER_PREFIX)) continue
		offer(
			into,
			{
				entityKey: row.entityKey,
				surface: row.surface,
				mentions: row.mentions,
				spans: row.spans
			},
			{
				kind: "entry",
				id: row.entryId,
				at: entry.createdAt,
				text
			}
		)
	}

	// ── Messages ──────────────────────────────────────────────────────────
	//
	// Scoped through `sessions.lorebookId`, which is not a preference: it is the
	// column `annotations/queue.ts` reads to decide which vocabulary a session's
	// messages were annotated against. Widening it to any other book would
	// sweep in rows whose `gazetteerHash` was computed from a *different*
	// book, and every one of them would then fail the freshness check anyway —
	// silently, and after the work of fetching them.
	//
	// Driven from `messages` and joined to `session_messages` for the text, the
	// way `annotateSessionMessages` is: the annotation's foreign key points at
	// `messages`, so a legacy row the store never mirrored is simply not
	// annotated and has nothing to count.
	const messages = await db
		.select({
			id: schema.messages.id,
			createdAt: schema.messages.createdAt,
			content: schema.sessionMessages.content,
			isHidden: schema.sessionMessages.isHidden,
			currentHash: annotationTextHash.message
		})
		.from(schema.messages)
		.innerJoin(
			schema.sessionMessages,
			eq(schema.sessionMessages.id, schema.messages.id)
		)
		.innerJoin(
			schema.sessions,
			eq(schema.sessions.id, schema.messages.sessionId)
		)
		.where(eq(schema.sessions.lorebookId, lorebookId))
	const messageById = new Map(messages.map((m) => [m.id, m]))

	const messageRows = messages.length
		? await db
				.select({
					messageId: schema.messageAnnotations.messageId,
					entityKey: schema.messageAnnotations.entityKey,
					surface: schema.messageAnnotations.surface,
					mentions: schema.messageAnnotations.mentions,
					spans: schema.messageAnnotations.spans,
					extractorVersion:
						schema.messageAnnotations.extractorVersion,
					sourceHash: schema.messageAnnotations.sourceHash,
					gazetteerHash: schema.messageAnnotations.gazetteerHash
				})
				.from(schema.messageAnnotations)
				.innerJoin(
					schema.messages,
					eq(schema.messages.id, schema.messageAnnotations.messageId)
				)
				.innerJoin(
					schema.sessions,
					eq(schema.sessions.id, schema.messages.sessionId)
				)
				.where(eq(schema.sessions.lorebookId, lorebookId))
		: []

	const freshMessages = new Set<number>()
	for (const row of messageRows) {
		if (row.extractorVersion !== EXTRACTOR_VERSION) continue
		if (row.gazetteerHash !== vocabulary.hash) continue
		const message = messageById.get(row.messageId)
		if (!message) continue
		if (row.sourceHash !== message.currentHash) continue
		const text = (message.content ?? "").slice(0, MAX_ANNOTATED_LENGTH)
		freshMessages.add(row.messageId)
		// A hidden message is not part of the conversation the prompt path
		// reads (`searchMessageAnnotations` excludes it for that reason), so a
		// name only it says is not something to propose. It still counts as
		// annotated above — it was examined.
		if (message.isHidden) continue
		if (!row.entityKey.startsWith(OPEN_TIER_PREFIX)) continue
		offer(
			into,
			{
				entityKey: row.entityKey,
				surface: row.surface,
				mentions: row.mentions,
				spans: row.spans
			},
			{
				kind: "message",
				id: row.messageId,
				at: message.createdAt,
				text
			}
		)
	}

	return {
		candidates: [...into.values()]
			.map(({ exampleWeight: _w, ...c }) => c)
			// Most-mentioned first, then the name, so the order is stable across
			// scans of an unchanged book.
			.sort(
				(a, b) =>
					b.occurrences - a.occurrences ||
					a.entityKey.localeCompare(b.entityKey)
			),
		coverage: {
			entries: {
				annotated: freshEntries.size,
				total: entries.length
			},
			messages: {
				annotated: freshMessages.size,
				total: messages.length
			}
		}
	}
}

/**
 * Write a scan into the log, without touching what anyone decided.
 *
 * ⚠ **`status` is never in the `SET` list, and that is the whole feature.** The
 * upsert refreshes the derived half — count, dates, surface, example — on every
 * scan, so an existing row's evidence stays current; it leaves `status`,
 * `decided_at` and `resolved_binding_id` exactly as the human left them. That is
 * what makes `ignored` suppress *re-suggestion* rather than suppress the row: a
 * dismissed name is re-derived on every single scan (nothing about ignoring it
 * changes the transcript), lands here, and comes back out of `listSuggestions`
 * in the dismissal log instead of the pending list.
 *
 * A candidate that has **stopped** being derived — its text was edited, or the
 * vocabulary widened until the name resolves — keeps its row. It is a decision
 * that was made, and the log is the point.
 */
export async function reconcileSuggestions(
	db: Db,
	lorebookId: number,
	candidates: readonly SuggestionCandidate[]
): Promise<void> {
	if (!candidates.length) return
	await db
		.insert(schema.bindingSuggestions)
		.values(
			candidates.map((c) => ({
				lorebookId,
				entityKey: c.entityKey,
				surface: c.surface,
				occurrences: c.occurrences,
				sourceCount: c.sourceCount,
				firstSeenAt: c.firstSeenAt,
				lastSeenAt: c.lastSeenAt,
				exampleContext: c.exampleContext,
				exampleSourceKind: c.exampleSourceKind,
				exampleSourceId: c.exampleSourceId
			}))
		)
		.onConflictDoUpdate({
			target: [
				schema.bindingSuggestions.lorebookId,
				schema.bindingSuggestions.entityKey
			],
			set: {
				surface: sql`excluded.surface`,
				occurrences: sql`excluded.occurrences`,
				sourceCount: sql`excluded.source_count`,
				// `least`/`greatest`, not the excluded value outright: a source
				// annotated late is older than what is already recorded, and
				// overwriting would make the first sighting march forward.
				firstSeenAt: sql`least(${schema.bindingSuggestions.firstSeenAt}, excluded.first_seen_at)`,
				lastSeenAt: sql`greatest(${schema.bindingSuggestions.lastSeenAt}, excluded.last_seen_at)`,
				exampleContext: sql`excluded.example_context`,
				exampleSourceKind: sql`excluded.example_source_kind`,
				exampleSourceId: sql`excluded.example_source_id`,
				updatedAt: new Date()
			}
		})
}

/** One row on the wire, with the derived and decided halves side by side. */
export interface SuggestionRow {
	id: number
	lorebookId: number
	entityKey: string
	/** The bare name — `entityKey` without the tier prefix. */
	name: string
	surface: string
	status: SuggestionStatus
	occurrences: number
	sourceCount: number
	firstSeenAt: string
	lastSeenAt: string
	exampleContext: string
	exampleSourceKind: string
	exampleSourceId: number | null
	resolvedBindingId: number | null
	decidedAt: string | null
	/**
	 * Whether the latest scan still derives this candidate.
	 *
	 * ⚠ A row can outlive its evidence — the passage was edited, or the
	 * vocabulary widened until the name resolves to a real row. The decision
	 * stays (that is the log), but the list must not claim the story still says
	 * it. Nothing else in the payload can express that difference.
	 */
	stillPresent: boolean
}

const iso = (d: Date | null | undefined) =>
	d instanceof Date ? d.toISOString() : d ? new Date(d).toISOString() : null

/** Read the log back, newest evidence first. */
export async function listSuggestions(
	db: Db,
	lorebookId: number,
	presentKeys: ReadonlySet<string>
): Promise<SuggestionRow[]> {
	const rows = await db
		.select()
		.from(schema.bindingSuggestions)
		.where(eq(schema.bindingSuggestions.lorebookId, lorebookId))

	return rows
		.map((r) => ({
			id: r.id,
			lorebookId: r.lorebookId,
			entityKey: r.entityKey,
			name: r.entityKey.startsWith(OPEN_TIER_PREFIX)
				? r.entityKey.slice(OPEN_TIER_PREFIX.length)
				: r.entityKey,
			surface: r.surface,
			status: (isSuggestionStatus(r.status)
				? r.status
				: "pending") as SuggestionStatus,
			occurrences: r.occurrences,
			sourceCount: r.sourceCount,
			firstSeenAt: iso(r.firstSeenAt) ?? "",
			lastSeenAt: iso(r.lastSeenAt) ?? "",
			exampleContext: r.exampleContext,
			exampleSourceKind: r.exampleSourceKind,
			exampleSourceId: r.exampleSourceId,
			resolvedBindingId: r.resolvedBindingId,
			decidedAt: iso(r.decidedAt),
			stillPresent: presentKeys.has(r.entityKey)
		}))
		.sort(
			(a, b) =>
				b.occurrences - a.occurrences ||
				a.entityKey.localeCompare(b.entityKey)
		)
}

/**
 * Scan, reconcile, and read back — the whole cycle one `list` performs.
 *
 * ⚠ **A scan runs on every list, not on a schedule.** The candidates are derived,
 * so the only way for the list to be wrong is for it to be old; deriving at read
 * time is what makes the widening lane's improvements show up the moment they
 * land, with no invalidation to get wrong. The cost is two indexed reads over one
 * book's annotations, which is the same order as the ranker's own scan.
 */
export async function refreshSuggestions(
	db: Db,
	lorebookId: number
): Promise<{ suggestions: SuggestionRow[]; coverage: AnnotationCoverage }> {
	const { candidates, coverage } = await scanCandidates(db, lorebookId)
	await reconcileSuggestions(db, lorebookId, candidates)
	const suggestions = await listSuggestions(
		db,
		lorebookId,
		new Set(candidates.map((c) => c.entityKey))
	)
	return { suggestions, coverage }
}

/** The suggestion row, if the asking user owns the book it belongs to. */
export async function findOwnedSuggestion(
	db: Db,
	suggestionId: number,
	userId: number
) {
	const [row] = await db
		.select({
			id: schema.bindingSuggestions.id,
			lorebookId: schema.bindingSuggestions.lorebookId,
			entityKey: schema.bindingSuggestions.entityKey,
			surface: schema.bindingSuggestions.surface,
			status: schema.bindingSuggestions.status,
			resolvedBindingId: schema.bindingSuggestions.resolvedBindingId,
			lorebookName: schema.lorebooks.name
		})
		.from(schema.bindingSuggestions)
		.innerJoin(
			schema.lorebooks,
			eq(schema.lorebooks.id, schema.bindingSuggestions.lorebookId)
		)
		.where(
			and(
				eq(schema.bindingSuggestions.id, suggestionId),
				eq(schema.lorebooks.userId, userId)
			)
		)
	return row
}

/**
 * Names already spoken for in this book, normalised the way an entity key is.
 *
 * `add` consults this so a suggestion cannot mint a second binding for a name a
 * binding already answers to. The union is `bindingNames`' — name ∪ aliases ∪
 * absorbedAliases — read through the schema rather than re-spelled, because two
 * spellings of *"what names refer to this character"* is exactly the drift
 * `bindingNames` exists to prevent. A name a cast amendment gives a member
 * is theirs too, on any line (plan C1 — the vocabulary's own rule).
 */
export async function takenNames(
	db: Db,
	lorebookId: number
): Promise<Set<string>> {
	const rows = await db
		.select({
			name: schema.lorebookBindings.name,
			aliases: schema.lorebookBindings.aliases,
			absorbedAliases: schema.lorebookBindings.absorbedAliases
		})
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
	const out = new Set<string>()
	const taken = (name: string) =>
		out.add(name.toLowerCase().replace(/\s+/g, " ").trim())
	for (const row of rows) for (const name of bindingNames(row)) taken(name)
	for (const names of (await amendedNamesOf(db, lorebookId)).cast.values())
		for (const name of names) taken(name)
	return out
}
