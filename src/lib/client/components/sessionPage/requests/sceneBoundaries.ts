/**
 * 🚧 The conversation's **scene boundaries** (PROPOSAL-live-scenes §7, §14
 * C): `scene-open` (*Start scene here*), `scene-close` (*End scene here*, a
 * divider's *End scene*), `scene-move`, `scene-rename` (a divider's name)
 * and `scene-remove` (a divider's *Remove boundary*). Core's widgets only
 * (the askers table, `./askers.ts`).
 *
 * Each is refused here, in words, before anything is sent, where the host
 * would refuse it anyway: a viewer who may not place scene boundaries (the
 * dossier's `sceneBoundaries` — the session's owner, a genre that writes
 * scenes, a session reading a lorebook), and a scene that is not this
 * session's. The server judges the rest (overlaps, channels, the clock),
 * and its refusal is the asking widget's rejection, never a toast (R77).
 *
 * The boundary writes resolve with the scene's id; the scene itself arrives
 * in the dossier through the `scenes:list` cascade. *Remove boundary* asks
 * the person first — the page's own question, what goes and what stays
 * (STYLE-GUIDE §6.6) — and resolves `removed: false` when they keep it.
 *
 * 🚧 Lane E: *Remove boundary* **merges** a scene into the one before it on
 * its lane when there is one (`scenes:merge`), and deletes it only when it
 * is the lane's first; `scene-open` takes `closeAt` (a closed scene in one
 * write, *Mark as scene*), and `scene-move`'s `closedAt: null` reopens a
 * closed scene.
 */
import type { WidgetRequests } from "@serene-pub/sdk"
import { sceneBefore } from "$lib/client/components/sessionPage/liveSceneProjection"

type Result<K extends keyof WidgetRequests> = WidgetRequests[K]["result"]

/** A scene of this session, as the page holds it (`scenes:list`). */
export interface BoundaryScene {
	id: number
	name?: string | null
	sessionId?: number | null
	channel?: string | null
	openedAtMessageId?: number | null
	closedAtMessageId?: number | null
	selectedMessageIds?: number[] | null
	summary?: string | null
}

/** What these answers need of the page. */
export interface SceneBoundaryDeps {
	/** The page's session; null when it has none yet. */
	sessionId(): number | null
	/** May the viewer place scene boundaries here (the dossier's verdict)? */
	sceneBoundaries(): boolean
	/** This session's scenes, as the page holds them. */
	sceneList(): readonly BoundaryScene[]
	/** One of the session's loaded lines, for its channel. */
	findMessage(messageId: number): { channel?: string | null } | undefined
	/** `scenes:open`, settled on its own reply; `closeAt` opens it closed. */
	openScene(ask: {
		sessionId: number
		channel: string
		atMessageId: number
		closeAt?: number
	}): Promise<{ scene: { id: number } }>
	/** `scenes:close`, settled on its own reply. */
	closeScene(ask: {
		sessionId: number
		sceneId: number
		atMessageId?: number
	}): Promise<{ scene: { id: number } }>
	/** `scenes:moveBoundary`, settled on its own reply. */
	moveSceneBoundary(ask: {
		sessionId: number
		sceneId: number
		openedAt?: number
		closedAt?: number | null
	}): Promise<{ scene: { id: number } }>
	/** `scenes:update` with the name alone. */
	renameScene(ask: { sceneId: number; name: string | null }): Promise<void>
	/**
	 * The page's question before a removal: true when the person removes it.
	 * `into` is the scene it would join (a merge), null when it is deleted.
	 */
	confirmRemoveScene(scene: BoundaryScene, into: BoundaryScene | null): Promise<boolean>
	/** `scenes:delete`. */
	deleteScene(sceneId: number): Promise<void>
	/** 🚧 `scenes:merge`: the scene joins the one before it on its lane. */
	mergeScene(ask: { sessionId: number; sceneId: number }): Promise<{ scene: { id: number } }>
}

const NOT_YOURS =
	"only the session's owner places scene boundaries, where its genre writes scenes and it reads a lorebook"

const isId = (v: unknown): v is number =>
	typeof v === "number" && Number.isInteger(v) && v > 0

/** The session, or a refusal: no session, or a viewer who may not place boundaries. */
function sessionFor(deps: SceneBoundaryDeps): number {
	const sessionId = deps.sessionId()
	if (sessionId == null) throw new Error("this page has no session to place a scene in")
	if (!deps.sceneBoundaries()) throw new Error(NOT_YOURS)
	return sessionId
}

/** This session's scene `sceneId`, or a refusal. */
function sceneOf(deps: SceneBoundaryDeps, sceneId: unknown, sessionId: number): BoundaryScene {
	if (!isId(sceneId)) throw new Error("say which scene, by its id")
	const scene = deps.sceneList().find((s) => s.id === sceneId)
	if (!scene || (scene.sessionId != null && scene.sessionId !== sessionId))
		throw new Error("that scene is not one of this session's")
	return scene
}

/** A message id param, or undefined when absent; a refusal when malformed. */
function messageParam(value: unknown, what: string): number | undefined {
	if (value === undefined || value === null) return undefined
	if (!isId(value)) throw new Error(`${what} must be a message id`)
	return value
}

