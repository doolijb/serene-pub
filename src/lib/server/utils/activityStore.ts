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

export type Activity =
	| GraphBuildActivity
	| SceneSummarizeActivity
	| CompileHistoryEntryActivity

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

	startScene(params: {
		userId: number
		sceneId: number
		sceneName?: string
		lorebookId: number
		lorebookLabel?: string
		historyEntryId?: number
	}): string {
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
		this.broadcast(updated)
	}

	startCompile(params: {
		userId: number
		historyEntryId: number
		historyEntryDate: string
		lorebookId: number
		lorebookLabel: string
	}): string {
		for (const [existingId, activity] of this.activities) {
			if (
				activity.kind === "compile_history_entry" &&
				activity.historyEntryId === params.historyEntryId &&
				activity.userId === params.userId
			) {
				if (activity.status === "running") {
					// Unlike graph_build/scene_summarize, nothing wires an
					// AbortController for compile_history_entry (scenes.ts's
					// scenes:compile handler never calls
					// setAbortController()) — remove()'s abort() would be a
					// no-op here, so silently deleting a RUNNING compile
					// would just orphan its in-flight LLM call: it keeps
					// running to completion invisibly, and its eventual
					// updateCompile() call becomes a silent no-op against a
					// since-deleted id. Reject instead of superseding so the
					// caller gets an honest error rather than a zombie
					// generation finishing unseen.
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

	remove(id: string) {
		const existing = this.activities.get(id)
		if (!existing) return
		this.abortControllers.get(id)?.abort()
		this.abortControllers.delete(id)
		this.activities.delete(id)
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
