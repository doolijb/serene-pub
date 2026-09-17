/**
 * Annotations — what a passage names, persisted (design §13.2–§13.4).
 *
 * `ranking/entities.ts` is the extractor and knows nothing about a table. This
 * is the half that owns the tables: it builds the vocabulary a lorebook matches
 * against, decides what is stale, writes rows, and reads them back for the
 * entity arm. Nothing here scores — that is `ranking/entitySearch.ts`.
 *
 * ## One vocabulary, or the two sides never meet
 *
 * The entity arm intersects *what the conversation named* with *what a row
 * names*, and both sides are keys out of `buildGazetteer`. So the two must be
 * built from the **same** vocabulary or they compare different alphabets: a
 * window that resolved "Alice" to `character:5` would never meet an entry whose
 * annotation says `open:alice`. The vocabulary is therefore scoped to **the
 * lorebook**, not to the session — bindings (with their alias union) plus the
 * book's own entry titles — so every session over one book agrees, entry rows
 * and message rows agree, and the identity of that vocabulary rides on every
 * row as `gazetteer_hash`.
 *
 * A session with no lorebook gets the empty vocabulary, which is a working
 * state rather than a broken one: both sides fall to the open tier and their
 * keys still agree.
 *
 * ## Freshness is a triple, and staleness is never silent
 *
 * `(extractorVersion, sourceHash, gazetteerHash)`. Content moved, the extractor
 * moved, or the vocabulary moved — any of the three and the stored answer is
 * not an answer about the row as it is now. Design §13.3's rule is that
 * staleness degrades to **correct-and-verbose, never silently-wrong**, and the
 * two regimes honour it differently because §13.4 gives them different cost
 * profiles:
 *
 *   - **Entries** — small N, changes rarely. Re-extracted in place before the
 *     arm reads them, so a stale entry is *repaired*, not skipped.
 *   - **Messages** — high volume, conversation cadence, and extraction must
 *     never block a turn. A stale or missing message annotation is **not used
 *     as evidence this turn** (a hit justified by text that no longer says it
 *     is the silent wrongness) and is re-annotated by the capped background
 *     pass.
 */

import crypto from "crypto"
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm"
import type { PgColumn } from "drizzle-orm/pg-core"
import * as schema from "$lib/server/db/schema"
import {
	EXTRACTOR_VERSION,
	bindingNames,
	buildGazetteer,
	extractEntities,
	EMPTY_GAZETTEER,
	type Entity,
	type Gazetteer,
	type GazetteerName,
	type ModelSpan
} from "$lib/server/pipelines/ranking/entities"

// db is the global Db — see db/types.d.ts

/**
 * The two annotation tables, as one parameter.
 *
 * `entry_annotations` and `message_annotations` are the same shape over
 * different parents, and the pass/read helpers below are written once against
 * both. Named as a union rather than left `any` so the *columns* named on it
 * are checked — which is the whole point, since the columns are what a rename
 * would break silently.
 */
type AnnotationTable =
	| typeof schema.entryAnnotations
	| typeof schema.messageAnnotations

/**
 * What one extraction is allowed to read.
 *
 * `vectorizationQueue.MAX_EMBED_INPUT_LENGTH`'s cap, borrowed rather than
 * re-argued: every text column here is unbounded, a pasted megabyte is a real
 * thing users do, and the matcher is one alternation run over the whole string.
 * Truncation costs the tail of one enormous row and protects every turn on that
 * book. The stored content is untouched — this bounds only what the extractor
 * is handed.
 */
export const MAX_ANNOTATED_LENGTH = 20_000

/**
 * How many rows one pass re-annotates.
 *
 * The truncation half of the discipline §13.4 points at: a pass does a bounded
 * amount of work and the next one continues, rather than one turn paying for a
 * whole session's backlog. Entries converge in one pass on any ordinary book;
 * messages converge over several turns, oldest last.
 */
export const ANNOTATION_BATCH = 200

/**
 * Tier zero's spans for one passage, or none.
 *
 * `modelId` is the identity the lane took a LEASE on. Two things follow from
 * reading it here rather than asking the runtime what is loaded:
 *
 *  - **Nothing is loaded by this path.** Residency is the broker's, so an
 *    annotate call that arrives with nothing resident contributes no spans
 *    rather than starting a 100MB download inside whoever asked first.
 *  - **A model that was swapped underneath the pass contributes nothing.** The
 *    resident identity is compared against the leased one, so spans from a
 *    different model never land in a row whose neighbours came from this one.
 *
 * Never throws. An extraction that fails is a subtracted signal — the lexical
 * tiers still answer, and the row is still written — which is the governing rule
 * for every optional mechanism in the retrieval stack.
 */
