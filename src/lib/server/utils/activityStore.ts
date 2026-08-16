import { v4 as uuidv4 } from "uuid"

export type GraphBuildActivity = {
	kind: "graph_build"
	id: string
	userId: number
	lorebookId: number
	lorebookLabel: string
	mode: "replace" | "extend"
	status: "building" | "review" | "error"
	phase: string
	sceneIndex: number
	totalScenes: number
	nodesFound: number
	relsFound: number
	currentPair?: string
	currentSceneLabel?: string
	proposal?: Sockets.NarrativeGraph.GraphProposal
	sceneLabels?: string[]
	seedTempIdMap?: Record<string, number>
	seedNodeNames?: Record<string, string>
	/**
	 * Why the relationship count came out as it did. Rides here rather than
	 * inside `proposal` because it describes the run, not the data being
	 * applied — apply must never see it.
	 */
	relationshipDiagnostics?: Sockets.NarrativeGraph.RelationshipDiagnostics
	/** Proposed names screened out as World Lore subjects — reported, not dropped. */
	filteredWorldLoreNames?: string[]
	errorMessage?: string
	errorRaw?: string
	startedAt: string
}

export type SceneSummarizeActivity = {
	kind: "scene_summarize"
	id: string
	userId: number
	sceneId: number
	sceneName?: string
	lorebookId: number
	lorebookLabel?: string
	historyEntryId?: number
	/**
	 * The scene row was created solely to carry this run, so abandoning the run
	 * should take the row with it.
	 *
	 * This kind serves two origins: a chat-side summarize, which creates an
	 * empty scene up front, and a lorebook-side re-process of a scene the user
	 * already owns. Without this flag they are indistinguishable at cancel time,
	 * and deleting on "a scene_summarize ended" would destroy a real scene the
	 * first time someone cancels a re-process.
	 *
	 * It rides the activity (rather than living in the initiating client) so it
	 * survives minimize, Activity-panel cancel, and reconnect.
	 */
	ephemeralOnCancel?: boolean
	status: "running" | "review" | "error"
	phase?: "drafting" | "synthesizing" | "naming" | "extracting"
	batch?: number
	totalBatches?: number
	errorMessage?: string
	pendingResult?: {
		content: string
		name?: string
		participantCharacters: number[]
		mentionedCharacters: number[]
		suggestedParticipantCharacters?: string[]
		suggestedMentionedCharacters?: string[]
		raw: string
	}
	startedAt: string
}

export type CompileHistoryEntryActivity = {
	kind: "compile_history_entry"
	id: string
	userId: number
	historyEntryId: number
	historyEntryDate: string
	lorebookId: number
	lorebookLabel: string
	status: "running" | "review" | "error"
	phase?: "drafting" | "synthesizing"
	batch?: number
	totalBatches?: number
	errorMessage?: string
	pendingResult?: { content: string }
	startedAt: string
}

/**
 * Chat-side world/character lore summarization.
 *
 * Modelled on CompileHistoryEntryActivity rather than SceneSummarizeActivity
 * because there is **no row to point at**: unlike scenes, nothing is persisted
 * until the user saves, so `pendingResult` is the only copy of the generated
 * text. That difference drives the supersede rule in startChatSummarize too.
 */
export type ChatSummarizeActivity = {
	kind: "chat_summarize"
	id: string
	userId: number
	chatId: number
	chatLabel?: string
	loreType: "world" | "character"
	lorebookId: number
	topic?: string
	status: "running" | "review" | "error"
	phase?: "drafting" | "synthesizing" | "naming" | "extracting"
	batch?: number
	totalBatches?: number
	errorMessage?: string
	pendingResult?: {
		content: string
		name?: string
		raw: string
		/**
		 * Minted server-side by resolveOrCreateBinding for character lore. It
		 * has to ride the activity: the client otherwise only ever sees it on
		 * the `chats:summarize:complete` payload, so a review reopened from the
		 * Activity panel would save the entry with a null binding.
		 */
		lorebookBindingId?: number | null
	}
	startedAt: string
}

export type Activity =
	| GraphBuildActivity
	| SceneSummarizeActivity
	| CompileHistoryEntryActivity
	| ChatSummarizeActivity

type Emitter = (event: string, data: unknown) => void

class ActivityStore {
	private activities = new Map<string, Activity>()
	private emitters = new Map<Emitter, { userId: number; isAdmin: boolean }>()
	private abortControllers = new Map<string, AbortController>()

	registerEmitter(fn: Emitter, userId: number, isAdmin: boolean) {
		this.emitters.set(fn, { userId, isAdmin })
		fn("activity:update", { activities: this.getFor(userId, isAdmin) })
	}

	unregisterEmitter(fn: Emitter) {
		this.emitters.delete(fn)
	}

	getFor(userId: number, isAdmin: boolean): Activity[] {
		const all = [...this.activities.values()]
		return isAdmin ? all : all.filter((a) => a.userId === userId)
	}