/** Answer one `scene-open`: a scene opens at the line, on its lane. */
export async function answerSceneOpen(
	params: unknown,
	deps: SceneBoundaryDeps
): Promise<Result<"scene-open">> {
	const p = (params ?? {}) as Record<string, unknown>
	const atMessageId = messageParam(p.messageId, "messageId")
	if (atMessageId === undefined) throw new Error("say which line the scene starts at")
	const closeAt = messageParam(p.closeAt, "closeAt")
	if (closeAt !== undefined && closeAt < atMessageId)
		throw new Error("a scene cannot end before the line it starts at")
	const sessionId = sessionFor(deps)
	const channel =
		typeof p.channel === "string" && p.channel.trim()
			? p.channel.trim()
			: deps.findMessage(atMessageId)?.channel || "main"
	const reply = await deps.openScene({
		sessionId,
		channel,
		atMessageId,
		...(closeAt !== undefined ? { closeAt } : {})
	})
	return { sceneId: reply.scene.id }
}

/** Answer one `scene-close`: the open scene ends at the line, or at its lane's newest. */
export async function answerSceneClose(
	params: unknown,
	deps: SceneBoundaryDeps
): Promise<Result<"scene-close">> {
	const p = (params ?? {}) as Record<string, unknown>
	const atMessageId = messageParam(p.messageId, "messageId")
	const sessionId = sessionFor(deps)
	const scene = sceneOf(deps, p.sceneId, sessionId)
	if (scene.openedAtMessageId == null)
		throw new Error("that scene was captured by selection: it has no boundary to close")
	if (scene.closedAtMessageId != null) throw new Error("that scene is already closed")
	const reply = await deps.closeScene({
		sessionId,
		sceneId: scene.id,
		...(atMessageId !== undefined ? { atMessageId } : {})
	})
	return { sceneId: reply.scene.id }
}

/** Answer one `scene-move`: a live scene's opening, or a closed one's end, moves. */
export async function answerSceneMove(
	params: unknown,
	deps: SceneBoundaryDeps
): Promise<Result<"scene-move">> {
	const p = (params ?? {}) as Record<string, unknown>
	const openedAt = messageParam(p.openedAt, "openedAt")
	// 🚧 `closedAt: null`, said, is a reopen; absent is no move.
	const reopens = "closedAt" in p && p.closedAt === null
	const closedAt = messageParam(p.closedAt, "closedAt")
	if (openedAt === undefined && closedAt === undefined && !reopens)
		throw new Error("say which boundary moves: openedAt, closedAt or both")
	const sessionId = sessionFor(deps)
	const scene = sceneOf(deps, p.sceneId, sessionId)
	if (scene.openedAtMessageId == null)
		throw new Error("that scene was captured by selection: it has no boundaries to move")
	if (closedAt !== undefined && scene.closedAtMessageId == null)
		throw new Error("the scene is still open: end it before moving its end")
	if (reopens && scene.closedAtMessageId == null) throw new Error("that scene is already open")
	const reply = await deps.moveSceneBoundary({
		sessionId,
		sceneId: scene.id,
		...(openedAt !== undefined ? { openedAt } : {}),
		...(closedAt !== undefined ? { closedAt } : reopens ? { closedAt: null } : {})
	})
	return { sceneId: reply.scene.id }
}

/** A scene's name is a line of text; past this it is cut. */
export const SCENE_NAME_MAX = 200

/** Answer one `scene-rename`; a blank name clears it. */
export async function answerSceneRename(
	params: unknown,
	deps: SceneBoundaryDeps
): Promise<Result<"scene-rename">> {
	const p = (params ?? {}) as Record<string, unknown>
	if (p.name !== null && typeof p.name !== "string")
		throw new Error("scene-rename takes a name, or null to clear it")
	const sessionId = sessionFor(deps)
	const scene = sceneOf(deps, p.sceneId, sessionId)
	const name =
		typeof p.name === "string" ? p.name.trim().slice(0, SCENE_NAME_MAX) || null : null
	await deps.renameScene({ sceneId: scene.id, name })
}

/**
 * Answer one `scene-remove`: asked first. 🚧 A scene with one before it on
 * its lane joins it (`scenes:merge`: its lines become that scene's); the
 * lane's first scene goes, its lines staying outside any scene.
 */
export async function answerSceneRemove(
	params: unknown,
	deps: SceneBoundaryDeps
): Promise<Result<"scene-remove">> {
	const p = (params ?? {}) as Record<string, unknown>
	const sessionId = sessionFor(deps)
	const scene = sceneOf(deps, p.sceneId, sessionId)
	if (scene.openedAtMessageId == null)
		throw new Error(
			"that scene was captured by selection: it has no boundary to remove (delete it in the lorebook)"
		)
	const into = sceneBefore(
		scene,
		deps.sceneList().filter((s) => s.sessionId == null || s.sessionId === sessionId)
	)
	if (!(await deps.confirmRemoveScene(scene, into))) return { removed: false }
	if (into) {
		const reply = await deps.mergeScene({ sessionId, sceneId: scene.id })
		return { removed: true, mergedInto: reply.scene.id }
	}
	await deps.deleteScene(scene.id)
	return { removed: true }
}