async function modelSpansFor(
	text: string,
	modelId: string | null | undefined
): Promise<ModelSpan[]> {
	if (!modelId || !text) return []
	try {
		const { extractNerSpans, getLoadedNerModelId } = await import(
			"$lib/server/ner"
		)
		if (getLoadedNerModelId() !== modelId) return []
		return await extractNerSpans(text)
	} catch (err) {
		console.warn("[annotations] entity model produced nothing:", err)
		return []
	}
}

/** Short digests: enough to distinguish, short enough to store on every row. */
const digest = (value: string) =>
	crypto.createHash("sha256").update(value).digest("hex").slice(0, 16)

/** The vocabulary one lorebook matches against, and its identity. */
export interface AnnotationVocabulary {
	gazetteer: Gazetteer
	/** Changes when a name does. Part of every row's freshness triple. */
	hash: string
}

/** `gazetteerHash` of nothing — a session with no lorebook, and a real state. */
export const EMPTY_VOCABULARY: AnnotationVocabulary = {
	gazetteer: EMPTY_GAZETTEER,
	hash: digest("")
}

/**
 * The vocabulary of one lorebook.
 *
 * Cast first, entries second, because `buildGazetteer` lets the first claimant
 * of a name keep it and a character called "Vell" should resolve to the
 * character rather than to an entry titled after her.
 *
 * An unbound binding — a background NPC the graph minted, naming no character
 * — contributes nothing here. There is no row for it to resolve
 * *to*: `EntityRef` names a character or an entry, and inventing a
 * third kind is a schema decision this seam should not make on its own. Its
 * name is still extracted, as an open-tier string, which is exactly plan Part
 * 2's *"references that don't resolve yet"*.
 */
export async function loadVocabulary(
	db: Db,
	lorebookId: number | null | undefined
): Promise<AnnotationVocabulary> {
	if (lorebookId == null) return EMPTY_VOCABULARY

	const [bindings, entries] = await Promise.all([
		db
			.select({
				characterId: schema.lorebookBindings.characterId,
				name: schema.lorebookBindings.name,
				aliases: schema.lorebookBindings.aliases,
				absorbedAliases: schema.lorebookBindings.absorbedAliases
			})
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
			.orderBy(asc(schema.lorebookBindings.id)),
		db
			.select({
				id: schema.lorebookEntries.id,
				title: schema.lorebookEntries.title
			})
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, lorebookId))
			.orderBy(asc(schema.lorebookEntries.id))
	])

	const names: GazetteerName[] = []
	for (const binding of bindings) {
		const ref =
			binding.characterId != null
				? ({ kind: "character", id: binding.characterId } as const)
				: null
		if (!ref) continue
		for (const name of bindingNames(binding)) names.push({ name, ref })
	}
	for (const entry of entries)
		if (typeof entry.title === "string" && entry.title.trim())
			names.push({
				name: entry.title.trim(),
				ref: { kind: "entry", id: entry.id }
			})

	const gazetteer = buildGazetteer(names)
	return {
		gazetteer,
		/**
		 * Hashed over the compiled *keys*, not the names handed in, so the
		 * identity describes what the matcher will actually do. A title that
		 * contributes a new distinctive token (§13.9) changes extraction
		 * without changing any name, and this is what notices.
		 */
		hash: digest(
			[...gazetteer.byName]
				.map(([name, ref]) => `${name}\0${ref.kind}:${ref.id}`)
				.sort()
				.join("\u0001")
		)
	}
}

/** What the extractor is handed for one entry — title, keys and content. */
export const entryAnnotationText = (row: {
	title?: string | null
	keys?: string[] | string | null
	content?: string | null
}): string =>
	`${row.title ?? ""} ${
		Array.isArray(row.keys) ? row.keys.join(", ") : (row.keys ?? "")
	} ${row.content ?? ""}`.slice(0, MAX_ANNOTATED_LENGTH)

export const contentHash = (text: string) => digest(text)

