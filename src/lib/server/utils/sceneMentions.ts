/**
 * Who a scene *mentions* — derived, never stored.
 *
 * ## Why this file exists at all
 *
 * Plan §1's governing rule: **store what cannot be recomputed, derive what can.**
 *
 *  - `participant` is a DECISION. A silent-but-present character is supported by
 *    the roster and by a human, never by the transcript, so it cannot be derived
 *    and stays in `scene_characters`.
 *  - `mentioned` is an OBSERVATION. It is exactly *(scene text × vocabulary)* —
 *    and that is already stored, more precisely, in `message_annotations`, with
 *    the freshness triple (`sourceHash`, `extractorVersion`, `gazetteerHash`)
 *    invalidating it correctly. A second copy at scene granularity was
 *    duplication with weaker invalidation: it went stale silently when a name
 *    moved, and it had to be id-remapped by hand on every absorb.
 *
 * Deriving it buys three things. It updates **retroactively** when the
 * vocabulary improves — add an alias and every historical scene gains the
 * mentions it always should have had. It removes the id-remapping the graph
 * performed on absorb, because annotations resolve through a gazetteer that
 * already reflects the merge. And there is one answer to "who does this scene
 * name", not two that can disagree.
 *
 * ## "Nobody" and "nobody yet" are different answers
 *
 * ⚠ Plan §1's second caveat, and the reason the return type is a union rather
 * than an array. Annotation is a **background lane**: a scene read before the
 * lane reaches it derives an *incomplete* list, and a silently-incomplete answer
 * is worse than a stale one. So `status` says which state the answer is in, and
 * the ids live under a **different property name** in each — `bindingIds` when
 * the whole span was read, `knownBindingIds` when it was not. A caller cannot
 * reach the ids without naming the state it is in; TypeScript refuses
 * `m.bindingIds` on the union. The counts ride along either way, so a caller
 * that wants to say *how* incomplete can.
 *
 * The counting rests on a detail of the annotation store: **a passage that names
 * nothing is still a row** (`entity_key = ''`, `tier = 'none'` — the sentinel).
 * So "has at least one fresh row" is a faithful test of *"this message has been
 * looked at"* and does not count an examined-but-silent message as unexamined.
 *
 * ## What can never be derived, stated rather than discovered
 *
 * `loadVocabulary` contributes a gazetteer name only for a binding that names a
 * **character or a persona** — an unbound "background" binding the graph minted
 * has no row to resolve *to*, so its name stays an open-tier string and it can
 * never appear here. That is a recall limit of the vocabulary, not of this file,
 * and it narrows as the recognition-vocabulary lane widens what resolves.
 */

import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	contentHash,
	loadVocabulary,
	MAX_ANNOTATED_LENGTH,
	type AnnotationVocabulary
} from "$lib/server/annotations"
import { EXTRACTOR_VERSION } from "$lib/server/pipelines/ranking/entities"

// db is the global Db — see db/types.d.ts

/** How much of one scene's span the annotation lane has actually walked. */
export interface MentionCoverage {
	/** Messages the scene selects that still exist. */
	total: number
	/** Of those, how many carry an annotation fresh for this text and vocabulary. */
	annotated: number
}

/**
 * The derived cast half.
 *
 * `derived` — the whole span was read; `bindingIds` is the answer.
 * `pending`  — at least one message has no fresh annotation; `knownBindingIds`
 *              is a floor, not an answer.
 */
export type SceneMentions =
	| {
			status: "derived"
			bindingIds: number[]
			coverage: MentionCoverage
	  }
	| {
			status: "pending"
			knownBindingIds: number[]
			coverage: MentionCoverage
	  }

/** The ids either state carries, for a caller that has already decided what to do about `pending`. */
export const mentionedSoFar = (m: SceneMentions): number[] =>
	m.status === "derived" ? m.bindingIds : m.knownBindingIds

/** Only what the scene's own text says — the span this file reads. */
export interface SceneSpan {
	id: number
	selectedMessageIds: number[] | null
}

const emptyDerived = (): SceneMentions => ({
	status: "derived",
	bindingIds: [],
	coverage: { total: 0, annotated: 0 }
})

/**
 * Derive the mentioned cast of many scenes at once.
 *
 * One vocabulary load, one annotation query, one binding query and one
 * participant query for the whole set — the same "do not do this per scene"
 * discipline `readSceneCasts` follows, and for the same reason: a graph build
 * calls this once for every scene in a lorebook.
 *
 * ⚠ **Present beats mentioned.** A participant is excluded from the result even
 * when the text names them, because §6's whole question is *"was the object
 * there"* — a character who was present is not "merely mentioned", and letting
 * them appear in both would make the relationship bound answer `acknowledged`
 * and `secret` for the same person.
 */
