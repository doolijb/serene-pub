// lorebookExportBuilder.ts
//
// Builds the full spec-compliant export representation of a lorebook —
// shared by lorebooks.ts's lorebookExportHandler (the actual file download),
// lorebookImportHandler's "unchanged vs conflict" hash comparison, and
// characters.ts's charactersExportCard (embedding a lorebook into a
// character card export). Kept in its own module rather than living inside
// lorebooks.ts so characters.ts can import it without creating a circular
// import (lorebooks.ts already imports from characters.ts, for the reverse
// direction of embedding a character into a lorebook export) — same reason
// characterBindingSync.ts is its own file rather than living in lorebooks.ts.
//
// All three callers used to be separate implementations; the comparison
// side used to rebuild a bare buildSpecV3Lorebook() with no bindings/
// characters/personas/narrativeGraph attached (spurious "conflict" on every
// re-import), and charactersExportCard used to skip bindings/graph entirely
// (silently dropping every character-lore entry's privacy binding and all
// graph data on a character-with-lorebook export) — see the merge plan.

import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, eq } from "drizzle-orm"
import {
	buildSpecV3Lorebook,
	assignHistoryEntryLocalIds,
	attachBoundEntities,
	mapSceneForExport,
	mapNarrativeNode,
	mapNarrativeRelationship,
	attachNarrativeGraph,
	type ExportedBoundCharacter,
	type ExportedBoundPersona,
	type ExportedBinding,
	type ExportedScene
} from "$lib/server/utils/lorebookExportMapper"
import { buildCharacterCardV3 } from "$lib/server/utils/characterCardParser"
import { buildPersonaExportCard } from "$lib/server/sockets/personas"