/**
 * One entry's content identity — `entry_annotations.source_hash`, as a value
 * anything may compute.
 *
 * Exported because a **second** reader now needs the same fact for a different
 * question. The lane asks *is this row's annotation stale*; a run receipt asks
 * *is this row still what my run scored*, and both are "did title, keys or
 * content move". Two hashes over the same three columns would be the dual-source
 * drift this codebase keeps finding — one that says "changed" while the other
 * says "fresh", with nothing to say which is right — so there is one recipe and
 * this is it.
 *
 * ⚠ Over the **stored** columns, deliberately, and not over the hydrated text a
 * scan actually matched against. `{{char:1}}` substitution and `@@` decorator
 * stripping happen at the pipeline's read (`host.ts` `lorebook_entries`), so
 * renaming a bound character changes what was scored without moving this. That
 * is the same blind spot the annotation lane already has, which is the argument
 * for it rather than against: "this entry's content moved" means one thing
 * everywhere, and the two surfaces cannot disagree about an entry.
 */
export const entrySourceHash = (row: {
	title?: string | null
	keys?: string[] | string | null
	content?: string | null
}): string => contentHash(entryAnnotationText(row))

/**
 * ⚠ The empty-extraction sentinel — see the `entry_annotations` schema note.
 *
 * A passage that names nothing still gets a row, because "no rows" has to mean
 * exactly one thing: never extracted. Without it every silent passage is
 * re-extracted forever. It cannot collide with a real entity key: keys are
 * `<kind>:<id>` or `open:<name>`, and no window produces the empty string.
 */
const NO_ENTITIES_KEY = ""

interface AnnotationValues {
	entityKey: string
	surface: string
	normalized: string
	tier: string
	characterId: number | null
	refEntryId: number | null
	confidence: number
	mentions: number
	spans: Array<{ start: number; end: number }>
	extractorVersion: string
	sourceHash: string
	gazetteerHash: string
}

/**
 * The tier's prior. Not a calibrated probability — see the schema note.
 *
 * A dictionary hit matched a name somebody declared; an open hit is a guess
 * about capitalisation. Nothing scores with this today, deliberately: weighting
 * by it would make the entity arm and the admission gate disagree about the
 * same entity, and the gate's numbers are measured.
 */
const CONFIDENCE: Record<string, number> = { gazetteer: 1, open: 0.5 }

/**
 * ⚠ No `model` entry, deliberately. A model tier entity carries the model's OWN
 * score on `Entity.confidence`, and a prior here would be a number that
 * overwrote a measurement.
 */

const valuesFor = (
	entities: readonly Entity[],
	sourceHash: string,
	gazetteerHash: string
): AnnotationValues[] => {
	const base = {
		extractorVersion: EXTRACTOR_VERSION,
		sourceHash,
		gazetteerHash
	}
	if (entities.length === 0)
		return [
			{
				entityKey: NO_ENTITIES_KEY,
				surface: "",
				normalized: "",
				tier: "none",
				characterId: null,
				refEntryId: null,
				confidence: 0,
				mentions: 0,
				spans: [],
				...base
			}
		]
	return entities.map((e) => ({
		entityKey: e.key,
		surface: e.text,
		normalized: e.text.toLowerCase().replace(/\s+/g, " ").trim(),
		tier: e.tier,
		characterId: e.ref?.kind === "character" ? e.ref.id : null,
		refEntryId: e.ref?.kind === "entry" ? e.ref.id : null,
		confidence: e.confidence ?? CONFIDENCE[e.tier] ?? 0.5,
		mentions: e.count,
		spans: e.spans,
		...base
	}))
}

/**
 * Replace one parent's annotations.
 *
 * An extraction is a *whole* answer, so an entity the text no longer names has
 * to disappear — but **upsert first, then delete what left the set**, never
 * delete-then-insert. `upsertProjection` in the message store does the same
 * thing for the same reason: two passes over one row really can interleave here
 * (a lorebook write's fire-and-forget pass and a turn's repair), and
 * delete-A/delete-B/insert-A/insert-B makes the second insert collide on the
 * primary key. Both passes compute the same rows from the same text, so an
 * upsert converges instead of raising; a blanket delete a sibling is about to
 * re-insert into does not.
 */
