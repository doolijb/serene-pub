/**
 * The user's graph builds, as the shell holds them (`graphBuildsCtx`).
 *
 * ⚠ EVERY build, one per book — never a single slot. A single "newest build"
 * slot lets another book's build take an open review away: its edits are
 * thrown away, it falls back to the start screen, and Proceed there replaces
 * the parked review (plan B8). Each surface asks for its own book's build
 * (`buildFor`); the activity sidebar draws a card for every one (`builds`);
 * the newest is still named (`activeBuild`).
 *
 * Forgetting and dismissing are two acts. `clearBuild` dismisses a book's
 * build on the server and forgets it here; `forgetBuild` only forgets, and
 * only the build it names — for one the server already took away, as an
 * apply consumes the build it applies. After an apply the shell may already
 * hold another book's build as the newest, so "clear whatever is newest"
 * dismissed that one instead: a parked review thrown away, a running build
 * cancelled (plan A21 review).
 */

/** An activity as `activity:update` lists it, for the kinds this store reads. */
type ActivityRecord = Record<string, any>

export interface GraphBuildsDeps {
	/** Dismiss an activity on the server (`activity:dismiss`). */
	dismiss: (activityId: string) => void
}

const newestFirst = (a: GraphBuildState, b: GraphBuildState) =>
	new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()

class GraphBuildsController implements GraphBuildsCtx {
	/** Every graph build of this user, newest first; at most one per book. */
	builds = $state<GraphBuildState[]>([])
	reopenLorebookId = $state<number | null>(null)
	/** The newest build. */
	readonly activeBuild = $derived<GraphBuildState | null>(
		this.builds[0] ?? null
	)

	#deps: GraphBuildsDeps

	constructor(deps: GraphBuildsDeps) {
		this.#deps = deps
	}

	buildFor(lorebookId: number): GraphBuildState | null {
		return this.builds.find((b) => b.lorebookId === lorebookId) ?? null
	}

	startBuild(params: {
		lorebookId: number
		mode: "replace" | "extend"
		lorebookLabel?: string
	}): void {
		// Shown at once, before the server has the build — its activity
		// replaces this on the next `activity:update`. A fresh build supersedes
		// the book's earlier one on the server too.
		this.builds = [
			{
				lorebookId: params.lorebookId,
				lorebookLabel: params.lorebookLabel,
				mode: params.mode,
				status: "building",
				phase: "loading",
				sceneIndex: 0,
				totalScenes: 0,
				nodesFound: 0,
				relsFound: 0,
				startedAt: new Date().toISOString()
			},
			...this.builds.filter((b) => b.lorebookId !== params.lorebookId)
		]
	}

	clearBuild(lorebookId?: number): void {
		const build =
			lorebookId == null ? this.builds[0] : this.buildFor(lorebookId)
		if (build?.activityId) this.#deps.dismiss(build.activityId)
		if (build) this.builds = this.builds.filter((b) => b !== build)
		this.reopenLorebookId = null
	}

	forgetBuild(activityId: string): void {
		this.builds = this.builds.filter((b) => b.activityId !== activityId)
	}

	receive(activities: ActivityRecord[]): void {
		const traces = new Map(
			this.builds
				.filter((b) => b.activityId && b.trace)
				.map((b) => [b.activityId!, b.trace])
		)
		this.builds = activities
			.filter((a) => a.kind === "graph_build")
			.map(
				(a): GraphBuildState => ({
					activityId: a.id,
					userId: a.userId,
					lorebookId: a.lorebookId,
					lorebookLabel: a.lorebookLabel,
					mode: a.mode,
					status: a.status,
					phase: a.phase,
					sceneIndex: a.sceneIndex,
					totalScenes: a.totalScenes,
					nodesFound: a.nodesFound,
					relsFound: a.relsFound,
					currentPair: a.currentPair,
					currentSceneLabel: a.currentSceneLabel,
					proposal: a.proposal,
					sceneLabels: a.sceneLabels,
					seedTempIdMap: a.seedTempIdMap,
					seedNodeNames: a.seedNodeNames,
					relationshipDiagnostics: a.relationshipDiagnostics,
					filteredWorldLoreNames: a.filteredWorldLoreNames,
					errorMessage: a.errorMessage,
					errorRaw: a.errorRaw,
					startedAt: a.startedAt,
					trace: traces.get(a.id)
				})
			)
			.sort(newestFirst)
	}

	appendTrace(entry: Sockets.NarrativeGraph.BuildLogEntry): void {
		// The build of the book the log names — never whichever is newest.
		const { lorebookId, ...call } = entry
		const build = this.buildFor(lorebookId)
		if (build) build.trace = [...(build.trace ?? []), call]
	}
}

/** The shell's graph builds, for `setContext("graphBuildsCtx", …)`. */
export function createGraphBuildsCtx(
	deps: GraphBuildsDeps
): GraphBuildsCtx & {
	receive: (activities: ActivityRecord[]) => void
	appendTrace: (entry: Sockets.NarrativeGraph.BuildLogEntry) => void
} {
	return new GraphBuildsController(deps)
}
