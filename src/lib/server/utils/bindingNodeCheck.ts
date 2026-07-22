import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"

export async function runBindingNodeCheck(
	lorebookId: number,
	bindings: Array<{
		id: number
		characterId: number | null
		personaId: number | null
		binding: string
	}>,
	emitToUser: (event: string, data: unknown) => void
): Promise<void> {
	const relevantBindings = bindings.filter(
		(b) => b.characterId || b.personaId
	)
	if (relevantBindings.length === 0) return

	// Find which bindings already have a node linked to them
	const relevantIds = relevantBindings.map((b) => b.id)
	const linkedNodes = await db.query.narrativeNodes.findMany({
		where: and(
			eq(schema.narrativeNodes.lorebookId, lorebookId),
			inArray(schema.narrativeNodes.lorebookBindingId, relevantIds)
		),
		columns: { lorebookBindingId: true }
	})
	const linkedBindingIds = new Set(
		linkedNodes
			.map((n) => n.lorebookBindingId)
			.filter((id): id is number => id !== null)
	)

	const bindingsNeedingNode = relevantBindings.filter(
		(b) => !linkedBindingIds.has(b.id)
	)
	if (bindingsNeedingNode.length === 0) return

	// Find parent nodes not yet linked to any binding (exclude alias children)
	const unlinkedNodes = await db.query.narrativeNodes.findMany({
		where: and(
			eq(schema.narrativeNodes.lorebookId, lorebookId),
			isNull(schema.narrativeNodes.lorebookBindingId),
			isNull(schema.narrativeNodes.parentNodeId)
		),
		columns: { id: true, name: true, nodeState: true, summary: true }
	})

	if (unlinkedNodes.length === 0) {
		// Auto-create a node for each binding that needs one
		for (const binding of bindingsNeedingNode) {
			const entityName = await resolveBindingEntityName(binding)
			await db.insert(schema.narrativeNodes).values({
				lorebookId,
				name: entityName,
				nodeState: "active",
				summary: null,
				lorebookBindingId: binding.id
			})
		}
		return
	}

	// Unlinked nodes exist — prompt user for each binding that needs a node
	const pendingBindings = await Promise.all(
		bindingsNeedingNode.map(async (binding) => {
			const entityName = await resolveBindingEntityName(binding)
			const scored = unlinkedNodes.map((n) => ({
				...n,
				score: scoreNameSimilarity(entityName, n.name)
			}))
			scored.sort(
				(a, b) => b.score - a.score || a.name.localeCompare(b.name)
			)
			return {
				binding: {
					bindingId: binding.id,
					binding: binding.binding,
					entityName
				},
				unlinkedNodes: scored
			}
		})
	)

	const nodeCheckRes: Sockets.BindingCheck.NodeResult.Response = {
		lorebookId,
		pendingBindings
	}
	emitToUser("bindingCheck:nodeResult", nodeCheckRes)
}

async function resolveBindingEntityName(binding: {
	characterId: number | null
	personaId: number | null
	binding: string
}): Promise<string> {
	if (binding.characterId) {
		const char = await db.query.characters.findFirst({
			where: eq(schema.characters.id, binding.characterId),
			columns: { name: true, nickname: true }
		})
		return resolveCharacterName(char, binding.binding)
	}
	if (binding.personaId) {
		const persona = await db.query.personas.findFirst({
			where: eq(schema.personas.id, binding.personaId),
			columns: { name: true }
		})
		return persona?.name || binding.binding
	}
	return binding.binding
}

function scoreNameSimilarity(a: string, b: string): number {
	const al = a.toLowerCase()
	const bl = b.toLowerCase()
	if (al === bl) return 3
	if (al.includes(bl) || bl.includes(al)) return 2
	const aWords = al.split(/\s+/)
	const bWords = bl.split(/\s+/)
	const shared = aWords.filter((w) => bWords.includes(w)).length
	return shared > 0 ? 1 : 0
}