export async function deriveSceneMentions(
	db: Db,
	lorebookId: number,
	scenes: readonly SceneSpan[],
	vocabularyOverride?: AnnotationVocabulary
): Promise<Map<number, SceneMentions>> {
	const out = new Map<number, SceneMentions>()
	if (scenes.length === 0) return out

	const messageIds = [
		...new Set(scenes.flatMap((s) => s.selectedMessageIds ?? []))
	]
	const sceneIds = scenes.map((s) => s.id)

	// A scene with no span names nobody, and that is a complete answer rather
	// than an unread one — there is no text for the lane to fall behind on.
	if (messageIds.length === 0) {
		for (const scene of scenes) out.set(scene.id, emptyDerived())
		return out
	}

	const vocabulary =
		vocabularyOverride ?? (await loadVocabulary(db, lorebookId))

	/**
	 * Driven from `message_annotations`, joined to `session_messages` for the
	 * text — the same shape `searchMessageAnnotations` and `scanCandidates`
	 * read, so there is one spelling of *"is this annotation still true"*.
	 *
	 * `messages` is joined because the annotation's foreign key points there:
	 * a legacy row the store never mirrored has nothing to hang an annotation
	 * on, so it can never be annotated and this scene stays `pending`. That is
	 * the honest answer — the mirror is what makes a message part of the model
	 * — and it is why `total` counts the span rather than the mirrored subset.
	 */
	const annotationRows = await db
		.select({
			messageId: schema.messageAnnotations.messageId,
			entityKey: schema.messageAnnotations.entityKey,
			characterId: schema.messageAnnotations.characterId,
			extractorVersion: schema.messageAnnotations.extractorVersion,
			sourceHash: schema.messageAnnotations.sourceHash,
			gazetteerHash: schema.messageAnnotations.gazetteerHash,
			content: schema.sessionMessages.content
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
		.where(inArray(schema.messageAnnotations.messageId, messageIds))

	/** Messages whose annotation is fresh — examined, whatever it found. */
	const freshMessages = new Set<number>()
	/** `messageId -> the character ids its text names.` */
	const namedBy = new Map<number, { characters: Set<number> }>()
	for (const row of annotationRows) {
		if (row.extractorVersion !== EXTRACTOR_VERSION) continue
		if (row.gazetteerHash !== vocabulary.hash) continue
		const text = (row.content ?? "").slice(0, MAX_ANNOTATED_LENGTH)
		if (row.sourceHash !== contentHash(text)) continue
		// Counted before anything is read off the row: the empty-extraction
		// sentinel means "examined, named nobody", which is coverage, not a hit.
		freshMessages.add(row.messageId)
		if (row.characterId == null) continue
		let named = namedBy.get(row.messageId)
		if (!named) {
			named = { characters: new Set() }
			namedBy.set(row.messageId, named)
		}
		named.characters.add(row.characterId)
	}

	/**
	 * character → the binding that IS them in this lorebook.
	 *
	 * Scoped to the lorebook because the cast is: a character bound in two
	 * books has a row in each, and a scene's cast names the one in its own.
	 */
	const bindingRows = await db
		.select({
			id: schema.lorebookBindings.id,
			characterId: schema.lorebookBindings.characterId
		})
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
	const bindingByCharacter = new Map<number, number>()
	for (const row of bindingRows) {
		if (row.characterId != null)
			bindingByCharacter.set(row.characterId, row.id)
	}

	// Present beats mentioned — the stored half of the cast, which this file
	// does not derive and must not contradict.
	const participantRows = await db
		.select({
			sceneId: schema.sceneCharacters.sceneId,
			bindingId: schema.sceneCharacters.bindingId
		})
		.from(schema.sceneCharacters)
		.where(
			and(
				inArray(schema.sceneCharacters.sceneId, sceneIds),
				eq(schema.sceneCharacters.role, "participant")
			)
		)
	const participantsByScene = new Map<number, Set<number>>()
	for (const row of participantRows) {
		let set = participantsByScene.get(row.sceneId)
		if (!set) participantsByScene.set(row.sceneId, (set = new Set()))
		set.add(row.bindingId)
	}

	for (const scene of scenes) {
		const span = scene.selectedMessageIds ?? []
		const present = participantsByScene.get(scene.id)
		const ids = new Set<number>()
		let annotated = 0
		for (const messageId of span) {
			if (!freshMessages.has(messageId)) continue
			annotated++
			const named = namedBy.get(messageId)
			if (!named) continue
			for (const characterId of named.characters) {
				const bindingId = bindingByCharacter.get(characterId)
				if (bindingId != null && !present?.has(bindingId))
					ids.add(bindingId)
			}
		}
		// Ascending rather than insertion order: nothing stores this, so the
		// only thing order can buy is a stable answer for the same input.
		const bindingIds = [...ids].sort((a, b) => a - b)
		const coverage = { total: span.length, annotated }
		out.set(
			scene.id,
			annotated === span.length
				? { status: "derived", bindingIds, coverage }
				: { status: "pending", knownBindingIds: bindingIds, coverage }
		)
	}
	return out
}

/** One scene's mentions. `deriveSceneMentions` is the batched form; prefer it in a loop. */
export async function deriveSceneMentionsFor(
	db: Db,
	lorebookId: number,
	scene: SceneSpan,
	vocabularyOverride?: AnnotationVocabulary
): Promise<SceneMentions> {
	const map = await deriveSceneMentions(
		db,
		lorebookId,
		[scene],
		vocabularyOverride
	)
	return map.get(scene.id) ?? emptyDerived()
}
