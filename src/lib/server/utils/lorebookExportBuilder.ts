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
// One builder for all three, so the comparison and the card embed carry
// exactly what an export carries — bindings, cards, graph and stats included.
//
// ⚠ **A file carries MAIN only, as its base rows** (lorebooks plan A4). Every
// read here filters through `onLineSql(…, MAIN_LINE)` — `branch_id IS NULL` —
// so a branch's own entries, scenes, links and stats never leave the book,
// and no amendment is applied: an amendment is a change at a story date, and
// folding one into the base would state it as true from the start. Carrying
// branches and amendments is a format question for export un-pausing.

import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm"
import {
	buildSpecV3Lorebook,
	type ExportableEntryWithPosition,
	assignEntryLocalIds,
	assignHistoryEntryLocalIds,
	attachBoundEntities,
	attachStats,
	mapSceneForExport,
	mapNarrativeNode,
	mapNarrativeRelationship,
	mapStatRowForExport,
	attachNarrativeGraph,
	statValueEntryIds,
	EXPORTED_STAT_OWNER_KINDS,
	type ExportedBoundCharacter,
	type ExportedBoundPersona,
	type ExportedBinding,
	type ExportedScene,
	type ExportedStatRow,
	type LorebookExportProfile
} from "$lib/server/utils/lorebookExportMapper"
import {
	HISTORY_TYPE_ID,
	entriesOfType,
	toEntryRow
} from "$lib/server/utils/lorebookEntries"
import { buildCharacterCardV3 } from "$lib/server/utils/characterCardParser"
import { buildPersonaExportCard } from "$lib/server/utils/personaCard"
import { onLineSql } from "$lib/server/state/lineSql"
import { MAIN_LINE } from "$lib/shared/lorebooks/lineReading"

import { clockOf } from "$lib/server/state/storyTime"