	getById(id: string): Activity | undefined {
		return this.activities.get(id)
	}

	private broadcast(changed: Activity) {
		for (const [fn, { userId, isAdmin }] of this.emitters) {
			if (isAdmin || changed.userId === userId) {
				try {
					fn("activity:update", {
						activities: this.getFor(userId, isAdmin)
					})
				} catch {}
			}
		}
	}

	start(params: {
		userId: number
		lorebookId: number
		lorebookLabel: string
		mode: "replace" | "extend"
	}): string {
		// The cross-kind refusal that stood here (a running scene_backfill
		// rewriting the same scene cast a build reads) is gone with the
		// backfill itself: cast is FK rows now, so there is no half-migrated
		// scene set for a build to read.
		//
		// Safety net: a fresh build for this lorebook always fully supersedes
		// any prior graph_build activity left parked for it (stale review the
		// user never applied/discarded, or — rarer — one still mid-flight,
		// e.g. a second tab). remove() aborts the old activity's controller
		// before deleting it, so an in-flight build is actually cancelled
		// here, not silently orphaned while it keeps running.
		for (const [existingId, activity] of this.activities) {
			if (
				activity.kind === "graph_build" &&
				activity.lorebookId === params.lorebookId &&
				activity.userId === params.userId
			) {
				this.remove(existingId)
			}
		}

		const id = uuidv4()
		const activity: GraphBuildActivity = {
			kind: "graph_build",
			...params,
			id,
			status: "building",
			phase: "loading",
			sceneIndex: 0,
			totalScenes: 0,
			nodesFound: 0,
			relsFound: 0,
			startedAt: new Date().toISOString()
		}
		this.activities.set(id, activity)
		this.broadcast(activity)
		return id
	}

	startScene(
		params: {
			userId: number
			sceneId: number
			sceneName?: string
			lorebookId: number
			lorebookLabel?: string
			historyEntryId?: number
			ephemeralOnCancel?: boolean
		},
		abortController?: AbortController
	): string {
		// Remove any existing activity for this scene + user before starting a new one
		for (const [existingId, activity] of this.activities) {
			if (
				activity.kind === "scene_summarize" &&
				activity.sceneId === params.sceneId &&
				activity.userId === params.userId
			) {
				this.abortControllers.get(existingId)?.abort()
				this.abortControllers.delete(existingId)
				this.activities.delete(existingId)
			}
		}
		const id = uuidv4()
		const activity: SceneSummarizeActivity = {
			kind: "scene_summarize",
			...params,
			id,
			status: "running",
			startedAt: new Date().toISOString()
		}
		this.activities.set(id, activity)
		if (abortController) this.abortControllers.set(id, abortController)
		this.broadcast(activity)
		return id
	}

	update(
		id: string,
		patch: Partial<Omit<GraphBuildActivity, "id" | "userId" | "kind">>
	) {
		const existing = this.activities.get(id)
		if (!existing) return
		const updated = { ...existing, ...patch } as GraphBuildActivity
		this.activities.set(id, updated)
		this.broadcast(updated)
	}

	updateScene(
		id: string,
		patch: Partial<Omit<SceneSummarizeActivity, "id" | "userId" | "kind">>
	) {
		const existing = this.activities.get(id)
		if (!existing) return
		const updated = { ...existing, ...patch } as SceneSummarizeActivity
		this.activities.set(id, updated)
		if (updated.status !== "running") {
			// Generation has finished (successfully or with an error) —
			// nothing left to ever abort. Without this, a controller
			// registered by startScene() would otherwise sit in the map for
			// the rest of the process lifetime if the activity itself
			// lingers un-dismissed in "review"/"error".
			this.abortControllers.delete(id)
		}
		this.broadcast(updated)
	}

	startCompile(
		params: {
			userId: number
			historyEntryId: number
			historyEntryDate: string
			lorebookId: number
			lorebookLabel: string
		},
		abortController?: AbortController
	): string {
		for (const [existingId, activity] of this.activities) {
			if (
				activity.kind === "compile_history_entry" &&
				activity.historyEntryId === params.historyEntryId &&
				activity.userId === params.userId
			) {
				if (activity.status === "running") {
					// Rejected outright rather than silently superseded, even
					// though a running compile now has a real abortController
					// (unlike when this comment was first written) that
					// remove() could correctly abort-then-delete. Starting a
					// new compile is a rarer, more deliberate action than
					// starting a new scene-summarize (which the UI can
					// re-trigger repeatedly for the same scene) — silently
					// killing an in-flight compile someone may have started
					// from another tab is worse than a clear "already in
					// progress" error.
					throw new Error(
						"A compile is already in progress for this entry."
					)
				}
				// review/error activities have already finished running —
				// no in-flight work to orphan, safe to supersede.
				this.remove(existingId)
			}
		}
		const id = uuidv4()
		const activity: CompileHistoryEntryActivity = {
			kind: "compile_history_entry",
			...params,
			id,
			status: "running",
			startedAt: new Date().toISOString()
		}
		this.activities.set(id, activity)
		if (abortController) this.abortControllers.set(id, abortController)
		this.broadcast(activity)
		return id
	}