async function writeAnnotations(
	db: Db,
	table: AnnotationTable,
	parentColumn: PgColumn,
	parentKey: string,
	parentId: number,
	values: AnnotationValues[]
): Promise<void> {
	if (values.length)
		await db
			.insert(table)
			.values(values.map((v) => ({ [parentKey]: parentId, ...v })))
			.onConflictDoUpdate({
				target: [parentColumn, table.entityKey],
				set: {
					surface: sql`excluded.surface`,
					normalized: sql`excluded.normalized`,
					tier: sql`excluded.tier`,
					characterId: sql`excluded.character_id`,
					refEntryId: sql`excluded.ref_entry_id`,
					confidence: sql`excluded.confidence`,
					mentions: sql`excluded.mentions`,
					spans: sql`excluded.spans`,
					extractorVersion: sql`excluded.extractor_version`,
					sourceHash: sql`excluded.source_hash`,
					gazetteerHash: sql`excluded.gazetteer_hash`,
					annotatedAt: sql`excluded.annotated_at`
				}
			})
	await db.delete(table).where(
		and(
			eq(parentColumn, parentId),
			values.length
				? notInArray(
						table.entityKey,
						values.map((v) => v.entityKey)
					)
				: sql`true`
		)
	)
}

export interface AnnotationPassReport {
	/** Rows whose freshness triple was checked. */
	examined: number
	/** Rows re-extracted and written. */
	written: number
	/** Rows left because the batch cap was reached — the next pass takes them. */
	deferred: number
}

interface StoredFreshness {
	sourceHash: string
	gazetteerHash: string
	version: string
}

/** `parentId -> the freshness triple currently stored`, for one parent set. */
async function freshnessOf(
	db: Db,
	table: AnnotationTable,
	parentColumn: PgColumn,
	ids: readonly number[]
): Promise<Map<number, StoredFreshness>> {
	const out = new Map<number, StoredFreshness>()
	if (!ids.length) return out
	const rows = await db
		.select({
			parentId: parentColumn,
			sourceHash: table.sourceHash,
			gazetteerHash: table.gazetteerHash,
			version: table.extractorVersion
		})
		.from(table)
		.where(inArray(parentColumn, ids as number[]))
	// Every row of one parent carries the same triple by construction — they
	// are written together — so the first one seen is that parent's answer.
	for (const row of rows)
		if (!out.has(row.parentId))
			out.set(row.parentId, {
				sourceHash: row.sourceHash,
				gazetteerHash: row.gazetteerHash,
				version: row.version
			})
	return out
}

const isFresh = (
	stored: StoredFreshness | undefined,
	sourceHash: string,
	gazetteerHash: string
): boolean =>
	stored !== undefined &&
	stored.version === EXTRACTOR_VERSION &&
	stored.sourceHash === sourceHash &&
	stored.gazetteerHash === gazetteerHash

/**
 * Bring a set of entries' annotations up to date.
 *
 * Entries are §13.4's small-N regime, so this is *repair* rather than a
 * background hope: a caller that awaits it can rely on every id it named being
 * annotated for the current content and vocabulary, up to `limit`.
 */
export async function annotateEntries(
	db: Db,
	entryIds: readonly number[],
	vocabulary: AnnotationVocabulary,
	opts: { limit?: number; modelId?: string | null } = {}
): Promise<AnnotationPassReport> {
	const limit = opts.limit ?? ANNOTATION_BATCH
	if (!entryIds.length) return { examined: 0, written: 0, deferred: 0 }

	const rows = await db
		.select({
			id: schema.lorebookEntries.id,
			title: schema.lorebookEntries.title,
			keys: schema.lorebookEntries.keys,
			content: schema.lorebookEntries.content
		})
		.from(schema.lorebookEntries)
		.where(inArray(schema.lorebookEntries.id, entryIds as number[]))

	const stored = await freshnessOf(
		db,
		schema.entryAnnotations,
		schema.entryAnnotations.entryId,
		rows.map((r) => r.id)
	)

	let written = 0
	let deferred = 0
	for (const row of rows) {
		const text = entryAnnotationText(row)
		const sourceHash = contentHash(text)
		if (isFresh(stored.get(row.id), sourceHash, vocabulary.hash)) continue
		if (written >= limit) {
			deferred++
			continue
		}
		const { entities } = extractEntities(
			text,
			vocabulary.gazetteer,
			await modelSpansFor(text, opts.modelId)
		)
		await writeAnnotations(
			db,
			schema.entryAnnotations,
			schema.entryAnnotations.entryId,
			"entryId",
			row.id,
			valuesFor(entities, sourceHash, vocabulary.hash)
		)
		written++
	}
	return { examined: rows.length, written, deferred }
}