export async function buildLorebookExportData(
	lorebookId: number,
	userId: number,
	options: {
		includeCharacters?: boolean
		includePersonas?: boolean
		includeNarrativeGraph?: boolean
		/** Which wire names the entries go out under; see the mapper. */
		exportProfile?: LorebookExportProfile
	} = {}
) {
	const lorebook = await db.query.lorebooks.findFirst({
		where: and(
			eq(schema.lorebooks.id, lorebookId),
			eq(schema.lorebooks.userId, userId)
		),
		with: {
			// `characters` are the scene_characters join rows; the export
			// mapper still wants the flat id arrays, so they're projected
			// below. Main's scenes only (see the header), in write order so
			// the bytes the import compares stay stable.
			scenes: {
				where: onLineSql(schema.scenes.branchId, MAIN_LINE),
				orderBy: asc(schema.scenes.id),
				with: { characters: true }
			}
		}
	})

	if (!lorebook) {
		throw new Error("Lorebook not found.")
	}

	// One list, one shape, main's rows only. A type id never goes into a
	// file — `buildSpecV3Lorebook` writes each type's wire name and groups
	// the list in the file's order. No vectors: a file carries none.
	const entries = (
		await db
			.select()
			.from(schema.lorebookEntries)
			.where(
				and(
					eq(schema.lorebookEntries.lorebookId, lorebookId),
					onLineSql(schema.lorebookEntries.branchId, MAIN_LINE)
				)
			)
			.orderBy(asc(schema.lorebookEntries.id))
	).map((row) => toEntryRow(row))
	const historyEntries = entriesOfType(entries, HISTORY_TYPE_ID)

	// All default to true — matches the original always-include-everything
	// behavior for any caller that doesn't specify.
	const includeCharacters = options.includeCharacters ?? true
	const includePersonas = options.includePersonas ?? true
	const includeNarrativeGraph = options.includeNarrativeGraph ?? true

	// Embed every bound character/persona's full card (when opted into),
	// plus the binding structure itself (always, even for bindings whose
	// card isn't embedded) — see attachBoundEntities.
	// ONE relation. A bound persona is a bound CHARACTER; which half of the
	// export it lands in is decided by `isPersona` below, not by the column
	// the id sits in.
	const bindingRows = await db.query.lorebookBindings.findMany({
		where: eq(schema.lorebookBindings.lorebookId, lorebook.id),
		with: {
			character: { with: { characterTags: { with: { tag: true } } } }
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

		// Binding a character only requires being able to *view* it
		// (canViewCharacter — true for anything shared into a
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
		// `extensions.serenepub.personas` is a WIRE FORMAT other programs
		// hold, so it stays — the split is now made from `isPersona` rather
		// than from which id column was set, and a persona still exports as a
		// persona card (the small shape; see personaCard.ts).
		// A deleted card is not carried (plan A25): the member goes out as a
		// member without a card, as when the file leaves cards out.
		const isOwned =
			binding.character?.userId === userId && !binding.character.isDeleted
		const asPersona = !!binding.character?.isPersona
		if (binding.character && isOwned && !asPersona && includeCharacters) {
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
		if (binding.character && isOwned && asPersona && includePersonas) {
			personaLocalId = nextLocalId++
			personas.push({
				localId: personaLocalId,
				card: buildPersonaExportCard(binding.character)
			})
		}

		const bindingLocalId = nextLocalId++
		bindingLocalIdByRealId.set(binding.id, bindingLocalId)
		bindings.push({
			localId: bindingLocalId,
			bindingText: binding.binding,
			kind: asPersona ? "persona" : "character",
			characterLocalId,
			personaLocalId,
			...(binding.spriteSet ? { spriteSet: binding.spriteSet } : {})
		})
	}

	// Scenes nest under their owning history entry rather than a separate
	// top-level array (a scene belongs to exactly one history entry) —
	// assign each a document-scoped localId here so narrativeGraph nodes/
	// relationships below can reference one.
	const historyEntryLocalIdByRealId =
		assignHistoryEntryLocalIds(historyEntries)
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

	// A `LorebookEntry` satisfies `ExportableEntry` field for field;
	// TypeScript will not infer the index signature that type needs from an
	// interface, which is the whole of the mismatch.
	const exportableEntries =
		entries as unknown as ExportableEntryWithPosition[]

	// The edges are read before the entries are written: an entry is numbered
	// exactly when the document points at it, and an endpoint is one of the
	// things that does. Omitting the graph omits its edges from that question
	// too — an anchor still numbers its target either way.
	const narrativeRelationshipRows = includeNarrativeGraph
		? await db.query.narrativeRelationships.findMany({
				where: and(
					eq(schema.narrativeRelationships.lorebookId, lorebook.id),
					onLineSql(schema.narrativeRelationships.branchId, MAIN_LINE)
				),
				orderBy: asc(schema.narrativeRelationships.id)
			})
		: []
	// The stats the book owns before play, on main: the book's own, its cast
	// members' and its places' (plan A26). A stat names entries too — its
	// place, and the entries its lore references hold — so it is read before
	// the numbering as well. `0.5-compat` writes format 1, which carries none.
	const exportProfile = options.exportProfile ?? "native"
	const statRows =
		exportProfile === "native"
			? await readBookStats(
					lorebook.id,
					bindingRows.map((b) => b.id),
					entries.map((e) => e.id)
				)
			: []
	const entryLocalIdByRealId = assignEntryLocalIds(exportableEntries, [
		...narrativeRelationshipRows
			.flatMap((rel) => [rel.fromEntryId, rel.toEntryId])
			.filter((id): id is number => id !== null),
		...statRows.flatMap((row) => [
			...(row.ownerKind === "location" ? [row.ownerId] : []),
			...statValueEntryIds(row.value)
		])
	], exportProfile)

	const specBook = attachBoundEntities(
		buildSpecV3Lorebook(
			lorebook,
			exportableEntries,
			bindingLocalIdByRealId,
			scenesByHistoryEntryId,
			historyEntryLocalIdByRealId,
			entryLocalIdByRealId,
			exportProfile
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
		const nodeLocalIdByRealId = new Map<number, number>()
		bindingRows.forEach((node) => {
			nodeLocalIdByRealId.set(node.id, nextLocalId++)
		})

		const narrativeNodes = bindingRows.map((node) => {
			// Mirrors the characters[]/personas[] ownership check above —
			// a binding's name/aliases/summary are kept in sync with the
			// bound character's real values regardless of who owns
			// it (binding only requires viewing access), so without this,
			// a node for a shared-but-not-owned character would
			// leak their real identity here even though its full card was
			// correctly excluded from characters[]/personas[].
			const isOwnedOrUnbound =
				!node.characterId || node.character?.userId === userId
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
					sceneLocalIdByRealId,
					entryLocalIdByRealId
				)
			)
			.filter((r): r is NonNullable<typeof r> => r !== null)

		specBookWithGraph = attachNarrativeGraph(
			specBook,
			narrativeNodes,
			narrativeRelationships
		)
	}

	const statMaps = {
		lorebookId: lorebook.id,
		bindingLocalIdByRealId,
		entryLocalIdByRealId,
		historyEntryLocalIdByRealId,
		sceneLocalIdByRealId
	}
	const exportedStats = (table: "config" | "value") =>
		statRows
			.filter((row) => row.table === table)
			.map((row) => mapStatRowForExport(row, statMaps))
			.filter((row): row is ExportedStatRow => row !== null)
	specBookWithGraph = attachStats(specBookWithGraph, {
		configs: exportedStats("config"),
		values: exportedStats("value")
	})

	// The book's calendar and main's clock (DESIGN-story-time P5: "it is
	// data, so it exports with the book"). Only when there is something to
	// carry, so a free-form book with no clock exports the bytes it always
	// did — import compares them to detect "unchanged vs conflict".
	// Branches do not export, so neither do their clocks.
	const storyClock = clockOf(lorebook)
	if (lorebook.storyCalendar != null || storyClock) {
		const ext = (specBookWithGraph as any).extensions ?? {}
		specBookWithGraph = {
			...specBookWithGraph,
			extensions: {
				...ext,
				serenepub: {
					...ext.serenepub,
					storyTime: {
						calendar: lorebook.storyCalendar ?? null,
						clock: storyClock
					}
				}
			}
		} as typeof specBookWithGraph
	}

	return { name: lorebook.name, specBookWithGraph }
}

/**
 * The template-layer stat rows this book owns on main — configurations, then
 * values, each in write order so the file's bytes are stable. `session_id`
 * NULL is the template layer; `branch_id` NULL is main.
 */
async function readBookStats(
	lorebookId: number,
	bindingIds: number[],
	entryIds: number[]
) {
	const ownersOf: Record<
		(typeof EXPORTED_STAT_OWNER_KINDS)[number],
		number[]
	> = {
		lorebook: [lorebookId],
		cast_member: bindingIds,
		location: entryIds
	}
	const rows: Array<{
		table: "config" | "value"
		ownerKind: string
		ownerId: number
		slotId: string
		config?: Record<string, unknown>
		value?: { v: unknown }
		historyEntryId: number | null
		sceneId: number | null
		updatedBy: string
		note: string | null
	}> = []
	for (const [table, source] of [
		["config", schema.attributeConfigs],
		["value", schema.attributeValues]
	] as const) {
		const owned = EXPORTED_STAT_OWNER_KINDS.filter(
			(kind) => ownersOf[kind].length > 0
		).map((kind) =>
			and(
				eq(source.ownerKind, kind),
				inArray(source.ownerId, ownersOf[kind])
			)
		)
		const found: any[] = await db
			.select()
			.from(source)
			.where(
				and(
					isNull(source.sessionId),
					onLineSql(source.branchId, MAIN_LINE),
					or(...owned)
				)
			)
			.orderBy(asc(source.id))
		for (const row of found)
			rows.push({
				table,
				ownerKind: row.ownerKind,
				ownerId: row.ownerId,
				slotId: row.slotId,
				...(table === "config"
					? { config: row.config }
					: { value: row.value }),
				historyEntryId: row.historyEntryId,
				sceneId: row.sceneId,
				updatedBy: row.updatedBy,
				note: row.note
			})
	}
	return rows
}
