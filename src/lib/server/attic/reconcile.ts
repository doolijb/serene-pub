/**
 * The restore's proof: every 0.5.3 row is accounted for.
 *
 * For each live table, what the attic held (as the stash counted it,
 * `__manifest`) maps to an exact expected count — copied one for one, merged,
 * or minus the rows a step dropped and said so in a note. A difference with no
 * such explanation refuses the restore, and the transaction it runs in takes
 * every row back out: an upgrade that lost something silently is worse than
 * one that did not finish.
 */
import { sql } from "drizzle-orm"
import { rawRows } from "$lib/server/db/rawRows"
import * as attic from "./tables"
import { ATTIC_SCHEMA } from "./index"
import { movedTo, type RestoreContext } from "./context"

export interface ReconcileLine {
	table: string
	expected: number
	actual: number
}

async function count(tx: Db, from: string): Promise<number> {
	const rows = rawRows<{ n: number }>(
		await tx.execute(sql.raw(`SELECT count(*)::int AS n FROM ${from}`))
	)
	return Number(rows[0]?.n ?? 0)
}

export async function reconcile(
	ctx: RestoreContext,
	merged: Map<number, number>
): Promise<ReconcileLine[]> {
	const { tx } = ctx
	const manifestRows = await tx.select().from(attic.manifest)
	const held = new Map(manifestRows.map((r) => [r.tableName, Number(r.rowCount)]))
	const n = (t: string) => held.get(t) ?? 0
	const dropped = (t: string) => ctx.dropped.get(t) ?? 0
	const added = (t: string) => ctx.added.get(t) ?? 0
	const live = (t: string, where = "") => count(tx, `public."${t}"${where ? ` WHERE ${where}` : ""}`)

	const lines: ReconcileLine[] = []
	const expect = (table: string, expected: number, actual: number) =>
		lines.push({ table, expected, actual })

	// The stash and the attic agree before anything is compared with them.
	for (const [table, rows] of held) {
		if (table.startsWith("__")) continue
		expect(`attic ${table}`, rows, await count(tx, `"${ATTIC_SCHEMA}"."${table}"`))
	}

	const atticUsers = (await tx.select({ id: attic.users.id }).from(attic.users)).map(
		(u) => movedTo(ctx, "users", u.id) ?? u.id
	)
	expect(
		"users",
		n("users"),
		atticUsers.length ? await live("users", `id IN (${atticUsers.join(",")})`) : 0
	)
	expect(
		"user_settings",
		n("user_settings"),
		atticUsers.length
			? await live("user_settings", `user_id IN (${atticUsers.join(",")})`)
			: 0
	)
	for (const t of ["passphrases", "user_tokens", "setup", "custom_themes", "tags", "lorebooks", "lorebook_tags", "binding_merge_logs"])
		expect(t, n(t), await live(t))

	expect("characters", n("characters") + n("personas"), await live("characters"))

	const tagPairs = new Set<string>()
	for (const t of await tx.select().from(attic.characterTags))
		tagPairs.add(`${t.characterId}:${t.tagId}`)
	for (const t of await tx.select().from(attic.personaTags))
		tagPairs.add(`${movedTo(ctx, "personas", t.personaId)}:${t.tagId}`)
	expect("character_tags", tagPairs.size, await live("character_tags"))

	const survivor = (id: number) => merged.get(id) ?? id
	expect("lorebook_bindings", n("lorebook_bindings") - merged.size, await live("lorebook_bindings"))
	const pairs = await tx.select().from(attic.dismissedDuplicatePairs)
	expect(
		"dismissed_duplicate_pairs",
		pairs.filter((p) => !merged.has(p.bindingIdA) && !merged.has(p.bindingIdB)).length,
		await live("dismissed_duplicate_pairs")
	)

	expect(
		"lorebook_entries",
		n("world_lore_entries") + n("character_lore_entries") + n("history_entries"),
		await live("lorebook_entries")
	)
	const kept = ctx.embeddings.kept
	expect(
		"lorebook_entry_vectors",
		(kept.world_lore_entries ?? 0) +
			(kept.character_lore_entries ?? 0) +
			(kept.history_entries ?? 0),
		await live("lorebook_entry_vectors")
	)

	expect("sessions", n("chats"), await live("sessions"))
	expect("session_messages", n("chat_messages"), await live("session_messages"))
	expect("session_characters", n("chat_characters"), await live("session_characters"))
	expect("session_personas", n("chat_personas"), await live("session_personas"))
	expect("session_guests", n("chat_guests"), await live("session_guests"))
	expect("session_tags", n("chat_tags"), await live("session_tags"))

	expect("scenes", n("scenes") - dropped("scenes"), await live("scenes"))
	const sceneIds = new Set(
		rawRows<{ id: number }>(await tx.execute(sql`SELECT id FROM scenes`)).map((r) => r.id)
	)
	const seats = new Set<string>()
	for (const c of await tx.select().from(attic.sceneCharacters))
		if (sceneIds.has(c.sceneId))
			seats.add(`${c.sceneId}:${survivor(c.bindingId)}:${c.role}`)
	expect("scene_characters", seats.size, await live("scene_characters"))

	let edges = 0
	for (const r of await tx
		.select({
			fromNodeId: attic.narrativeRelationships.fromNodeId,
			toNodeId: attic.narrativeRelationships.toNodeId
		})
		.from(attic.narrativeRelationships)) {
		const from = survivor(r.fromNodeId)
		const to = survivor(r.toNodeId)
		const merging = merged.has(r.fromNodeId) || merged.has(r.toNodeId)
		if (merging && from === to) continue
		edges++
	}
	expect("narrative_relationships", edges, await live("narrative_relationships"))

	expect(
		"connections",
		n("connections") + added("connections") - dropped("connections"),
		await live("connections")
	)
	const blankModels = rawRows<{ n: number }>(
		await tx.execute(
			sql.raw(`SELECT count(*)::int AS n FROM "${ATTIC_SCHEMA}"."connections" WHERE btrim(coalesce("model", '')) = ''`)
		)
	)
	const embeddingModels = rawRows<{ n: number }>(
		await tx.execute(
			sql`SELECT count(*)::int AS n FROM connection_models m JOIN connections c ON c.id = m.connection_id WHERE c.modality = 'embeddings'`
		)
	)
	expect(
		"connection_models",
		n("connections") -
			Number(blankModels[0]?.n ?? 0) +
			Number(embeddingModels[0]?.n ?? 0) -
			dropped("connection_models"),
		await live("connection_models")
	)

	const seeded = new Set(
		rawRows<{ seed_key: string }>(
			await tx.execute(sql`SELECT seed_key FROM sampling_configs WHERE seed_key IS NOT NULL`)
		).map((r) => r.seed_key)
	)
	const atticSampling = await tx.select().from(attic.samplingConfigs)
	expect(
		"sampling_configs (user)",
		atticSampling.filter((s) => !s.seedKey || !seeded.has(s.seedKey)).length,
		await live("sampling_configs", "seed_key IS NULL")
	)
	expect("local_models", n("koboldcpp_models"), await live("local_models"))

	return lines
}

/** The lines that do not match, as one sentence each. */
export function mismatches(lines: ReconcileLine[]): string[] {
	return lines
		.filter((l) => l.expected !== l.actual)
		.map((l) => `${l.table}: expected ${l.expected}, found ${l.actual}`)
}
