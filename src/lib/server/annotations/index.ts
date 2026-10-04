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
	entityKey,
	extractEntities,
	EMPTY_GAZETTEER,
	type Entity,
	type EntityRef,
	type Gazetteer,
	type GazetteerName,
	type ModelSpan
} from "$lib/server/pipelines/ranking/entities"
import {
	castTag,
	castTagNumber,
	castTagSpans
} from "$lib/server/utils/castTags"

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
 * Tier zero's spans for one passage, or none — with the model that read it
 * (`ModelPass`).
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
): Promise<ModelPass> {
	const lexical: ModelPass = { spans: [], entityModel: null }
	if (!modelId || !text) return lexical
	try {
		const { extractNerSpans, getLoadedNerModelId } = await import(
			"$lib/server/ner"
		)
		if (getLoadedNerModelId() !== modelId) return lexical
		return { spans: await extractNerSpans(text), entityModel: modelId }
	} catch (err) {
		console.warn("[annotations] entity model produced nothing:", err)
		return lexical
	}
}

/**
 * Tier zero's answer for one passage: its spans, and the model that gave them.
 *
 * `entityModel` is the model's identity when it actually read the passage —
 * found nothing counts, it looked — and null for a lexical pass: no model
 * leased, a different one resident, or one that failed. It is what the rows are
 * stamped with (`entry_annotations.entity_model`), and what a move of the
 * entity star is judged against.
 */
interface ModelPass {
	spans: ModelSpan[]
	entityModel: string | null
}

/** Short digests: enough to distinguish, short enough to store on every row. */
const digest = (value: string) =>
	crypto.createHash("sha256").update(value).digest("hex").slice(0, 16)

/** The vocabulary one lorebook matches against, and its identity. */
export interface AnnotationVocabulary {
	gazetteer: Gazetteer
	/**
	 * What each cast tag (`{{char:N}}`) names: member number → the member's
	 * character, for every member bound to a live card. An entry's stored
	 * text names a member only by tag (the name is written in at the
	 * pipeline's read), so this is how its annotation reaches them
	 * (`entryEntities`).
	 */
	castTags: ReadonlyMap<number, EntityRef>
	/**
	 * Changes when a name does, or what a tag names. Part of every row's
	 * freshness triple.
	 */
	hash: string
}

/** `gazetteerHash` of nothing — a session with no lorebook, and a real state. */
export const EMPTY_VOCABULARY: AnnotationVocabulary = {
	gazetteer: EMPTY_GAZETTEER,
	castTags: new Map(),
	hash: digest("")
}

/**
 * Every name the book's amendments give its cast members and entries, on any
 * line and at any date — what `loadVocabulary` adds to the stored names
 * (plan C1). A cast amendment's `name` and `aliases` (`CAST_AMENDABLE`), an
 * entry amendment's `name` (the wire row's title). Trimmed, empty dropped,
 * in amendment order (id), so the vocabulary is the same on every read.
 */