/**
 * Annotate **one** row, unconditionally — the annotation lane's unit of work.
 *
 * The difference from `annotateEntries` is who decides. That function is handed
 * a set and filters it by the freshness triple; this one is handed a row a
 * picker has *already* decided is stale, extracts, and writes. It writes even
 * when the recomputed hashes turn out to match, and that is deliberate rather
 * than wasteful: `annotated_at` is what the picker's SQL predicate compares
 * against, so a pass that examined a row and wrote nothing would leave the
 * predicate true and the picker would hand the same row back for ever. One
 * upsert closes the loop; the extraction it costs is a regex over at most
 * `MAX_ANNOTATED_LENGTH` characters.
 *
 * Returns `false` when the row is gone — a delete that raced the pick, which is
 * not a failure.
 */
export async function annotateEntry(
	db: Db,
	entryId: number,
	vocabulary: AnnotationVocabulary,
	/** The entity model the lane leased for this item, or null for a lexical pass. */
	modelId: string | null = null
): Promise<boolean> {
	const rows = await db
		.select({
			id: schema.lorebookEntries.id,
			title: schema.lorebookEntries.title,
			keys: schema.lorebookEntries.keys,
			content: schema.lorebookEntries.content
		})
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.id, entryId))
		.limit(1)
	const row = rows[0]
	if (!row) return false

	const text = entryAnnotationText(row)
	const { entities } = extractEntities(
		text,
		vocabulary.gazetteer,
		await modelSpansFor(text, modelId)
	)
	await writeAnnotations(
		db,
		schema.entryAnnotations,
		schema.entryAnnotations.entryId,
		"entryId",
		row.id,
		valuesFor(entities, contentHash(text), vocabulary.hash)
	)
	return true
}

/**
 * The same for one transcript row.
 *
 * ⚠ Driven from `messages` and joined to `session_messages` for the text, never
 * the other way round: the annotation's foreign key points at `messages`, so a
 * legacy row the store never mirrored has nothing to hang on and inserting for
 * it would raise.
 */
export async function annotateMessage(
	db: Db,
	messageId: number,
	vocabulary: AnnotationVocabulary,
	/** The entity model the lane leased for this item, or null for a lexical pass. */
	modelId: string | null = null
): Promise<boolean> {
	const rows = await db
		.select({
			id: schema.messages.id,
			content: schema.sessionMessages.content
		})
		.from(schema.messages)
		.innerJoin(
			schema.sessionMessages,
			eq(schema.sessionMessages.id, schema.messages.id)
		)
		.where(eq(schema.messages.id, messageId))
		.limit(1)
	const row = rows[0]
	if (!row) return false

	const text = (row.content ?? "").slice(0, MAX_ANNOTATED_LENGTH)
	const { entities } = extractEntities(
		text,
		vocabulary.gazetteer,
		await modelSpansFor(text, modelId)
	)
	await writeAnnotations(
		db,
		schema.messageAnnotations,
		schema.messageAnnotations.messageId,
		"messageId",
		row.id,
		valuesFor(entities, contentHash(text), vocabulary.hash)
	)
	return true
}

/**
 * Re-annotate a whole lorebook, in one bounded pass.
 *
 * One call covers both "never annotated" and "one entry changed", because the
 * freshness triple makes them the same question: a book nobody has annotated is
 * stale in every row and a book where one entry changed is stale in one.
 *
 * ⚠ **No longer the on-write hook.** `sockets/entries.ts` enqueues the book on
 * the annotation lane instead, so that a write and a query put their work in
 * the same place and one loop decides the order. This stays because it is the
 * whole-book pass a test can await, and because a caller that genuinely wants
 * one synchronously should have something to call that is not the queue.
 */
export async function annotateLorebook(
	db: Db,
	lorebookId: number,
	opts: { limit?: number; modelId?: string | null } = {}
): Promise<AnnotationPassReport> {
	const vocabulary = await loadVocabulary(db, lorebookId)
	const ids = (
		await db
			.select({ id: schema.lorebookEntries.id })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, lorebookId))
			.orderBy(asc(schema.lorebookEntries.id))
	).map((r) => r.id)
	return await annotateEntries(db, ids, vocabulary, opts)
}

