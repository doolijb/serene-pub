/**
 * 🚧 **Background tasks that fire on an event** (PLAN-genre-restructure §4,
 * the events group; lane 2, 2026-10-19) — the host's half, where the event
 * is a host write rather than something a reply's reckoning reads.
 *
 *  - *Picture each new scene* (`image-on-scene`): when a scene opens on
 *    `main` — a person's *Start scene here*, an accepted *New scene?* cue,
 *    or the boundary watcher placing one — the genre's **Scene** action
 *    (`#illustrate-scene`) is fired for the session's owner, exactly as
 *    their own press would: the action's door checks the gate, its spec
 *    draws and posts. Not awaited: a scene opens at once and the picture
 *    follows. Skipped, with nothing said, when no image model is set up —
 *    a run that could only fail is not started.
 *
 * The other three events live elsewhere: *Describe new places* rides the
 * reckoning (`genres/story/reckon.ts`), *End what runs out* is the ruleset
 * handler's (`rulesets/resolve.ts` `expiryOf`), and *Mark goals reached*
 * the annex write's (`goalsReached.ts`).
 */
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

/** The Scene action's key (core-catalog `ILLUSTRATE_SCENE_ACTION_KEY`). */
const SCENE_ACTION_KEY = "illustrate-scene"

/** The session's socket server, when one is installed (boot binds it). */
function installedIo(): unknown {
	return (globalThis as Record<symbol, unknown>)[Symbol.for("serene-pub.notificationViewingIo")]
}

/**
 * A scene opened in `sessionId` on `channel`. Fires the Scene action when the
 * session's *Picture each new scene* is on; resolves whether it fired.
 */
export async function onSceneOpened(
	db: Db,
	params: { sessionId: number; channel: string }
): Promise<{ fired: boolean; reason?: string }> {
	if (params.channel !== "main") return { fired: false, reason: "not the story's channel" }
	const { sessionTaskModes } = await import("$lib/server/sessions/tasks")
	const mode = (await sessionTaskModes(db, params.sessionId))["image-on-scene"]
	if (!mode || mode === "off") return { fired: false, reason: "off" }

	const [session] = await db
		.select({ userId: schema.sessions.userId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, params.sessionId))
		.limit(1)
	if (!session?.userId) return { fired: false, reason: "no owner" }

	const { resolveCapabilityTarget } = await import("$lib/server/connections/capabilityTarget")
	const target = await resolveCapabilityTarget(db, { capability: "text->image" })
	if (!target.ok) return { fired: false, reason: "no image model" }

	const { listSessionActions } = await import("$lib/server/pipelines/entities/sessionActions")
	const venues = await listSessionActions(db, params.sessionId, { userId: session.userId })
	const offered = Object.values(venues ?? {}).flatMap((v) => Object.values(v ?? {}).flat()) as Array<{
		specSlug?: string
		key?: string
		enabled?: boolean
	}>
	const scene = offered.find((a) => a?.key === SCENE_ACTION_KEY && !!a.specSlug && a.enabled !== false)
	if (!scene?.specSlug) return { fired: false, reason: "no Scene action" }
	const { actionIdentity } = await import("$lib/shared/actions/identity")
	const identity = actionIdentity({ specSlug: scene.specSlug, key: SCENE_ACTION_KEY })

	const { fireAction } = await import("$lib/server/pipelines/runtime/fireAction")
	void fireAction(db, {
		sessionId: params.sessionId,
		action: identity,
		actor: { userId: session.userId },
		io: installedIo() as never
	}).catch((err: unknown) =>
		console.warn(`[tasks] Picture each new scene: session ${params.sessionId}:`, err)
	)
	return { fired: true }
}
