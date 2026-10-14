/**
 * 🚧 The session page's **scene cues** and **scene settings** (live scenes
 * §4–§7, lane D): what the server says the session offers — Suggested mode's
 * *New scene?* chips, one per line and lane — and how the session places its
 * scene boundaries and summarizes its scenes, resolved. Read once when the
 * session opens (`scenes:cues`) and kept by the push every change sends (the
 * page inbox's standing `scenes:cues` key). The conversation's chip is drawn
 * from `cues` (the dossier's `sceneCues`, the owner's only); Chronicle reads
 * `settings` through the page's `history-entries` answer.
 *
 * Also the page's three asks for them, each settled on ITS reply:
 * `decide` (`scenes:decideCue` — a chip's **Yes** / **Not here**),
 * `summarize` (`scenes:processAll` — Chronicle's *Summarize*, *Summarize all
 * (N)* and *Close and summarize*) and `readOpenScenes` (`scenes:openScenes` —
 * Chronicle's *Open scene* card). Their refusals are the asking widget's to
 * say (Layout's HANDLED_ERROR_EVENTS); none of them toasts.
 */
import { DEFAULT_SCENE_SETTINGS, type SceneSettings } from "@serene-pub/sdk"
import type { TypedSocket } from "$lib/client/sockets/typedSocket"
import type { SessionPageInbox } from "$lib/client/components/sessionPage/sessionPageInbox.svelte"
import { awaitReply } from "$lib/client/utils/awaitReply"
import { interestKey } from "$lib/shared/sockets/interest"

export interface SceneCuesFlowDeps {
	socket: TypedSocket
	inbox: SessionPageInbox
	/** The session in the route. */
	sessionId(): number
}

let asked = 0
const requestId = (what: string) =>
	`widget-scene-${what}:${++asked}:${Math.random().toString(36).slice(2, 8)}`

/** The page's scene cues and settings, and its asks about them. */
export function createSceneCuesFlow(d: SceneCuesFlowDeps) {
	const socket = d.socket
	let cues = $state<Sockets.Scenes.SceneCue[]>([])
	let settings = $state<SceneSettings>(DEFAULT_SCENE_SETTINGS)
	let mayPlace = $state(false)
	/** Which session the held answer is for — a stale one is not shown. */
	let heldFor = $state<number | null>(null)

	d.inbox.on("scenes:cues", (msg) => {
		if (msg?.sessionId !== d.sessionId()) return
		cues = Array.isArray(msg.cues) ? msg.cues : []
		settings = msg.settings ?? DEFAULT_SCENE_SETTINGS
		mayPlace = msg.mayPlace === true
		heldFor = msg.sessionId
	})

	// Read once per session the route opens; the push keeps it after.
	$effect(() => {
		const sessionId = d.sessionId()
		if (!Number.isFinite(sessionId)) return
		cues = []
		heldFor = null
		socket?.emit("scenes:cues", { sessionId } satisfies Sockets.Scenes.Cues.Params)
	})

	/** A chip's **Yes** (open a scene at its line) or **Not here**. */
	async function decide(cueId: number, accept: boolean): Promise<number | null> {
		const id = requestId("cue")
		const sessionId = d.sessionId()
		const reply = await awaitReply({
			socket,
			event: "scenes:decideCue",
			params: { cueId, accept, requestId: id } satisfies Sockets.Scenes.DecideCue.Params,
			replyKey: interestKey("scenes:decideCue", sessionId),
			errorEvent: "scenes:decideCue:error",
			matchError: (data) => (data as { requestId?: string })?.requestId === id,
			fallbackError: "the suggestion could not be decided",
			match: (data) => data.requestId === id
		})
		return reply.sceneId ?? null
	}

	/** Summarize these scenes in the background — or every one with no summary yet. */
	async function summarize(sceneIds?: number[]): Promise<number> {
		const id = requestId("summarize")
		const sessionId = d.sessionId()
		const reply = await awaitReply({
			socket,
			event: "scenes:processAll",
			params: {
				sessionId,
				...(sceneIds ? { sceneIds } : {}),
				requestId: id
			} satisfies Sockets.Scenes.ProcessAll.Params,
			replyKey: interestKey("scenes:processAll", sessionId),
			errorEvent: "scenes:processAll:error",
			matchError: (data) => (data as { requestId?: string })?.requestId === id,
			fallbackError: "the scenes could not be summarized",
			match: (data) => data.requestId === id
		})
		return reply.sceneIds?.length ?? 0
	}

	/** The session's open scenes, with their lines so far and proposed cast. */
	async function readOpenScenes(): Promise<Sockets.Scenes.OpenScenes.Response> {
		const id = requestId("open-scenes")
		const sessionId = d.sessionId()
		return awaitReply({
			socket,
			event: "scenes:openScenes",
			params: { sessionId, request: id } satisfies Sockets.Scenes.OpenScenes.Params,
			replyKey: interestKey("scenes:openScenes", sessionId),
			errorEvent: "scenes:openScenes:error",
			matchError: (data) => (data as { request?: string })?.request === id,
			fallbackError: "the open scene could not be read",
			match: (data) => data.request === id
		})
	}

	return {
		/** The cues offered now, oldest first — empty until the first answer for this session. */
		get cues() {
			return heldFor === d.sessionId() ? cues : []
		},
		/** The session's scene settings, resolved (the defaults until the first answer). */
		get settings() {
			return settings
		},
		/** The session may place a scene at all. */
		get mayPlace() {
			return mayPlace
		},
		decide,
		summarize,
		readOpenScenes
	}
}

/** The page's scene cues (`createSceneCuesFlow`). */
export type SceneCuesFlow = ReturnType<typeof createSceneCuesFlow>