/**
 * Annotate a bounded slice of a session's transcript, newest first.
 *
 * §13.4's other regime, and the reason it is its own function: **extraction must
 * never block a turn**, so nothing on the reply path awaits this. The arm reads
 * whatever is already annotated, and this walks backwards through the session at
 * `limit` messages a pass, so the searchable corpus converges over turns instead
 * of one turn paying for a whole session.
 *
 * Newest first because that is where relevance is — a scene is likeliest to be
 * re-treading its own recent past, and a backfill starting at message 1 would
 * leave the useful half until last.
 */
export async function annotateSessionMessages(
	db: Db,
	sessionId: number,
	vocabulary: AnnotationVocabulary,
	opts: { limit?: number; modelId?: string | null } = {}
): Promise<AnnotationPassReport> {
	const limit = opts.limit ?? ANNOTATION_BATCH

	/**
	 * Driven from `messages` and joined to `session_messages` for the text.
	 *
	 * ⚠ Not the other way round, and it is a constraint rather than a
	 * preference: the annotation's foreign key points at `messages`, so a
	 * legacy row the store never mirrored has nothing to hang on and inserting
	 * for it would raise. Driving from the parent means an unmirrored row is
	 * simply not annotated, which is the honest answer — the mirror is what
	 * makes a message part of the model.
	 *
	 * Candidates are read `limit * 2` deep and filtered in memory rather than
	 * asked for with a `NOT EXISTS`: the point is to walk backwards a bounded
	 * distance per pass, and a query that skipped everything already fresh
	 * would re-scan the whole session every time to find the frontier.
	 */
	const rows = await db
		.select({
			id: schema.messages.id,
			content: schema.sessionMessages.content
		})
		.from(schema.messages)
		.innerJoin(
			schema.sessionMessages,
			eq(schema.sessionMessages.id, schema.messages.id)
		)
		.where(eq(schema.messages.sessionId, sessionId))
		.orderBy(desc(schema.messages.id))
		.limit(limit * 2)

	const stored = await freshnessOf(
		db,
		schema.messageAnnotations,
		schema.messageAnnotations.messageId,
		rows.map((r) => r.id)
	)

	let written = 0
	let deferred = 0
	for (const row of rows) {
		const text = (row.content ?? "").slice(0, MAX_ANNOTATED_LENGTH)
		const sourceHash = contentHash(text)
		if (isFresh(stored.get(row.id), sourceHash, vocabulary.hash)) continue
		if (written >= limit) {
			deferred++
			continue
		}
		const { entities } = extractEntities(
			text,
			vocabulary.gazetteer,
			await modelSpansFor(text, opts.modelId)
		)
		await writeAnnotations(
			db,
			schema.messageAnnotations,
			schema.messageAnnotations.messageId,
			"messageId",
			row.id,
			valuesFor(entities, sourceHash, vocabulary.hash)
		)
		written++
	}
	return { examined: rows.length, written, deferred }
}

/**
 * ⚠ **There is no fire-and-forget pass here any more.** The lock-with-a-handle
 * that used to live at this seam — one background message pass per session,
 * started and not awaited — is the annotation lane's job now
 * (`annotations/queue.ts`), and `settleAnnotationQueue()` is what a test waits
 * on where it used to wait on `settleAnnotationPasses()`.
 *
 * The rule it enforced is unchanged and now belongs to the lane: **extraction
 * must never block a turn.** What changed is that "never blocks" stopped being
 * a detached promise nobody could see and became a queue with an order, a
 * bound, and a place for a turn to say *"index these ones first, I am waiting"*.
 */

/** `parentId -> the entity keys it names`, sentinel excluded. */
export type AnnotationIndex = Map<number, string[]>

/**
 * Which of a set of entries names which entities.
 *
 * Only rows whose freshness triple matches are returned. A stale row is not a
 * fact about the text as it stands, and returning it would justify a hit with
 * content that no longer says it — §13.3's silent wrongness. For entries this
 * rarely fires, because `annotateEntries` runs first; the filter is here because
 * "the repair ran" is an assumption and this is the reader.
 */