export async function amendedNamesOf(
	db: Db,
	lorebookId: number
): Promise<{
	cast: Map<number, string[]>
	entries: Map<number, string[]>
}> {
	const [castRows, entryRows] = await Promise.all([
		db
			.select({
				memberId: schema.castAmendments.lorebookBindingId,
				fields: schema.castAmendments.fields
			})
			.from(schema.castAmendments)
			.where(eq(schema.castAmendments.lorebookId, lorebookId))
			.orderBy(asc(schema.castAmendments.id)),
		db
			.select({
				entryId: schema.entryAmendments.entryId,
				fields: schema.entryAmendments.fields
			})
			.from(schema.entryAmendments)
			.where(eq(schema.entryAmendments.lorebookId, lorebookId))
			.orderBy(asc(schema.entryAmendments.id))
	])
	const add = (into: Map<number, string[]>, id: number, raw: unknown) => {
		if (typeof raw !== "string" || !raw.trim()) return
		const list = into.get(id) ?? []
		if (!list.includes(raw.trim())) list.push(raw.trim())
		into.set(id, list)
	}
	const cast = new Map<number, string[]>()
	for (const row of castRows) {
		const fields = (row.fields ?? {}) as Record<string, unknown>
		add(cast, row.memberId, fields.name)
		if (Array.isArray(fields.aliases))
			for (const alias of fields.aliases) add(cast, row.memberId, alias)
	}
	const entries = new Map<number, string[]>()
	for (const row of entryRows)
		add(entries, row.entryId, ((row.fields ?? {}) as Record<string, unknown>).name)
	return { cast, entries }
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
 * 2's *"references that don't resolve yet"*. A member whose card was deleted
 * reads the same way (plan A25): a deleted card is nobody in a lorebook.
 *
 * **Amended names count (plan C1, owner ruling R1 "hybrid", 2026-09-30).** A
 * member renamed by a cast amendment, or an entry retitled by an entry
 * amendment, answers to the new name too: on every line, at every date. One
 * vocabulary per BOOK, not per reading, because the rows it stamps are the
 * book's (an entry's annotations and the cast suggestions are read by every
 * session), and a hash that moved with the reader would mark them stale for
 * every other one. So the names are a union — every stored name first (cast,
 * then entries, as before), then every name an amendment gives them, in
 * amendment order; the first claimant of a name still keeps it, so an
 * amended name never takes a name another member or entry already holds.
 * Without them a renamed member's new name read as nobody's, and the cast
 * suggestions offered it as a new member (plan A23(a)'s leftover).
 *
 * ⚠ Names only. What an entry SAYS for search by meaning stays its base text
 * (`embedding/ragContext.ts`); the ruling keeps content vectors on the base.
 */
export async function loadVocabulary(
	db: Db,
	lorebookId: number | null | undefined
): Promise<AnnotationVocabulary> {
	if (lorebookId == null) return EMPTY_VOCABULARY

	const [bindings, entries] = await Promise.all([
		db
			.select({
				id: schema.lorebookBindings.id,
				characterId: schema.lorebookBindings.characterId,
				cardDeleted: schema.characters.isDeleted,
				tag: schema.lorebookBindings.binding,
				name: schema.lorebookBindings.name,
				aliases: schema.lorebookBindings.aliases,
				absorbedAliases: schema.lorebookBindings.absorbedAliases
			})
			.from(schema.lorebookBindings)
			.leftJoin(
				schema.characters,
				eq(schema.characters.id, schema.lorebookBindings.characterId)
			)
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
	const amendedNames = await amendedNamesOf(db, lorebookId)

	const names: GazetteerName[] = []
	const castTags = new Map<number, EntityRef>()
	const castRefs: Array<[number, EntityRef]> = []
	for (const binding of bindings) {
		const ref =
			binding.characterId != null && binding.cardDeleted !== true
				? ({ kind: "character", id: binding.characterId } as const)
				: null
		if (!ref) continue
		castRefs.push([binding.id, ref])
		for (const name of bindingNames(binding)) names.push({ name, ref })
		const n = castTagNumber(binding.tag)
		if (n !== null) castTags.set(n, ref)
	}
	for (const [memberId, ref] of castRefs)
		for (const name of amendedNames.cast.get(memberId) ?? [])
			names.push({ name, ref })
	for (const entry of entries)
		if (typeof entry.title === "string" && entry.title.trim())
			names.push({
				name: entry.title.trim(),
				ref: { kind: "entry", id: entry.id }
			})
	for (const entry of entries)
		for (const name of amendedNames.entries.get(entry.id) ?? [])
			names.push({ name, ref: { kind: "entry", id: entry.id } })

	const gazetteer = buildGazetteer(names)

	/**
	 * The tags the names do not already speak for.
	 *
	 * A book binds a card to one member at most
	 * (`lorebook_bindings_character_unique`), so a `character:<id>` among the
	 * gazetteer's answers is that member's own name, and binding them to
	 * another card, or losing the card, moves that line of the hash already.
	 * Only a member who answers to no name of their own — a name another
	 * member claimed first, or one too short to match — needs their tag in the
	 * hash. So a book whose members each own a name keeps the hash it had,
	 * and nothing in it is re-annotated or re-embedded for the tags.
	 */
	const named = new Set([...gazetteer.byName.values()].map(entityKey))
	const unnamedTags = [...castTags]
		.filter(([, ref]) => !named.has(entityKey(ref)))
		.map(([n, ref]) => `${castTag(n)}\0${entityKey(ref)}`)

	return {
		gazetteer,
		castTags,
		/**
		 * Hashed over the compiled *keys*, not the names handed in, so the
		 * identity describes what the matcher will actually do. A title that
		 * contributes a new distinctive token (§13.9) changes extraction
		 * without changing any name, and this is what notices.
		 */
		hash: digest(
			[
				...[...gazetteer.byName].map(
					([name, ref]) => `${name}\0${ref.kind}:${ref.id}`
				),
				...unnamedTags
			]
				.sort()
				.join("\u0001")
		)
	}
}

/**
 * What the annotation lane reads for one entry, whole — title, keys and
 * content, one space apart. `lorebook_entries.annotation_text_hash` spells the
 * same recipe in SQL; `annotationTextHash.int.test.ts` pins the two equal.
 */
export const entryAnnotationSource = (row: {
	title?: string | null
	keys?: string[] | string | null
	content?: string | null
}): string =>
	`${row.title ?? ""} ${
		Array.isArray(row.keys) ? row.keys.join(", ") : (row.keys ?? "")
	} ${row.content ?? ""}`

/** What the extractor is handed for one entry: its source, cut to the bound. */
export const entryAnnotationText = (row: {
	title?: string | null
	keys?: string[] | string | null
	content?: string | null
}): string => entryAnnotationSource(row).slice(0, MAX_ANNOTATED_LENGTH)

export const contentHash = (text: string) => digest(text)

/**
 * One entry's content identity — `lorebook_entries.annotation_text_hash`, as a
 * value anything may compute.
 *
 * Exported because a **second** reader needs the same fact for a different
 * question. The lane asks *is this row's annotation stale*; a run receipt asks
 * *is this row still what my run scored*, and both are "did title, keys or
 * content move". Two hashes over the same three columns would be the dual-source
 * drift this codebase keeps finding — one that says "changed" while the other
 * says "fresh", with nothing to say which is right — so there is one recipe,
 * spelled here and in the column, and a test holds the two equal.
 *
 * Over the whole text, not the `MAX_ANNOTATED_LENGTH` cut the extractor reads:
 * an edit past the cut is still an edit, and the whole text is what SQL can
 * cut identically (JavaScript slices UTF-16 units, Postgres characters).
 *
 * ⚠ Over the **stored** columns, deliberately, and not over the hydrated text a
 * scan actually matched against. `{{char:1}}` substitution and `@@` decorator
 * stripping happen at the pipeline's read (`host.ts` `lorebook_entries`), so
 * renaming a bound character changes what was scored without moving this.
 * "This entry's content moved" means one thing everywhere, and the two
 * surfaces cannot disagree about an entry. The annotation lane reads a tag as
 * its member by number, never by name (`entryEntities`), so a rename moves
 * nothing it derives; what a tag names is the vocabulary's hash to track.
 */
export const entrySourceHash = (row: {
	title?: string | null
	keys?: string[] | string | null
	content?: string | null
}): string => contentHash(entryAnnotationSource(row))

/**
 * The hash of the text each annotated table is read from now, as a column —
 * what an annotation's `source_hash` must equal to be fresh (plan A23).
 *
 * Read in the same statement as the text a pass extracts from, and stamped on
 * the rows it writes, so what is hashed is what was read. The picker compares
 * the stored hash with the column in SQL, and every reader here does the same,
 * so no reader recomputes a digest and none can disagree with the picker.
 *
 *  - `entry` — `lorebook_entries.annotation_text_hash`, over
 *    `entryAnnotationSource`.
 *  - `message` — `session_messages.embed_text_hash`: a message is annotated
 *    from its content, which is exactly what it embeds, so the one GENERATED
 *    column answers both lanes.
 */
export const annotationTextHash = {
	entry: schema.lorebookEntries.annotationTextHash,
	message: schema.sessionMessages.embedTextHash
} as const

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
	entityModel: string | null
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
	gazetteerHash: string,
	entityModel: string | null
): AnnotationValues[] => {
	const base = {
		extractorVersion: EXTRACTOR_VERSION,
		sourceHash,
		gazetteerHash,
		entityModel
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
 * The entities an entry's text names: the extractor's, and its cast tags.
 *
 * `{{char:N}}` is written as the member's name only at the pipeline's read,
 * so the stored text the lane reads names a member by tag alone. Each tag is
 * read here as the member it names (`AnnotationVocabulary.castTags`), by
 * number, never through the name: `character:<id>`, a gazetteer answer, with
 * the tag as written for its surface and the tag's own offsets for its span.
 * A tag and the member's name in one entry are one entity, counted twice.
 * A background member's tag, or one with no member, names nobody, as the
 * vocabulary has nothing for them either.
 *
 * Past the extractor's `MAX_ENTITIES`: a book has few members, and a tag is
 * the surest mention an entry can make.
 */
export function entryEntities(
	text: string,
	vocabulary: AnnotationVocabulary,
	modelSpans: readonly ModelSpan[] = []
): Entity[] {
	const { entities } = extractEntities(text, vocabulary.gazetteer, modelSpans)
	const byKey = new Map(entities.map((e) => [e.key, e]))
	const out = [...entities]
	for (const tag of castTagSpans(text)) {
		const ref = vocabulary.castTags.get(tag.n)
		if (!ref) continue
		const key = entityKey(ref)
		const span = { start: tag.start, end: tag.end }
		const found = byKey.get(key)
		if (found) {
			found.count++
			found.spans = [...found.spans, span].sort(
				(a, b) => a.start - b.start
			)
			continue
		}
		const entity: Entity = {
			key,
			text: text.slice(tag.start, tag.end),
			tier: "gazetteer",
			ref,
			count: 1,
			spans: [span]
		}
		byKey.set(key, entity)
		out.push(entity)
	}
	return out
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
					entityModel: sql`excluded.entity_model`,
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
			content: schema.lorebookEntries.content,
			sourceHash: annotationTextHash.entry
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
		const { sourceHash } = row
		if (isFresh(stored.get(row.id), sourceHash, vocabulary.hash)) continue
		if (written >= limit) {
			deferred++
			continue
		}
		const text = entryAnnotationText(row)
		const pass = await modelSpansFor(text, opts.modelId)
		const entities = entryEntities(text, vocabulary, pass.spans)
		await writeAnnotations(
			db,
			schema.entryAnnotations,
			schema.entryAnnotations.entryId,
			"entryId",
			row.id,
			valuesFor(entities, sourceHash, vocabulary.hash, pass.entityModel)
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
 * picker has *already* decided is stale, extracts, and writes. The hash it
 * stamps is the column (`annotationTextHash`) read in the same statement as the
 * text, which is exactly what the picker's SQL compares against, so the write
 * is what closes the loop: the picker hands the row back only when its text
 * moved after this read.
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
			content: schema.lorebookEntries.content,
			sourceHash: annotationTextHash.entry
		})
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.id, entryId))
		.limit(1)
	const row = rows[0]
	if (!row) return false

	const text = entryAnnotationText(row)
	const pass = await modelSpansFor(text, modelId)
	const entities = entryEntities(text, vocabulary, pass.spans)
	await writeAnnotations(
		db,
		schema.entryAnnotations,
		schema.entryAnnotations.entryId,
		"entryId",
		row.id,
		valuesFor(entities, row.sourceHash, vocabulary.hash, pass.entityModel)
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
			content: schema.sessionMessages.content,
			sourceHash: annotationTextHash.message
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
	const pass = await modelSpansFor(text, modelId)
	const { entities } = extractEntities(text, vocabulary.gazetteer, pass.spans)
	await writeAnnotations(
		db,
		schema.messageAnnotations,
		schema.messageAnnotations.messageId,
		"messageId",
		row.id,
		valuesFor(entities, row.sourceHash, vocabulary.hash, pass.entityModel)
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
			content: schema.sessionMessages.content,
			sourceHash: annotationTextHash.message
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
		const { sourceHash } = row
		if (isFresh(stored.get(row.id), sourceHash, vocabulary.hash)) continue
		if (written >= limit) {
			deferred++
			continue
		}
		const text = (row.content ?? "").slice(0, MAX_ANNOTATED_LENGTH)
		const pass = await modelSpansFor(text, opts.modelId)
		const { entities } = extractEntities(
			text,
			vocabulary.gazetteer,
			pass.spans
		)
		await writeAnnotations(
			db,
			schema.messageAnnotations,
			schema.messageAnnotations.messageId,
			"messageId",
			row.id,
			valuesFor(entities, sourceHash, vocabulary.hash, pass.entityModel)
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
 * Only rows whose freshness triple matches are returned — version, vocabulary
 * and the entry's text (`annotationTextHash.entry`). A stale row is not a fact
 * about the text as it stands, and returning it would justify a hit with
 * content that does not say it any more — §13.3's silent wrongness. It fires
 * when a bounded promotion left an edited entry for the background pass; the
 * filter is here because "the repair ran" is an assumption and this is the
 * reader.
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
			version: schema.entryAnnotations.extractorVersion,
			sourceHash: schema.entryAnnotations.sourceHash,
			currentHash: annotationTextHash.entry
		})
		.from(schema.entryAnnotations)
		.innerJoin(
			schema.lorebookEntries,
			eq(schema.lorebookEntries.id, schema.entryAnnotations.entryId)
		)
		.where(inArray(schema.entryAnnotations.entryId, entryIds as number[]))
	for (const row of rows) {
		if (row.version !== EXTRACTOR_VERSION) continue
		if (row.gazetteerHash !== vocabulary.hash) continue
		if (row.sourceHash !== row.currentHash) continue
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
			sourceHash: schema.messageAnnotations.sourceHash,
			currentHash: annotationTextHash.message
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
		if (row.sourceHash !== row.currentHash) continue
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
