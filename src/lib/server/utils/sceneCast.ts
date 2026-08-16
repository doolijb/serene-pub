/**
 * Scene cast read/write, over the `scene_characters` join table.
 *
 * Storage changed; the *shape* everything else sees did not. Socket payloads,
 * the client, and the export format all still speak
 * `{ participantCharacters: number[], mentionedCharacters: number[] }`, so this
 * module is the only place that knows cast is rows rather than JSON arrays.
 * That is deliberate — converting the ~140 call sites to think in join rows
 * would have been a far larger and riskier change than confining it here.
 *
 * Ordering is preserved through the `ordinal` column rather than left to the
 * database: export serialization writes the cast in stored order and lorebook
 * import hashes exported bytes to detect "unchanged vs conflict", so a
 * reordered read would mark every lorebook conflicted on re-import.
 */
import { and, asc, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { PgliteDatabase } from "drizzle-orm/pglite"

// The shared `db` is reached through a lazy dynamic import rather than a
// top-level one, matching the other db-helper modules in this directory
// (characterBindingSync.ts, summarizer/availableSceneCast.ts,
// duplicateBindingDetection.ts).
//
// This is load-bearing, not stylistic. A static `import { db } from
// "$lib/server/db"` pulls that module's *boot side effects* — the data-dir
// lock check, migrations, and `await sync()` — into the module graph of
// everything that imports this file. That made unit tests which build their
// own PGlite via createTestDb() open the real application database instead,
// failing outright whenever the app was running and holding the lock.
// It also adds a static edge into the db module graph, which is the kind of
// thing that reshuffles Rollup's chunking and surfaces boot-time TDZ errors
// in packaged builds.

/** Anything with `.select`/`.insert`/`.delete` — the db handle or a transaction. */
type DbLike = PgliteDatabase<typeof schema>

async function defaultDb(): Promise<DbLike> {
	return (await import("$lib/server/db")).db
}

export interface SceneCast {
	participantCharacters: number[]
	mentionedCharacters: number[]
}

const EMPTY_CAST: SceneCast = Object.freeze({
	participantCharacters: [],
	mentionedCharacters: []
}) as SceneCast

type CastRow = {
	sceneId: number
	bindingId: number
	role: schema.SceneCharacterRole
}

/** Groups already-ordered join rows into the array shape callers expect. */
function group(rows: CastRow[]): Map<number, SceneCast> {
	const out = new Map<number, SceneCast>()
	for (const row of rows) {
		let cast = out.get(row.sceneId)
		if (!cast) {
			cast = { participantCharacters: [], mentionedCharacters: [] }
			out.set(row.sceneId, cast)
		}
		if (row.role === "participant") cast.participantCharacters.push(row.bindingId)
		else cast.mentionedCharacters.push(row.bindingId)
	}
	return out
}

/**
 * Cast for many scenes at once. Returns a Map missing any scene with no cast —
 * use `castFor()` to get an empty-but-present value.
 *
 * One indexed query for the whole set. The JSON columns this replaces forced
 * "which scenes feature X" to load every scene row and filter in JS.
 */
export async function readSceneCasts(
	sceneIds: number[],
	dbInstance?: DbLike
): Promise<Map<number, SceneCast>> {
	if (sceneIds.length === 0) return new Map()
	const database = dbInstance ?? (await defaultDb())
	const rows = await database
		.select({
			sceneId: schema.sceneCharacters.sceneId,
			bindingId: schema.sceneCharacters.bindingId,
			role: schema.sceneCharacters.role
		})
		.from(schema.sceneCharacters)
		.where(inArray(schema.sceneCharacters.sceneId, sceneIds))
		.orderBy(
			asc(schema.sceneCharacters.sceneId),
			asc(schema.sceneCharacters.ordinal),
			asc(schema.sceneCharacters.id)
		)
	return group(rows)
}

export async function readSceneCast(
	sceneId: number,
	dbInstance?: DbLike
): Promise<SceneCast> {
	const casts = await readSceneCasts([sceneId], dbInstance)
	return castFor(casts, sceneId)
}

/** A scene absent from the map has no cast rows, which is an empty cast. */
export function castFor(
	casts: Map<number, SceneCast>,
	sceneId: number
): SceneCast {
	return (
		casts.get(sceneId) ?? {
			participantCharacters: [],
			mentionedCharacters: []
		}
	)
}

export { EMPTY_CAST }

/**
 * Replace one scene's cast wholesale.
 *
 * Delete-then-insert rather than a diff: the arrays this replaces were always
 * written wholesale, so a caller passing `[a, b]` means "the cast is exactly
 * a and b" — a diff would have to infer removals anyway. Doing it in one
 * statement pair also keeps `ordinal` trivially correct.
 *
 * Writes EXACTLY what it is given, deduped within each role but NOT across
 * them. Disjointness is deliberately not enforced here: a binding legitimately
 * holds both roles (absorb remaps each independently, and its tests assert the
 * survivor ends up in both), which is precisely why the unique index is on
 * (scene, binding, ROLE). Callers that do want "present beats mentioned" —
 * scenes:process and chats:summarize via reconcileParticipantsAndMentioned,
 * graphBuilder via its admit() precedence — already apply it upstream. Folding
 * that rule in here instead would silently discard a caller's real data.
 *
 * Ids are NOT validated here; callers already scope them (scenes:create/update
 * via filterCharacterIdsToLorebook, the graph build via its server-derived
 * tempId map). The FK is the backstop: an id that isn't a real binding fails
 * the insert rather than silently persisting as a dangling reference, which is
 * the entire point of the join table.
 */
export async function writeSceneCast(
	sceneId: number,
	cast: Partial<SceneCast>,
	dbInstance?: DbLike
): Promise<void> {
	const database = dbInstance ?? (await defaultDb())
	const participants = [...new Set(cast.participantCharacters ?? [])]
	const mentioned = [...new Set(cast.mentionedCharacters ?? [])]

	await database
		.delete(schema.sceneCharacters)
		.where(eq(schema.sceneCharacters.sceneId, sceneId))

	const rows = [
		...participants.map((bindingId, ordinal) => ({
			sceneId,
			bindingId,
			role: "participant" as const,
			ordinal
		})),
		...mentioned.map((bindingId, ordinal) => ({
			sceneId,
			bindingId,
			role: "mentioned" as const,
			ordinal
		}))
	]
	if (rows.length > 0) {
		await database.insert(schema.sceneCharacters).values(rows)
	}
}

/**
 * Repoint every appearance of `fromBindingId` onto `toBindingId` across a
 * lorebook — the absorb/merge operation.
 *
 * Replaces a loop that loaded every scene in the lorebook, filtered both JSON
 * arrays in JS, and issued one UPDATE per affected scene. The conflict case
 * (the survivor already occupies that scene+role slot) is what the old code's
 * `new Set(...)` dedupe handled and what the unique index now enforces, so
 * duplicates are dropped rather than inserted.
 */
export async function repointSceneCast(
	lorebookId: number,
	fromBindingId: number,
	toBindingId: number,
	dbInstance?: DbLike
): Promise<void> {
	const database = dbInstance ?? (await defaultDb())
	const scenesInLorebook = await database
		.select({ id: schema.scenes.id })
		.from(schema.scenes)
		.where(eq(schema.scenes.lorebookId, lorebookId))
	const sceneIds = scenesInLorebook.map((s) => s.id)
	if (sceneIds.length === 0) return

	const rows = await database
		.select({
			id: schema.sceneCharacters.id,
			sceneId: schema.sceneCharacters.sceneId,
			role: schema.sceneCharacters.role
		})
		.from(schema.sceneCharacters)
		.where(
			and(
				eq(schema.sceneCharacters.bindingId, fromBindingId),
				inArray(schema.sceneCharacters.sceneId, sceneIds)
			)
		)
	if (rows.length === 0) return

	// Rows the survivor already occupies — repointing onto them would violate
	// the unique index, so the absorbed row is simply removed instead.
	const survivorRows = await database
		.select({
			sceneId: schema.sceneCharacters.sceneId,
			role: schema.sceneCharacters.role
		})
		.from(schema.sceneCharacters)
		.where(
			and(
				eq(schema.sceneCharacters.bindingId, toBindingId),
				inArray(schema.sceneCharacters.sceneId, sceneIds)
			)
		)
	const taken = new Set(survivorRows.map((r) => `${r.sceneId}|${r.role}`))

	for (const row of rows) {
		if (taken.has(`${row.sceneId}|${row.role}`)) {
			await database
				.delete(schema.sceneCharacters)
				.where(eq(schema.sceneCharacters.id, row.id))
		} else {
			await database
				.update(schema.sceneCharacters)
				.set({ bindingId: toBindingId })
				.where(eq(schema.sceneCharacters.id, row.id))
			taken.add(`${row.sceneId}|${row.role}`)
		}
	}
}
