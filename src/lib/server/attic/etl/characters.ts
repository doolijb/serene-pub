/**
 * Characters, and personas becoming characters.
 *
 * A character keeps its id. A persona becomes a character with
 * `is_persona = true` under a new id — the two id ranges overlap — and every
 * 0.5.3 reader of a persona id goes through the `personas` map from here on.
 * The merge itself is what the 0.6 pre-release did to its own rows: a persona
 * whose uuid one of its owner's characters already holds gets a fresh one
 * (uuids are unique per user), and `is_default_persona` stays only on each
 * user's lowest-id default, since a user may have one.
 *
 * Accepted losses (D10): `characters.assets` (a card's asset list) and
 * `personas.position` have no 0.6 column.
 */
import * as schema from "$lib/server/db/schema"
import * as attic from "../tables"
import { vectorColumns } from "../embeddings"
import {
	countLoss,
	insertBatched,
	readById,
	mapFor,
	mapped,
	maxId,
	type RestoreContext
} from "../context"

export async function restoreCharacters(ctx: RestoreContext): Promise<void> {
	const { tx } = ctx
	const chars = await readById(tx, attic.characters)

	await insertBatched(
		tx,
		schema.characters,
		chars.map((c) => {
			if (Array.isArray(c.assets) && c.assets.length)
				countLoss(ctx, "character card assets")
			return {
				id: c.id,
				uuid: c.uuid,
				userId: mapped(ctx, "users", c.userId)!,
				name: c.name,
				nickname: c.nickname,
				characterVersion: c.characterVersion,
				description: c.description,
				personality: c.personality,
				scenario: c.scenario,
				firstMessage: c.firstMessage,
				alternateGreetings: c.alternateGreetings,
				exampleDialogues: c.exampleDialogues,
				metadata: c.metadata,
				creatorNotes: c.creatorNotes,
				creatorNotesMultilingual: c.creatorNotesMultilingual,
				groupOnlyGreetings: c.groupOnlyGreetings,
				postHistoryInstructions: c.postHistoryInstructions,
				source: c.source,
				createdAt: c.createdAt,
				updatedAt: c.updatedAt,
				lorebookId: c.lorebookId,
				extensions: c.extensions,
				aliases: c.aliases,
				summary: c.summary,
				creator: c.creator,
				category: c.category,
				isFavorite: c.isFavorite,
				isPersona: false,
				isDefaultPersona: false,
				isDeleted: c.isDeleted,
				...vectorColumns(ctx.embeddings, "characters", c)
			}
		}),
		200
	)

	const personas = await readById(tx, attic.personas)
	const personaMap = mapFor(ctx, "personas")
	const uuidsByUser = new Map<number, Set<string>>()
	for (const c of chars) {
		const set = uuidsByUser.get(c.userId) ?? new Set<string>()
		set.add(c.uuid)
		uuidsByUser.set(c.userId, set)
	}
	const firstDefault = new Map<number, number>()
	for (const p of personas)
		if (p.isDefault && !firstDefault.has(p.userId))
			firstDefault.set(p.userId, p.id)

	let next = (await maxId(tx, "characters")) + 1
	const rows: (typeof schema.characters.$inferInsert)[] = []
	for (const p of personas) {
		const id = next++
		personaMap.set(p.id, id)
		const taken = uuidsByUser.get(p.userId) ?? new Set<string>()
		let uuid = p.uuid
		if (taken.has(uuid)) {
			uuid = crypto.randomUUID()
			ctx.notes.add({
				topic: "persona-uuid",
				objectLabel: p.name,
				summary: `The persona "${p.name}" shared its id with one of its owner's characters, so it was given a new one; card exports made before the upgrade name the old id.`
			})
		}
		taken.add(uuid)
		uuidsByUser.set(p.userId, taken)

		const isDefaultPersona = p.isDefault && firstDefault.get(p.userId) === p.id
		if (p.isDefault && !isDefaultPersona)
			ctx.notes.add({
				topic: "persona-default",
				objectLabel: p.name,
				summary: `"${p.name}" was one of two default personas for the same user; a user has one default now, so it stays a persona but is no longer the default.`
			})
		if ((p.position ?? 0) !== 0) countLoss(ctx, "persona list positions")

		rows.push({
			id,
			uuid,
			userId: mapped(ctx, "users", p.userId)!,
			name: p.name,
			description: p.description,
			createdAt: p.createdAt,
			updatedAt: p.updatedAt ?? new Date(),
			lorebookId: p.lorebookId,
			aliases: p.aliases,
			summary: p.summary,
			creator: p.creator,
			category: p.category,
			isPersona: true,
			isDefaultPersona,
			isDeleted: p.isDeleted,
			...vectorColumns(ctx.embeddings, "personas", p)
		})
	}
	await insertBatched(tx, schema.characters, rows, 200)

	const characterTags = await tx.select().from(attic.characterTags)
	await insertBatched(
		tx,
		schema.characterTags,
		characterTags.map((t) => ({ characterId: t.characterId, tagId: t.tagId }))
	)
	const personaTags = await tx.select().from(attic.personaTags)
	if (personaTags.length)
		await tx
			.insert(schema.characterTags)
			.values(
				personaTags.map((t) => ({
					characterId: personaMap.get(t.personaId)!,
					tagId: t.tagId
				}))
			)
			.onConflictDoNothing()
}