export async function buildLorebookExportData(
	lorebookId: number,
	userId: number,
	options: {
		includeCharacters?: boolean
		includePersonas?: boolean
		includeNarrativeGraph?: boolean
	} = {}
) {
	const lorebook = await db.query.lorebooks.findFirst({
		where: and(
			eq(schema.lorebooks.id, lorebookId),
			eq(schema.lorebooks.userId, userId)
		),
		with: {
			worldLoreEntries: true,
			characterLoreEntries: true,
			historyEntries: true,
			// `characters` are the scene_characters join rows; the export
			// mapper still wants the flat id arrays, so they're projected
			// below. Ordered so export bytes stay stable — import compares
			// them to detect "unchanged vs conflict".
			scenes: { with: { characters: true } }
		}
	})

	if (!lorebook) {
		throw new Error("Lorebook not found.")
	}

	// All default to true — matches the original always-include-everything
	// behavior for any caller that doesn't specify.
	const includeCharacters = options.includeCharacters ?? true
	const includePersonas = options.includePersonas ?? true
	const includeNarrativeGraph = options.includeNarrativeGraph ?? true

	// Embed every bound character/persona's full card (when opted into),
	// plus the binding structure itself (always, even for bindings whose
	// card isn't embedded) — see attachBoundEntities.
	const bindingRows = await db.query.lorebookBindings.findMany({
		where: eq(schema.lorebookBindings.lorebookId, lorebook.id),
		with: {
			character: { with: { characterTags: { with: { tag: true } } } },
			persona: true
		}
	})

	let nextLocalId = 1
	const characters: ExportedBoundCharacter[] = []
	const personas: ExportedBoundPersona[] = []
	const bindings: ExportedBinding[] = []
	const bindingLocalIdByRealId = new Map<number, number>()

	for (const binding of bindingRows) {
		let characterLocalId: number | null = null
		let personaLocalId: number | null = null

		// Binding a character/persona only requires being able to *view* it
		// (canViewCharacter/canViewPersona — true for anything shared into a
		// session you're in, not just things you own), but export is a
		// data-extraction action, not a viewing action — the direct
		// characters:exportCard/personas:exportCard handlers are deliberately
		// owner-only for exactly this reason. Without this check, binding a
		// character someone else merely shared into a session with you, then
		// exporting your own lorebook, would bundle their full card (system
		// prompt, personality, everything) into your download. Degrades to
		// the already-supported "binding present, no card embedded" path
		// (same as includeCharacters/includePersonas: false) rather than
		// needing new branching.
		if (
			binding.character &&
			includeCharacters &&
			binding.character.userId === userId
		) {
			characterLocalId = nextLocalId++
			characters.push({
				localId: characterLocalId,
				// No `lorebook` passed — avoids embedding this character's
				// own character_book recursively.
				card: buildCharacterCardV3({
					...binding.character,
					tags:
						binding.character.characterTags?.map(
							(ct) => ct.tag.name
						) || []
				})
			})
		}
		if (
			binding.persona &&
			includePersonas &&
			binding.persona.userId === userId
		) {
			personaLocalId = nextLocalId++
			personas.push({
				localId: personaLocalId,
				card: buildPersonaExportCard(binding.persona)
			})
		}

		const bindingLocalId = nextLocalId++
		bindingLocalIdByRealId.set(binding.id, bindingLocalId)
		bindings.push({
			localId: bindingLocalId,
			bindingText: binding.binding,
			kind: binding.characterId ? "character" : "persona",
			characterLocalId,
			personaLocalId
		})
	}

	// Scenes nest under their owning history entry rather than a separate
	// top-level array (a scene belongs to exactly one history entry) —
	// assign each a document-scoped localId here so narrativeGraph nodes/
	// relationships below can reference one.
	const historyEntryLocalIdByRealId = assignHistoryEntryLocalIds(
		lorebook.historyEntries
	)
	const sceneLocalIdByRealId = new Map<number, number>()
	const scenesByHistoryEntryId = new Map<number, ExportedScene[]>()
	lorebook.scenes.forEach((scene) => {
		const localId = nextLocalId++
		sceneLocalIdByRealId.set(scene.id, localId)
		// Project join rows back to the flat arrays the export format uses.
		// Sorted by ordinal so the serialized order matches what was stored —
		// import hashes these bytes to detect "unchanged vs conflict", so an
		// unstable order would mark every lorebook conflicted on re-import.
		const cast = [...((scene as any).characters ?? [])].sort(
			(a: any, b: any) => a.ordinal - b.ordinal || a.id - b.id
		)
		const mapped = mapSceneForExport(
			{
				...scene,
				participantCharacters: cast
					.filter((c: any) => c.role === "participant")
					.map((c: any) => c.bindingId),
				mentionedCharacters: cast
					.filter((c: any) => c.role === "mentioned")
					.map((c: any) => c.bindingId)
			},
			localId,
			bindingLocalIdByRealId
		)
		const existing = scenesByHistoryEntryId.get(scene.historyEntryId) ?? []
		existing.push(mapped)
		scenesByHistoryEntryId.set(scene.historyEntryId, existing)
	})

	const specBook = attachBoundEntities(
		buildSpecV3Lorebook(
			lorebook,
			lorebook.worldLoreEntries,
			lorebook.characterLoreEntries,
			lorebook.historyEntries,
			bindingLocalIdByRealId,
			scenesByHistoryEntryId,
			historyEntryLocalIdByRealId
		),
		characters,
		personas,
		bindings
	)

	// Narrative graph — skipped entirely (no DB queries either) when the
	// caller opted out, or omitted from the output (attachNarrativeGraph's
	// own job) when the lorebook simply has no nodes/relationships at all.
	// Post-merge (see the lorebookBindings/narrativeNodes merge plan): every
	// node IS a binding row, so this reuses bindingRows (already fetched
	// above) instead of a second table query. characterUuids is always []
	// now — the old characterIds array it round-tripped was already
	// vestigial pre-merge and has no merged-schema equivalent.
	let specBookWithGraph = specBook
	if (includeNarrativeGraph) {
		const narrativeRelationshipRows =
			await db.query.narrativeRelationships.findMany({
				where: eq(schema.narrativeRelationships.lorebookId, lorebook.id)
			})

		const nodeLocalIdByRealId = new Map<number, number>()
		bindingRows.forEach((node) => {
			nodeLocalIdByRealId.set(node.id, nextLocalId++)
		})

		const narrativeNodes = bindingRows.map((node) => {
			// Mirrors the characters[]/personas[] ownership check above —
			// a binding's name/aliases/summary are kept in sync with the
			// bound character/persona's real values regardless of who owns
			// it (binding only requires viewing access), so without this,
			// a node for a shared-but-not-owned character/persona would
			// leak their real identity here even though its full card was
			// correctly excluded from characters[]/personas[].
			const isOwnedOrUnbound =
				(!node.characterId && !node.personaId) ||
				node.character?.userId === userId ||
				node.persona?.userId === userId
			const safeNode = isOwnedOrUnbound
				? node
				: {
						...node,
						name: "",
						aliases: [],
						absorbedAliases: [],
						summary: null
					}
			return mapNarrativeNode(
				safeNode,
				nodeLocalIdByRealId.get(node.id)!,
				[],
				bindingLocalIdByRealId,
				nodeLocalIdByRealId,
				historyEntryLocalIdByRealId,
				sceneLocalIdByRealId
			)
		})
		const narrativeRelationships = narrativeRelationshipRows
			.map((rel) =>
				mapNarrativeRelationship(
					rel,
					nodeLocalIdByRealId,
					historyEntryLocalIdByRealId,
					sceneLocalIdByRealId
				)
			)
			.filter((r): r is NonNullable<typeof r> => r !== null)

		specBookWithGraph = attachNarrativeGraph(
			specBook,
			narrativeNodes,
			narrativeRelationships
		)
	}

	return { name: lorebook.name, specBookWithGraph }
}