export async function readEntryAnnotations(
	db: Db,
	entryIds: readonly number[],
	vocabulary: AnnotationVocabulary
): Promise<AnnotationIndex> {
	const out: AnnotationIndex = new Map()
	if (!entryIds.length) return out
	const rows = await db
		.select({
			entryId: schema.entryAnnotations.entryId,
			entityKey: schema.entryAnnotations.entityKey,
			gazetteerHash: schema.entryAnnotations.gazetteerHash,
			version: schema.entryAnnotations.extractorVersion
		})
		.from(schema.entryAnnotations)
		.where(inArray(schema.entryAnnotations.entryId, entryIds as number[]))
	for (const row of rows) {
		if (row.version !== EXTRACTOR_VERSION) continue
		if (row.gazetteerHash !== vocabulary.hash) continue
		if (row.entityKey === NO_ENTITIES_KEY) {
			if (!out.has(row.entryId)) out.set(row.entryId, [])
			continue
		}
		const seen = out.get(row.entryId)
		if (seen) seen.push(row.entityKey)
		else out.set(row.entryId, [row.entityKey])
	}
	return out
}

export interface MessageAnnotationHit {
	id: number
	content: string
	keys: string[]
}

/**
 * The session's messages that name at least one of `entityKeys`.
 *
 * The scope join is on `messages` — the message model — because that is where
 * the annotation's foreign key points and where identity outlives the legacy
 * table; the text comes from `session_messages`, which is still the row the
 * prompt path reads and the one `isHidden` lives on.
 *
 * `beforeId` is the recent window's oldest id. The messages already in the
 * prompt verbatim are not something to retrieve, and offering them would spend
 * the budget twice on one span — the same exclusion the vector arm makes with
 * `excludeRecentMessages`.
 */
export async function searchMessageAnnotations(
	db: Db,
	sessionId: number,
	entityKeys: readonly string[],
	vocabulary: AnnotationVocabulary,
	opts: { beforeId?: number; limit?: number } = {}
): Promise<{ hits: MessageAnnotationHit[]; truncated: boolean }> {
	if (!entityKeys.length) return { hits: [], truncated: false }
	const limit = opts.limit ?? ANNOTATION_BATCH
	/**
	 * Reported, not inferred, for `diagnostics.truncated`'s reason in the vector
	 * arm: a capped search and a complete one produce results that look exactly
	 * alike, and the turn's best match may be in the remainder.
	 */
	let truncated = false

	const rows = await db
		.select({
			id: schema.messageAnnotations.messageId,
			entityKey: schema.messageAnnotations.entityKey,
			content: schema.sessionMessages.content,
			gazetteerHash: schema.messageAnnotations.gazetteerHash,
			version: schema.messageAnnotations.extractorVersion,
			sourceHash: schema.messageAnnotations.sourceHash
		})
		.from(schema.messageAnnotations)
		.innerJoin(
			schema.messages,
			eq(schema.messages.id, schema.messageAnnotations.messageId)
		)
		.innerJoin(
			schema.sessionMessages,
			eq(schema.sessionMessages.id, schema.messageAnnotations.messageId)
		)
		.where(
			and(
				eq(schema.messages.sessionId, sessionId),
				eq(schema.sessionMessages.isHidden, false),
				inArray(
					schema.messageAnnotations.entityKey,
					entityKeys as string[]
				),
				opts.beforeId === undefined
					? sql`true`
					: sql`${schema.messageAnnotations.messageId} < ${opts.beforeId}`
			)
		)
		.orderBy(desc(schema.messageAnnotations.messageId))

	const byId = new Map<number, MessageAnnotationHit>()
	for (const row of rows) {
		if (row.version !== EXTRACTOR_VERSION) continue
		if (row.gazetteerHash !== vocabulary.hash) continue
		/**
		 * A message whose text moved under its annotation is not evidence.
		 *
		 * §13.3, and the reason the content hash travels on the row: the
		 * message side is never repaired inline (extraction must not block a
		 * turn), so the reader is the only place that can refuse a claim about
		 * a sentence that has since been edited.
		 */
		const text = (row.content ?? "").slice(0, MAX_ANNOTATED_LENGTH)
		if (row.sourceHash !== contentHash(text)) continue
		const seen = byId.get(row.id)
		if (seen) seen.keys.push(row.entityKey)
		else if (byId.size < limit)
			byId.set(row.id, {
				id: row.id,
				content: row.content ?? "",
				keys: [row.entityKey]
			})
		else truncated = true
	}
	return { hits: [...byId.values()], truncated }
}
