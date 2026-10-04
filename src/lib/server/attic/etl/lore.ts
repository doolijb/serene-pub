/**
 * Lorebooks, their cast (bindings), their entries, and the narrative graph.
 *
 * Books, bindings, scenes, relationships, merge logs and dismissed pairs keep
 * their ids. The three 0.5.3 entry tables become `lorebook_entries` rows of
 * the three declared types under new ids (`world_lore_entries`,
 * `character_lore_entries`, `history_entries` maps), written by `entryInsert`
 * — the helper every entry write goes through — so the row is exactly what
 * the app would have made of the same entry.
 *
 * Then the two repairs the 0.6 pre-release made to its own rows, because a
 * 0.6 constraint depends on each:
 *
 *   · one binding per character per book (`lorebook_bindings_character_unique`)
 *     — a persona and a character bound in one book become two characters, but
 *     two bindings of the SAME character (0.5.3 allowed it) merge into the
 *     lowest id;
 *   · one binding per tag per book (`lorebook_bindings_binding_unique`) —
 *     `{char:N}` is spelled `{{char:N}}`, and a tag two bindings share is
 *     renumbered, with every lore text that names it rewritten to match.
 */
import { eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { rawRows } from "$lib/server/db/rawRows"
import {
	CHARACTER_LORE_TYPE_ID,
	DEFAULT_VECTOR_NAME,
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID,
	entryInsert
} from "$lib/server/utils/lorebookEntries"
import * as attic from "../tables"
import { vectorColumns, type EmbeddedAtticTable } from "../embeddings"
import {
	asDate,
	countDrop,
	insertBatched,
	readById,
	mapFor,
	mapped,
	maxId,
	movedTo,
	type RestoreContext
} from "../context"

/** The declared range of `priority` (core-catalog `priorityField`). */
const PRIORITY_MIN = 1
const PRIORITY_MAX = 3

export async function restoreLorebooks(ctx: RestoreContext): Promise<void> {
	const books = await readById(ctx.tx, attic.lorebooks)
	await insertBatched(
		ctx.tx,
		schema.lorebooks,
		books.map((b) => ({
			id: b.id,
			uuid: b.uuid,
			name: b.name,
			description: b.description,
			extraJson: b.extraJson,
			userId: mapped(ctx, "users", b.userId)!,
			nextBindingNumber: b.nextBindingNumber,
			createdAt: b.createdAt,
			updatedAt: b.updatedAt
		}))
	)
}

export async function restoreBindings(ctx: RestoreContext): Promise<void> {
	const rows = await readById(ctx.tx, attic.lorebookBindings)
	// `history_entry_id` names an entry that does not exist yet; it is set
	// once the entries are in (`linkBindingHistory`). `parent_node_id` points
	// at a sibling binding, so the rows go in without it first.
	await insertBatched(
		ctx.tx,
		schema.lorebookBindings,
		rows.map((b) => ({
			id: b.id,
			lorebookId: b.lorebookId,
			characterId:
				b.characterId ?? movedTo(ctx, "personas", b.personaId) ?? null,
			binding: b.binding,
			sceneId: null,
			historyEntryId: null,
			name: b.name,
			nodeState: b.nodeState,
			nodeVisibility: b.nodeVisibility,
			aliases: b.aliases,
			absorbedAliases: b.absorbedAliases,
			summary: b.summary,
			spriteSet: null,
			...vectorColumns(ctx.embeddings, "lorebook_bindings", b),
			parentNodeId: null,
			createdAt: b.createdAt,
			updatedAt: b.updatedAt
		})),
		200
	)
	for (const b of rows)
		if (b.parentNodeId != null)
			await ctx.tx
				.update(schema.lorebookBindings)
				.set({ parentNodeId: b.parentNodeId })
				.where(eq(schema.lorebookBindings.id, b.id))
}

type AnyEntry =
	| typeof attic.worldLoreEntries.$inferSelect
	| typeof attic.characterLoreEntries.$inferSelect
	| typeof attic.historyEntries.$inferSelect

/** 1..n per (book, type), in 0.5.3's order: position, then id. */
function positions<T extends { id: number; lorebookId: number; position: number }>(
	rows: T[]
): Map<number, number> {
	const byBook = new Map<number, T[]>()
	for (const r of rows) {
		const list = byBook.get(r.lorebookId) ?? []
		list.push(r)
		byBook.set(r.lorebookId, list)
	}
	const out = new Map<number, number>()
	for (const list of byBook.values()) {
		list.sort((a, b) => a.position - b.position || a.id - b.id)
		list.forEach((r, i) => out.set(r.id, i + 1))
	}
	return out
}

/**
 * A 0.5.3 history date in the story-time rule: month and day are 1 or more,
 * or absent, and a day needs a month. Anything else would fail the CHECK boot
 * projects from `core:entry/history@1`. The year is signed and unbounded in
 * story time, so it is carried exactly as written.
 */
export function storyDate(row: {
	year: number
	month: number | null
	day: number | null
}): { year: number; month: number | null; day: number | null } {
	let month = row.month != null && row.month >= 1 ? row.month : null
	const day = row.day != null && row.day >= 1 ? row.day : null
	if (day != null && month == null) month = 1
	return { year: row.year, month, day }
}

export async function restoreEntries(ctx: RestoreContext): Promise<void> {
	const { tx } = ctx
	const world = await readById(tx, attic.worldLoreEntries)
	const character = await readById(tx, attic.characterLoreEntries)
	const history = await readById(tx, attic.historyEntries)
	const books = new Map(
		(await tx.select({ id: attic.lorebooks.id, name: attic.lorebooks.name }).from(attic.lorebooks)).map((b) => [b.id, b.name])
	)

	let next = (await maxId(tx, "lorebook_entries")) + 1
	const vectors: (typeof schema.lorebookEntryVectors.$inferInsert)[] = []
	const priorityClamps = new Map<number, number>()
	const clampPriority = (lorebookId: number, p: number) => {
		const c = Math.min(PRIORITY_MAX, Math.max(PRIORITY_MIN, p))
		if (c !== p)
			priorityClamps.set(lorebookId, (priorityClamps.get(lorebookId) ?? 0) + 1)
		return c
	}

	const insertOf = (
		table: EmbeddedAtticTable,
		typeId: string,
		row: AnyEntry,
		position: number,
		extra: Record<string, unknown>
	): typeof schema.lorebookEntries.$inferInsert => {
		const id = next++
		mapFor(ctx, table).set(row.id, id)
		const v = vectorColumns(ctx.embeddings, table, row)
		if (v.embedding)
			vectors.push({
				entryId: id,
				vectorName: DEFAULT_VECTOR_NAME,
				chunkIndex: 0,
				model: v.embeddingModel,
				dims: v.embedding.length,
				vector: v.embedding,
				vectorizedAt: v.vectorizedAt
			})
		const base = entryInsert({
			typeId,
			lorebookId: row.lorebookId,
			position,
			keys: row.keys,
			useRegex: row.useRegex ?? false,
			caseSensitive: row.caseSensitive,
			content: row.content,
			constant: row.constant,
			enabled: row.enabled,
			extraJson: row.extraJson,
			...extra
		} as never)
		return {
			...base,
			id,
			provenance: "human",
			createdAt: asDate(row.createdAt),
			updatedAt: row.updatedAt ?? undefined
		}
	}

	const rows: (typeof schema.lorebookEntries.$inferInsert)[] = []
	const worldPos = positions(world)
	for (const w of world.sort((a, b) => a.id - b.id))
		rows.push(
			insertOf("world_lore_entries", WORLD_LORE_TYPE_ID, w, worldPos.get(w.id)!, {
				name: w.name,
				category: w.category,
				priority: clampPriority(w.lorebookId, w.priority)
			})
		)
	const charPos = positions(character)
	for (const c of character.sort((a, b) => a.id - b.id))
		rows.push(
			insertOf(
				"character_lore_entries",
				CHARACTER_LORE_TYPE_ID,
				c,
				charPos.get(c.id)!,
				{
					name: c.name,
					lorebookBindingId: c.lorebookBindingId,
					priority: clampPriority(c.lorebookId, c.priority)
				}
			)
		)
	const histPos = positions(history)
	for (const h of history.sort((a, b) => a.id - b.id)) {
		const date = storyDate(h)
		if (date.month !== h.month || date.day !== h.day)
			ctx.notes.add({
				topic: "history-date",
				objectLabel: books.get(h.lorebookId) ?? `lorebook ${h.lorebookId}`,
				summary: `A history entry dated ${h.year}-${h.month ?? "–"}-${h.day ?? "–"} is now ${date.year}-${date.month ?? "–"}-${date.day ?? "–"}: a month or day is 1 or more, and a day needs a month.`,
				changes: [
					{
						field: "date",
						label: "date",
						before: `${h.year}-${h.month ?? ""}-${h.day ?? ""}`,
						after: `${date.year}-${date.month ?? ""}-${date.day ?? ""}`
					}
				]
			})
		rows.push(
			insertOf("history_entries", HISTORY_TYPE_ID, h, histPos.get(h.id)!, {
				...date,
				isCompleted: h.isCompleted,
				graphed: h.graphed
			})
		)
	}

	await insertBatched(tx, schema.lorebookEntries, rows, 200)
	await insertBatched(tx, schema.lorebookEntryVectors, vectors, 100)

	for (const [lorebookId, n] of priorityClamps)
		ctx.notes.add({
			topic: "entry-priority",
			objectLabel: books.get(lorebookId) ?? `lorebook ${lorebookId}`,
			summary: `${n} entr${n === 1 ? "y" : "ies"} had a priority outside 1–3 and now ${n === 1 ? "has" : "have"} the nearest of those.`
		})
}

/** A binding's 0.5.3 history entry, now that it has an id. */
export async function linkBindingHistory(ctx: RestoreContext): Promise<void> {
	const rows = await ctx.tx
		.select({
			id: attic.lorebookBindings.id,
			historyEntryId: attic.lorebookBindings.historyEntryId
		})
		.from(attic.lorebookBindings)
	for (const b of rows) {
		const entryId = movedTo(ctx, "history_entries", b.historyEntryId)
		if (entryId == null) continue
		await ctx.tx
			.update(schema.lorebookBindings)
			.set({ historyEntryId: entryId })
			.where(eq(schema.lorebookBindings.id, b.id))
	}
}

/**
 * Scenes, their cast, the relationships between cast members, the merge
 * logs and dismissed duplicate pairs, and lorebook tags. After sessions:
 * a scene names the session it was summarised from.
 */
export async function restoreGraph(ctx: RestoreContext): Promise<void> {
	const { tx } = ctx
	const scenes = await readById(tx, attic.scenes)
	const keptScenes = new Set<number>()
	const sceneRows: (typeof schema.scenes.$inferInsert)[] = []
	for (const s of scenes) {
		const historyEntryId = movedTo(ctx, "history_entries", s.historyEntryId)
		if (historyEntryId == null) {
			countDrop(ctx, "scenes")
			ctx.notes.add({
				topic: "scene-dropped",
				objectLabel: s.name ?? `scene ${s.id}`,
				summary: `The scene "${s.name ?? s.id}" belonged to a history entry that no longer exists, so it was not carried over.`
			})
			continue
		}
		keptScenes.add(s.id)
		const v = vectorColumns(ctx.embeddings, "scenes", s)
		sceneRows.push({
			id: s.id,
			sessionId: s.chatId,
			lorebookId: s.lorebookId,
			historyEntryId,
			name: s.name,
			selectedMessageIds: s.selectedMessageIds,
			summary: s.summary,
			castResolvedAt: s.castResolvedAt,
			embedding: v.embedding,
			embeddingModel: v.embeddingModel,
			graphed: s.graphed,
			branchId: null,
			createdAt: s.createdAt,
			updatedAt: s.updatedAt
		})
	}
	await insertBatched(tx, schema.scenes, sceneRows, 200)

	const sceneChars = await tx.select().from(attic.sceneCharacters)
	const keptSceneChars = sceneChars.filter((c) => keptScenes.has(c.sceneId))
	countDrop(ctx, "scene_characters", sceneChars.length - keptSceneChars.length)
	await insertBatched(
		tx,
		schema.sceneCharacters,
		keptSceneChars.map((c) => ({
			id: c.id,
			sceneId: c.sceneId,
			bindingId: c.bindingId,
			role: c.role,
			ordinal: c.ordinal
		}))
	)

	// A binding's scene, now that the scenes are in.
	const bindingScenes = await tx
		.select({ id: attic.lorebookBindings.id, sceneId: attic.lorebookBindings.sceneId })
		.from(attic.lorebookBindings)
	for (const b of bindingScenes)
		if (b.sceneId != null && keptScenes.has(b.sceneId))
			await tx
				.update(schema.lorebookBindings)
				.set({ sceneId: b.sceneId })
				.where(eq(schema.lorebookBindings.id, b.id))

	const rels = await readById(tx, attic.narrativeRelationships)
	await insertBatched(
		tx,
		schema.narrativeRelationships,
		rels.map((r) => ({
			id: r.id,
			lorebookId: r.lorebookId,
			fromNodeId: r.fromNodeId,
			toNodeId: r.toNodeId,
			historyEntryId: movedTo(ctx, "history_entries", r.historyEntryId),
			sceneId: r.sceneId != null && keptScenes.has(r.sceneId) ? r.sceneId : null,
			relationshipType: r.relationshipType,
			description: r.description,
			title: "",
			visibility: r.visibility,
			status: r.status,
			reason: r.reason,
			branchId: null,
			...vectorColumns(ctx.embeddings, "narrative_relationships", r),
			createdAt: r.createdAt,
			updatedAt: r.updatedAt
		})),
		200
	)

	const logs = await tx.select().from(attic.bindingMergeLogs)
	await insertBatched(
		tx,
		schema.bindingMergeLogs,
		logs.map((l) => ({
			id: l.id,
			lorebookId: l.lorebookId,
			userId: mapped(ctx, "users", l.userId)!,
			survivorId: l.survivorId,
			absorbedSnapshot: l.absorbedSnapshot,
			relationshipRewrites: l.relationshipRewrites,
			deletedRelationships: l.deletedRelationships,
			sceneSnapshots: l.sceneSnapshots,
			absorbedAliasesAdded: l.absorbedAliasesAdded,
			// The undo of a graph absorb names the character lore it moved;
			// those rows are `lorebook_entries` now (D5).
			reassignedCharacterLoreEntryIds: (l.reassignedCharacterLoreEntryIds ?? [])
				.map((id) => movedTo(ctx, "character_lore_entries", id))
				.filter((id): id is number => id != null),
			reassignedChildNodeIds: l.reassignedChildNodeIds,
			tagRewrites: [],
			createdAt: l.createdAt
		}))
	)

	const pairs = await tx.select().from(attic.dismissedDuplicatePairs)
	await insertBatched(
		tx,
		schema.dismissedDuplicatePairs,
		pairs.map((p) => ({
			id: p.id,
			lorebookId: p.lorebookId,
			bindingIdA: p.bindingIdA,
			bindingIdB: p.bindingIdB,
			createdAt: p.createdAt
		}))
	)

	const lorebookTags = await tx.select().from(attic.lorebookTags)
	await insertBatched(
		tx,
		schema.lorebookTags,
		lorebookTags.map((t) => ({ lorebookId: t.lorebookId, tagId: t.tagId }))
	)
}

/**
 * Two bindings of one character in one book become one: the lowest id
 * survives and everything that named the other is pointed at it — entries,
 * relationships (an edge between the two disappears), scene cast, alias
 * children — and its names join the survivor's absorbed aliases. The
 * survivor's vector is cleared when its aliases grow, as a graph merge does.
 * Returns each absorbed binding's survivor.
 */
export async function mergeDuplicateBindings(
	ctx: RestoreContext
): Promise<Map<number, number>> {
	const { tx } = ctx
	const groups = rawRows<{
		lorebook_id: number
		character_id: number
		ids: number[]
		book: string
	}>(
		await tx.execute(sql`
			SELECT b.lorebook_id, b.character_id, array_agg(b.id ORDER BY b.id) AS ids,
				(SELECT l.name FROM lorebooks l WHERE l.id = b.lorebook_id) AS book
			FROM lorebook_bindings b
			WHERE b.character_id IS NOT NULL
			GROUP BY b.lorebook_id, b.character_id
			HAVING count(*) > 1`)
	)
	const absorbed = new Map<number, number>()
	if (!groups.length) return absorbed
	for (const g of groups) {
		for (const id of g.ids.slice(1)) absorbed.set(id, g.ids[0])
		ctx.notes.add({
			topic: "binding-merged",
			objectLabel: g.book,
			summary: `One character was bound ${g.ids.length} times in "${g.book}"; a character is bound once per book now, so binding ${g.ids[0]} absorbed binding${g.ids.length > 2 ? "s" : ""} ${g.ids.slice(1).join(", ")} with everything that named ${g.ids.length > 2 ? "them" : "it"}.`
		})
	}
	await tx.execute(
		sql.raw(`
	DO $$
	DECLARE
		dup RECORD;
		survivor_name text;
		existing_aliases text[];
		merged_aliases text[];
	BEGIN
		LOOP
			WITH groups AS (
				SELECT lorebook_id, character_id FROM lorebook_bindings
				WHERE character_id IS NOT NULL
				GROUP BY lorebook_id, character_id HAVING COUNT(*) > 1
			),
			members AS (
				SELECT b.id, MIN(b.id) OVER (PARTITION BY g.lorebook_id, g.character_id) AS survivor_id
				FROM groups g JOIN lorebook_bindings b
					ON b.lorebook_id = g.lorebook_id AND b.character_id = g.character_id
			)
			SELECT m.id AS duplicate_id, m.survivor_id INTO dup
			FROM members m WHERE m.id <> m.survivor_id
			ORDER BY m.survivor_id, m.id LIMIT 1;
			EXIT WHEN NOT FOUND;

			UPDATE lorebook_entries SET anchor_binding_id = dup.survivor_id
			WHERE anchor_binding_id = dup.duplicate_id;
			DELETE FROM narrative_relationships
			WHERE (from_node_id = dup.duplicate_id AND to_node_id = dup.survivor_id)
				OR (from_node_id = dup.survivor_id AND to_node_id = dup.duplicate_id)
				OR (from_node_id = dup.duplicate_id AND to_node_id = dup.duplicate_id);
			UPDATE narrative_relationships SET from_node_id = dup.survivor_id
			WHERE from_node_id = dup.duplicate_id;
			UPDATE narrative_relationships SET to_node_id = dup.survivor_id
			WHERE to_node_id = dup.duplicate_id;
			DELETE FROM scene_characters sc
			WHERE sc.binding_id = dup.duplicate_id
				AND EXISTS (SELECT 1 FROM scene_characters keep
					WHERE keep.scene_id = sc.scene_id AND keep.binding_id = dup.survivor_id
						AND keep.role = sc.role);
			UPDATE scene_characters SET binding_id = dup.survivor_id
			WHERE binding_id = dup.duplicate_id;
			UPDATE lorebook_bindings SET parent_node_id = dup.survivor_id
			WHERE parent_node_id = dup.duplicate_id;
			UPDATE lorebook_bindings SET parent_node_id = NULL
			WHERE id = dup.survivor_id AND parent_node_id = dup.survivor_id;

			SELECT s.name INTO survivor_name FROM lorebook_bindings s WHERE s.id = dup.survivor_id;
			SELECT ARRAY(SELECT json_array_elements_text(s.absorbed_aliases))
			INTO existing_aliases FROM lorebook_bindings s WHERE s.id = dup.survivor_id;
			SELECT ARRAY(
				SELECT DISTINCT u.a FROM (
					SELECT unnest(existing_aliases) AS a
					UNION SELECT d.name FROM lorebook_bindings d WHERE d.id = dup.duplicate_id
					UNION SELECT json_array_elements_text(d.aliases) FROM lorebook_bindings d WHERE d.id = dup.duplicate_id
					UNION SELECT json_array_elements_text(d.absorbed_aliases) FROM lorebook_bindings d WHERE d.id = dup.duplicate_id
				) u
				WHERE u.a IS NOT NULL AND btrim(u.a) <> '' AND u.a <> COALESCE(survivor_name, '')
			) INTO merged_aliases;
			IF NOT (merged_aliases <@ existing_aliases) THEN
				UPDATE lorebook_bindings
				SET absorbed_aliases = to_json(merged_aliases),
					embedding = NULL, embedding_model = NULL, vectorized_at = NULL
				WHERE id = dup.survivor_id;
			END IF;
			UPDATE lorebook_bindings s
			SET scene_id = COALESCE(s.scene_id, d.scene_id),
				history_entry_id = COALESCE(s.history_entry_id, d.history_entry_id)
			FROM lorebook_bindings d
			WHERE s.id = dup.survivor_id AND d.id = dup.duplicate_id;
			DELETE FROM lorebook_bindings WHERE id = dup.duplicate_id;
		END LOOP;
	END $$`)
	)
	return absorbed
}

/**
 * Every binding tag spelled `{{char:N}}`, and no two bindings in a book
 * sharing one. A tag two bindings hold is kept by the binding that has the
 * best claim to it — a carded member over a blank one, the doubled spelling
 * over the single — and the others are renumbered past every number the book
 * already uses, with every lore text that named them by the single spelling
 * rewritten to the new tag. Then every remaining `{char:N}` in lore text is
 * doubled. A bound character's vector is cleared where its embedded text
 * moved. Returns the renumbered bindings.
 */
export async function repairCastTags(ctx: RestoreContext): Promise<number> {
	const { tx } = ctx
	await tx.execute(
		sql.raw(`
	CREATE TEMP TABLE _cast_tag_repair AS
	SELECT b.id, b.lorebook_id, b.binding AS written,
		CASE
			WHEN x.m IS NULL OR length(x.m[1]) > 10 THEN NULL
			WHEN x.m[1]::bigint BETWEEN 1 AND 2147483646 THEN x.m[1]::int
		END AS n,
		b.binding ~ '^\\{\\{char:[0-9]+\\}\\}$' AS doubled,
		b.character_id IS NOT NULL AS carded,
		(b.character_id IS NULL AND btrim(b.name) = '' AND COALESCE(btrim(b.summary), '') = ''
			AND CASE WHEN json_typeof(b.aliases) = 'array' THEN json_array_length(b.aliases) ELSE 0 END = 0
			AND CASE WHEN json_typeof(b.absorbed_aliases) = 'array' THEN json_array_length(b.absorbed_aliases) ELSE 0 END = 0
		) AS blank,
		false AS keep, false AS spelling_owner, NULL::int AS new_n
	FROM lorebook_bindings b
	CROSS JOIN LATERAL (SELECT regexp_match(b.binding, '^\\{\\{?char:([0-9]+)\\}?\\}$') AS m) x`)
	)
	await tx.execute(
		sql.raw(`
	WITH ranked AS (
		SELECT id,
			row_number() OVER (PARTITION BY lorebook_id, COALESCE(n::text, 'raw:' || written)
				ORDER BY blank, doubled DESC, carded DESC, id) AS group_rank,
			row_number() OVER (PARTITION BY lorebook_id, COALESCE(n::text, 'raw:' || written), doubled
				ORDER BY blank, carded DESC, id) AS spelling_rank
		FROM _cast_tag_repair
	)
	UPDATE _cast_tag_repair t SET keep = (r.group_rank = 1), spelling_owner = (r.spelling_rank = 1)
	FROM ranked r WHERE r.id = t.id`)
	)
	await tx.execute(
		sql.raw(`
	WITH lore (lorebook_id, t) AS (
		SELECT lorebook_id, content FROM lorebook_entries
		UNION ALL SELECT lorebook_id, title FROM lorebook_entries
		UNION ALL SELECT lorebook_id, array_to_string(keys, E'\\n') FROM lorebook_entries
		UNION ALL SELECT lorebook_id, fields::text FROM lorebook_entries
		UNION ALL SELECT lorebook_id, summary FROM lorebook_bindings
		UNION ALL SELECT lorebook_id, name FROM scenes
		UNION ALL SELECT lorebook_id, summary FROM scenes
		UNION ALL SELECT lorebook_id, description FROM narrative_relationships
		UNION ALL SELECT lorebook_id, reason FROM narrative_relationships
		UNION ALL SELECT id, description FROM lorebooks
		UNION ALL SELECT lorebook_id, absorbed_snapshot::text FROM binding_merge_logs
		UNION ALL SELECT lorebook_id, deleted_relationships::text FROM binding_merge_logs
	),
	text_tags AS (
		SELECT l.lorebook_id, MAX(m[1]::bigint) FILTER (WHERE m[1]::bigint <= 2147483646) AS n
		FROM lore l
		CROSS JOIN LATERAL regexp_matches(l.t, '\\{\\{?char:([0-9]{1,10})\\}?\\}', 'g') AS m
		WHERE l.t LIKE '%char:%'
			AND l.lorebook_id IN (SELECT lorebook_id FROM _cast_tag_repair WHERE NOT keep)
		GROUP BY l.lorebook_id
	),
	starts AS (
		SELECT l.id AS lorebook_id,
			GREATEST(l.next_binding_number::bigint,
				COALESCE((SELECT MAX(n) FROM _cast_tag_repair t WHERE t.lorebook_id = l.id), 0) + 1,
				COALESCE((SELECT tt.n FROM text_tags tt WHERE tt.lorebook_id = l.id), 0) + 1) AS start
		FROM lorebooks l
		WHERE l.id IN (SELECT lorebook_id FROM _cast_tag_repair WHERE NOT keep)
	),
	numbered AS (
		SELECT t.id, s.start + row_number() OVER (PARTITION BY t.lorebook_id ORDER BY t.id) - 1 AS new_n
		FROM _cast_tag_repair t JOIN starts s ON s.lorebook_id = t.lorebook_id
		WHERE NOT t.keep
	)
	UPDATE _cast_tag_repair t SET new_n = numbered.new_n FROM numbered WHERE numbered.id = t.id`)
	)

	const renumbered = rawRows<{
		id: number
		written: string
		new_n: number
		book: string
	}>(
		await tx.execute(
			sql.raw(`SELECT t.id, t.written, t.new_n, l.name AS book
				FROM _cast_tag_repair t JOIN lorebooks l ON l.id = t.lorebook_id
				WHERE NOT t.keep AND t.new_n IS NOT NULL ORDER BY t.id`)
		)
	)
	for (const r of renumbered)
		ctx.notes.add({
			topic: "cast-tag",
			objectLabel: r.book,
			summary: `Binding ${r.id} in "${r.book}" shared the tag ${r.written} with another binding; a tag names one binding now, so it is {{char:${r.new_n}}}, and lore that named it by the old spelling says so too.`
		})

	await tx.execute(
		sql.raw(`
	DO $$
	DECLARE
		job RECORD;
		site RECORD;
		row_id integer;
		haystack text;
		rewrite text;
	BEGIN
		FOR job IN
			SELECT lorebook_id AS book,
				'(?<![{])\\{char:' || n || '\\}(?![}])' AS pattern,
				'{{char:' || new_n || '}}' AS replacement,
				1 AS pass
			FROM _cast_tag_repair
			WHERE NOT keep AND NOT doubled AND spelling_owner AND n IS NOT NULL
			UNION ALL
			SELECT NULL, '(?<![{])\\{char:([0-9]+)\\}(?![}])', '{{char:\\1}}', 2
			ORDER BY pass
		LOOP
			FOR site IN
				SELECT * FROM (VALUES
					('lorebook_entries', 'content', 'text', 'lorebook_id'),
					('lorebook_entries', 'title', 'text', 'lorebook_id'),
					('lorebook_entries', 'keys', 'array', 'lorebook_id'),
					('lorebook_entries', 'fields', 'jsonb', 'lorebook_id'),
					('lorebook_bindings', 'summary', 'text', 'lorebook_id'),
					('scenes', 'name', 'text', 'lorebook_id'),
					('scenes', 'summary', 'text', 'lorebook_id'),
					('narrative_relationships', 'description', 'text', 'lorebook_id'),
					('narrative_relationships', 'reason', 'text', 'lorebook_id'),
					('lorebooks', 'description', 'text', 'id'),
					('binding_merge_logs', 'absorbed_snapshot', 'json', 'lorebook_id'),
					('binding_merge_logs', 'deleted_relationships', 'json', 'lorebook_id')
				) AS s(tbl, col, kind, owner)
			LOOP
				haystack := CASE site.kind
					WHEN 'text' THEN format('%I', site.col)
					WHEN 'array' THEN format('array_to_string(%I, E''\\n'')', site.col)
					ELSE format('%I::text', site.col)
				END;
				rewrite := CASE site.kind
					WHEN 'text' THEN format('regexp_replace(%I, %L, %L, ''g'')', site.col, job.pattern, job.replacement)
					WHEN 'array' THEN format(
						'ARRAY(SELECT regexp_replace(k, %L, %L, ''g'') FROM unnest(%I) WITH ORDINALITY AS u(k, i) ORDER BY i)',
						job.pattern, job.replacement, site.col)
					ELSE format('regexp_replace(%I::text, %L, %L, ''g'')::%s', site.col, job.pattern, job.replacement, site.kind)
				END;
				FOR row_id IN EXECUTE
					format('SELECT id FROM %I WHERE %s ~ %L', site.tbl, haystack, job.pattern)
					|| CASE WHEN job.book IS NULL THEN '' ELSE format(' AND %I = %s', site.owner, job.book) END
				LOOP
					BEGIN
						EXECUTE format('UPDATE %I SET %I = %s WHERE id = %s', site.tbl, site.col, rewrite, row_id);
						IF (site.tbl, site.col) IN (('lorebook_bindings', 'summary'), ('narrative_relationships', 'description'), ('narrative_relationships', 'reason')) THEN
							EXECUTE format(
								'UPDATE %I SET embedding = NULL, embedding_model = NULL, vectorized_at = NULL WHERE id = %s',
								site.tbl, row_id);
						END IF;
					EXCEPTION WHEN integrity_constraint_violation THEN
						RAISE NOTICE 'cast tag repair: % % row % kept its old spelling (%)', site.tbl, site.col, row_id, SQLERRM;
					END;
				END LOOP;
			END LOOP;
		END LOOP;
	END $$`)
	)
	await tx.execute(
		sql.raw(`
	UPDATE lorebook_bindings b
	SET binding = '{{char:' || COALESCE(t.new_n, t.n) || '}}'
	FROM _cast_tag_repair t
	WHERE t.id = b.id AND (t.new_n IS NOT NULL OR t.n IS NOT NULL)
		AND b.binding IS DISTINCT FROM '{{char:' || COALESCE(t.new_n, t.n) || '}}'`)
	)
	await tx.execute(
		sql.raw(`
	UPDATE lorebooks l SET next_binding_number = m.top + 1
	FROM (
		SELECT lorebook_id, MAX(n) AS top FROM (
			SELECT lorebook_id, (regexp_match(binding, '^\\{\\{char:([0-9]{1,10})\\}\\}$'))[1]::bigint AS n
			FROM lorebook_bindings
		) held WHERE n <= 2147483646 GROUP BY lorebook_id
	) m
	WHERE m.lorebook_id = l.id AND l.next_binding_number <= m.top`)
	)
	await tx.execute(sql.raw(`DROP TABLE _cast_tag_repair`))
	return renumbered.length
}