	updateCompile(
		id: string,
		patch: Partial<
			Omit<CompileHistoryEntryActivity, "id" | "userId" | "kind">
		>
	) {
		const existing = this.activities.get(id)
		if (!existing) return
		const updated = { ...existing, ...patch } as CompileHistoryEntryActivity
		this.activities.set(id, updated)
		if (updated.status !== "running") {
			// See the identical note in updateScene() above.
			this.abortControllers.delete(id)
		}
		this.broadcast(updated)
	}

	startChatSummarize(
		params: {
			userId: number
			chatId: number
			chatLabel?: string
			loreType: "world" | "character"
			lorebookId: number
			topic?: string
		},
		abortController?: AbortController
	): string {
		for (const [existingId, activity] of this.activities) {
			if (
				activity.kind !== "chat_summarize" ||
				activity.chatId !== params.chatId ||
				activity.loreType !== params.loreType ||
				activity.userId !== params.userId
			) {
				continue
			}
			// Deliberately NOT startScene's abort-and-evict, for two different
			// reasons depending on state.
			//
			// running — a prior audit (see summarize.concurrentLock.int.test.ts)
			// found concurrent chats:summarize calls for one chat each running a
			// full batch+synthesis pipeline, and fixed it by rejecting outright.
			// Superseding would technically avoid multiplying cost, since
			// remove() aborts the controller — but a second request here is
			// almost always an accident (double-click, second tab), and silently
			// killing the run another tab is watching is worse than a clear
			// error. Scenes can supersede freely because re-running one is a
			// deliberate, visible action against an existing row.
			//
			// review — nothing is persisted until the user saves, so
			// `pendingResult` is the only copy of text they have not committed.
			// Superseding would destroy it outright.
			if (activity.status === "running") {
				throw new Error(
					"A summarization is already running for this chat."
				)
			}
			if (activity.status === "review") {
				throw new Error(
					"A finished summary for this chat is still waiting to be saved or discarded."
				)
			}
			// error: already finished, nothing in flight, nothing unsaved.
			this.remove(existingId)
		}
		const id = uuidv4()
		const activity: ChatSummarizeActivity = {
			kind: "chat_summarize",
			...params,
			id,
			status: "running",
			startedAt: new Date().toISOString()
		}
		this.activities.set(id, activity)
		if (abortController) this.abortControllers.set(id, abortController)
		this.broadcast(activity)
		return id
	}

	updateChatSummarize(
		id: string,
		patch: Partial<Omit<ChatSummarizeActivity, "id" | "userId" | "kind">>
	) {
		const existing = this.activities.get(id)
		if (!existing) return
		const updated = { ...existing, ...patch } as ChatSummarizeActivity
		this.activities.set(id, updated)
		if (updated.status !== "running") {
			// See the identical note in updateScene() above.
			this.abortControllers.delete(id)
		}
		this.broadcast(updated)
	}

	setAbortController(id: string, controller: AbortController) {
		this.abortControllers.set(id, controller)
	}

	cancel(id: string) {
		const existing = this.activities.get(id)
		if (!existing) return
		this.abortControllers.get(id)?.abort()
		this.abortControllers.delete(id)
		this.remove(id)
	}

	/**
	 * Set once at wiring time so this store never has to import the DB. Invoked
	 * for scene activities flagged `ephemeralOnCancel` when they go away —
	 * cancel, discard, or dismiss. The callee is responsible for confirming the
	 * scene is actually disposable before deleting anything.
	 */
	private ephemeralSceneCleanup?: (
		sceneId: number,
		userId: number
	) => void | Promise<void>

	setEphemeralSceneCleanup(
		fn: (sceneId: number, userId: number) => void | Promise<void>
	) {
		this.ephemeralSceneCleanup = fn
	}

	remove(id: string) {
		const existing = this.activities.get(id)
		if (!existing) return
		this.abortControllers.get(id)?.abort()
		this.abortControllers.delete(id)
		this.activities.delete(id)
		// cancel() delegates here, so this one call site covers cancel-mid-run,
		// discard-at-review, the modal's save-time dismiss and the Layout
		// context's dismiss.
		if (
			existing.kind === "scene_summarize" &&
			existing.ephemeralOnCancel &&
			this.ephemeralSceneCleanup
		) {
			void Promise.resolve(
				this.ephemeralSceneCleanup(existing.sceneId, existing.userId)
			).catch(() => {})
		}
		for (const [fn, { userId, isAdmin }] of this.emitters) {
			if (isAdmin || existing.userId === userId) {
				try {
					fn("activity:update", {
						activities: this.getFor(userId, isAdmin)
					})
				} catch {}
			}
		}
	}
}

export const activityStore = new ActivityStore()
