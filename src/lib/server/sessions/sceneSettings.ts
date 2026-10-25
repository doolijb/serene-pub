/**
 * 🚧 The server half of a session's **scene settings** (PROPOSAL-live-scenes
 * §4–§5, lane D): the write of its override on `sessions.metadata.scenes`,
 * and the one read every scene-placing path asks — the resolved settings,
 * and whether the session may place a scene at all. The read half of the
 * cascade is `$lib/shared/sessions/sceneSettings`.
 *
 * `jsonb_set` / `-` as SQL, like `writePlayerLabel` and `writeTurnOrder`:
 * the row's other metadata keys are untouched by construction, however stale
 * the caller's copy of the row is. `metadata` is a `json` column, so both
 * sides are cast and the value goes back as `json`.
 */
import { eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	declaredScenePlace,
	declaredTriggerStates,
	i18nText,
	sceneSettingsFindings,
	type BoundaryTriggerDecl,
	type SceneSettings,
	type SceneSettingsDecl
} from "@serene-pub/sdk"
import {
	SCENE_SETTINGS_METADATA_KEY,
	sessionSceneSettings,
	storedSceneSettings
} from "$lib/shared/sessions/sceneSettings"

/** A scene-settings override that does not read, refused with its sentences. */
export class SceneSettingsRefusal extends Error {}

/**
 * Store the session's override (checked: a mode, triggers and a summary
 * mode that read), or clear it (`null`: the genre's settings apply again).
 */
export async function writeSceneSettings(
	db: Db,
	sessionId: number,
	decl: SceneSettingsDecl | null
): Promise<void> {
	if (decl === null) {
		await db.execute(sql`
			update ${schema.sessions}
			set ${sql.identifier("metadata")} = (
				coalesce(${schema.sessions.metadata}, '{}')::jsonb - ${SCENE_SETTINGS_METADATA_KEY}::text
			)::json
			where ${schema.sessions.id} = ${sessionId}
		`)
		return
	}
	// 🚧 A session may switch its genre's declared triggers (★9) and nothing
	// else beyond core's; the place is the genre's (live scenes §15 G1–G2).
	const { sessionBoundaryTriggers } = await import("$lib/server/scenes/liveScenes")
	const declared = (await sessionBoundaryTriggers(db, sessionId)).map((t) => t.key)
	const findings = sceneSettingsFindings(decl, "Scenes", {
		layer: "session",
		declaredTriggers: declared
	})
	if (findings.length) throw new SceneSettingsRefusal(findings.join(" "))
	await db.execute(sql`
		update ${schema.sessions}
		set ${sql.identifier("metadata")} = jsonb_set(
			coalesce(${schema.sessions.metadata}, '{}')::jsonb,
			${`{${SCENE_SETTINGS_METADATA_KEY}}`}::text[],
			${JSON.stringify(decl)}::jsonb,
			true
		)::json
		where ${schema.sessions.id} = ${sessionId}
	`)
}

/** What a scene-placing path needs to know about a session, read once. */
export interface SessionSceneContext {
	sessionId: number
	/** The session's owner — who a boundary the watcher places is placed as. */
	ownerId: number
	lorebookId: number | null
	settings: SceneSettings
	/**
	 * The session may place a scene at all: it reads a lorebook, its genre
	 * writes scenes (`writes.scenes`), and lore writes are not Off — the
	 * refusals `openScene` itself makes, asked first so the watcher stays
	 * quiet rather than recording what could never be accepted.
	 */
	mayPlace: boolean
	/**
	 * 🚧 The state key the genre names as its place
	 * (`SessionShape.scenes.place`, live scenes §15 G2), or null.
	 */
	placeKey: string | null
	/**
	 * 🚧 The genre's **declared boundary triggers** (★9), off its
	 * summarize-scene spec, each with the session's switch (`on`: true
	 * unless its override's `triggers[key]` is false) and its words.
	 */
	declaredTriggers: Array<BoundaryTriggerDecl & { on: boolean; words: string }>
}

/**
 * The session's scene settings, resolved, and whether it may place a scene.
 * Null when the session does not exist. A genre this build does not declare
 * resolves its shape as absent (the defaults), the posture every genre read
 * takes.
 */
export async function sessionSceneContext(
	db: Db,
	sessionId: number
): Promise<SessionSceneContext | null> {
	const [row] = await db
		.select({
			userId: schema.sessions.userId,
			lorebookId: schema.sessions.lorebookId,
			genreId: schema.sessions.genreId,
			metadata: schema.sessions.metadata
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!row) return null
	const { getSessionGenre, STANDARD_GENRE_ID } = await import(
		"$lib/server/pipelines/entities/sessionGenres"
	)
	let shape: unknown = undefined
	try {
		shape = (await getSessionGenre(db, row.genreId ?? STANDARD_GENRE_ID))?.shape
	} catch {
		shape = undefined
	}
	const settings = sessionSceneSettings(shape, row.metadata)
	const { sessionBoundaryTriggers } = await import("$lib/server/scenes/liveScenes")
	const declared = await sessionBoundaryTriggers(db, sessionId).catch(() => [])
	const states = declaredTriggerStates(declared, storedSceneSettings(row.metadata))
	const declaredTriggers = declared.map((t) => ({
		...t,
		on: states[t.key] !== false,
		words: i18nText(t.label) ?? t.key
	}))
	// 🚧 pr-6 (§B-3a): every session has a book, so a scene always has a home.
	const { resolveWrites, loreWritesOffRefusal } = await import(
		"$lib/server/messages/writes"
	)
	const mayPlace =
		resolveWrites(shape).scenes && !(await loreWritesOffRefusal(db, sessionId))
	return {
		sessionId,
		ownerId: row.userId,
		lorebookId: row.lorebookId ?? null,
		settings,
		mayPlace,
		placeKey: declaredScenePlace(shape)?.stateKey ?? null,
		declaredTriggers
	}
}
