<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import {
		declareInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { getContext, onDestroy, untrack } from "svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import AiTaskModal, { type AiTaskStep } from "./AiTaskModal.svelte"
	import LoreWritesOffNotice from "$lib/client/lorebooks/LoreWritesOffNotice.svelte"
	import { useLoreWritesOff } from "$lib/client/lorebooks/loreWritesOff.svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import {
		RELATIONSHIP_STATUSES,
		RELATIONSHIP_VISIBILITIES
	} from "$lib/shared/lorebooks/linkVocabulary"
	import {
		applyProposalParams,
		keptRelationships,
		nextApplyRequestId,
		removedWith,
		type EditableNode,
		type EditableNodeUpdate,
		type EditableRel
	} from "./graphProposalApply"

	interface Props {
		open: boolean
		onOpenChange: (e: { open: boolean }) => void
		lorebookId: number
		mode?: "replace" | "extend"
		/**
		 * Extend only: read just this session's scenes on its line (#51).
		 * Null or absent reads the whole line.
		 */
		sessionId?: number | null
		/**
		 * Extend without a session: the line the Graph lens is reading, whose
		 * own scenes and history entries the build reads and whose ties it
		 * writes. Null or absent is main. A Rebuild is always main's.
		 */
		branchId?: number | null
		readySceneCount?: number
		skippedSceneCount?: number
		ungraphedHistoryEntryCount?: number
		existingUnboundNodeCount?: number
		/**
		 * Links between two cast members — what a rebuild deletes, and all it
		 * deletes (places plan L1), so the warning names the count.
		 */
		existingCastToCastCount?: number
		/** Scenes needing character extraction — cost disclosure, not a gate. */
		unresolvedCastSceneCount?: number
		onApplied?: () => void
	}

	let {
		open,
		onOpenChange,
		lorebookId,
		mode = "replace",
		sessionId = null,
		branchId = null,
		readySceneCount,
		skippedSceneCount,
		ungraphedHistoryEntryCount,
		existingUnboundNodeCount = 0,
		existingCastToCastCount = 0,
		unresolvedCastSceneCount = 0,
		onApplied
	}: Props = $props()

	let hasExistingContent = $derived(
		mode === "replace" &&
			(existingUnboundNodeCount > 0 || existingCastToCastCount > 0)
	)
	let totalReadyCount = $derived(
		(readySceneCount ?? 0) + (ungraphedHistoryEntryCount ?? 0)
	)

	const socket = useTypedSocket()
	const graphBuildsCtx: GraphBuildsCtx = getContext("graphBuildsCtx")

	// Internal step — "applying" removed; handled via isApplying flag
	type Step = "preflight" | "building" | "review" | "error"
	let step = $state<Step>("preflight")

	let aiStep = $derived<AiTaskStep>(
		step === "preflight"
			? "confirm"
			: step === "building"
				? "running"
				: step === "error"
					? "error"
					: "review"
	)

	let errorMessage = $state("")
	let errorRaw = $state<string | undefined>(undefined)
	let showRaw = $state(false)

	let proposalNodes = $state<EditableNode[]>([])
	let proposalRels = $state<EditableRel[]>([])
	let proposalNodeUpdates = $state<EditableNodeUpdate[]>([])
	let sceneLabels = $state<string[]>([])
	let seedTempIdMap = $state<Record<string, number>>({})
	let seedNodeNames = $state<Record<string, string>>({})
	let isApplying = $state(false)

	let expandedNodeIdx = $state<number | null>(null)
	let expandedRelIdx = $state<number | null>(null)
	let showTrace = $state(false)
	let expandedTraceIdx = $state<number | null>(null)

	let activeNodes = $derived(proposalNodes.filter((n) => !n._deleted))
	/** Not removed, and not removed with a character (they go together). */
	let activeRels = $derived(
		keptRelationships({
			nodes: proposalNodes,
			relationships: proposalRels,
			updatedNodes: proposalNodeUpdates
		})
	)
	/** A kept new character with no name — Apply waits until it has one. */
	let unnamedNode = $derived(activeNodes.some((n) => !n.name.trim()))
	let activeNodeUpdates = $derived(
		proposalNodeUpdates.filter((u) => !u._deleted)
	)

	/**
	 * This book's build — never the shell's newest, which may be another
	 * book's: a build starting there took this review away (plan B8).
	 */
	let build = $derived(graphBuildsCtx?.buildFor(lorebookId) ?? null)
	/**
	 * The scenes whose cast the build read — Apply saves who was in each, so
	 * later builds skip reading them again. A build can have nothing else: an
	 * Extend over scenes with one character each.
	 */
	let sceneCastCount = $derived(
		build?.proposal?.resolvedSceneCast?.length ?? 0
	)

	/**
	 * Human-readable attribution for relationships the build did NOT keep.
	 *
	 * Deliberately not gated on the result being empty. "4 relationships, 6
	 * discarded" and "4 relationships, 0 discarded" are very different states
	 * and looked identical while this only rendered at zero — which is exactly
	 * how a parser that was throwing away every extracted edge stayed invisible
	 * for a release. A thin result deserves the same attribution an empty one
	 * gets.
	 *
	 * Stays silent in the one case with nothing to report: relationships were
	 * produced, none were discarded, and no scene was skipped.
	 */
	let relationshipDropSummary = $derived.by(() => {
		const d = build?.relationshipDiagnostics
		if (!d) return []
		const lines: string[] = []
		const discarded =
			d.noJson +
			d.badJson +
			d.notArray +
			d.missingType +
			d.missingTarget +
			d.wrongSource +
			d.unresolvedTargets.length

		if (
			proposalRels.length > 0 &&
			discarded === 0 &&
			d.scenesSkippedNoPair === 0 &&
			d.retried === 0
		) {
			return []
		}

		if (discarded > 0) {
			lines.push(
				`${discarded} extracted relationship${discarded === 1 ? "" : "s"} could not be used:`
			)
		} else if (d.perspectiveCalls === 0) {
			lines.push("No character perspectives were requested.")
		} else if (proposalRels.length === 0) {
			lines.push(
				`${d.perspectiveCalls} character perspective${d.perspectiveCalls === 1 ? "" : "s"} requested; the model returned no relationships.`
			)
		}

		if (d.unresolvedTargets.length > 0) {
			lines.push(
				`Named a character not in the scene: ${d.unresolvedTargets.join(", ")}`
			)
		}
		if (d.noJson > 0)
			lines.push(`${d.noJson} response(s) contained no JSON.`)
		if (d.badJson > 0)
			lines.push(`${d.badJson} response(s) contained unparseable JSON.`)
		if (d.notArray > 0)
			lines.push(
				`${d.notArray} response(s) omitted the relationships list.`
			)
		if (d.missingType > 0)
			lines.push(`${d.missingType} entr(ies) had no relationship type.`)
		if (d.missingTarget > 0)
			lines.push(`${d.missingTarget} entr(ies) named no target.`)
		if (d.wrongSource > 0)
			lines.push(
				`${d.wrongSource} entr(ies) pointed the wrong way round, or described two other characters rather than this one.`
			)
		if (d.retried > 0)
			lines.push(
				`${d.retried} response(s) returned no JSON and were retried; ${d.retriedRecovered} then succeeded.`
			)
		if (d.scenesSkippedNoPair > 0) {
			lines.push(
				`${d.scenesSkippedNoPair} scene(s) had only one character, so no relationship was possible.`
			)
		}
		return lines
	})

	/**
	 * "This build broke" as distinct from "this story had nothing to add".
	 *
	 * Deliberately phase-shaped rather than "did every call error": a real
	 * incident had two early calls succeed and every later one fail, so an
	 * all-calls-errored test would have stayed silent and the run would still
	 * have presented 0 · 0 · 0 as a reviewable result. What matters is that a
	 * whole phase came back unusable.
	 *
	 * A legitimately empty build does not trip this — there the model answers
	 * `{"relationships": []}`, which parses fine and leaves noJson/badJson at
	 * zero. This fires only when the responses themselves were unusable.
	 */
	let systemicFailure = $derived.by(() => {
		const d = build?.relationshipDiagnostics
		if (!d) return null
		const calls = d.perspectiveCalls ?? 0
		if (calls === 0) return null
		const unusable = (d.noJson ?? 0) + (d.badJson ?? 0)
		if (activeRels.length === 0 && unusable >= calls) {
			return `All ${calls} character-perspective call${calls === 1 ? "" : "s"} came back unusable, so this is a failed build rather than an empty one. Applying it would delete the links between cast members and put nothing back. Check the connection, then the KoboldCPP log — repeated "Reloading new model/config" lines mean the model is being reloaded between calls.`
		}
		return null
	})

	/**
	 * Apply is offered when there is something to save — a character, a
	 * change, a relationship, or only who was in each scene — and every new
	 * character has a name. A failed build is not saved on its casts alone:
	 * its relationships came back unusable, and applying it would stamp its
	 * scenes as read.
	 */
	// Lorebook writes from sessions Off (plan A22): a graph build turns what
	// sessions played into the book, so it says so before any work and
	// neither builds nor applies.
	const loreWrites = useLoreWritesOff()
	let canApply = $derived(
		!loreWrites.off &&
		!unnamedNode &&
			(activeNodes.length > 0 ||
				activeNodeUpdates.length > 0 ||
				activeRels.length > 0 ||
				(sceneCastCount > 0 && !systemicFailure))
	)

	let progressPhase = $derived(build?.phase ?? "loading")
	let progressSceneIndex = $derived(build?.sceneIndex ?? 0)
	let progressTotalScenes = $derived(build?.totalScenes ?? 0)
	let progressNodesFound = $derived(build?.nodesFound ?? 0)
	let progressRelsFound = $derived(build?.relsFound ?? 0)
	let progressCurrentPair = $derived(build?.currentPair)
	let progressCurrentSceneLabel = $derived(build?.currentSceneLabel)

	let progressPercent = $derived.by(() => {
		if (progressPhase === "loading" || progressTotalScenes === 0) return 5
		if (progressPhase === "parsing") return 90
		return Math.max(
			10,
			Math.round((progressSceneIndex / progressTotalScenes) * 80) + 5
		)
	})

	let progressLabel = $derived(
		progressPhase === "loading"
			? "Loading…"
			: progressPhase
					.replace(/_/g, " ")
					.replace(/^\w/, (c) => c.toUpperCase()) + "…"
	)

	/**
	 * What the shown build is: its own mode once there is one. A parked
	 * Rebuild reopened from a session's Extend button is still a Rebuild —
	 * and the server applies it as one, whatever this modal was opened as.
	 */
	let shownMode = $derived(build?.mode ?? mode)
	let modalTitle = $derived(
		shownMode === "extend" ? "Extend narrative graph" : "Build narrative graph"
	)
	let runningTitle = $derived(
		shownMode === "extend"
			? "Extending narrative graph…"
			: "Building narrative graph…"
	)
	let startLabel = $derived(hasExistingContent ? "Replace graph" : "Proceed")

	/**
	 * Which build the modal shows, and in which state — the one thing the
	 * restore below follows.
	 *
	 * ⚠ Never the `activeBuild` object itself. Layout hands a NEW object over
	 * on every `activity:update` — any summarize tick, any reconnect — so an
	 * effect that read it re-copied the proposal on each one and silently
	 * threw away the person's removals and edits mid-review (plan B8).
	 */
	let buildKey = $derived(
		build ? `${build.activityId ?? ""}:${build.status}` : null
	)
	/** The key last restored from; `undefined` until the first restore. */
	let restoredKey: string | null | undefined = undefined

	/** Show `b` — copy its proposal into the review — or a fresh preflight. */
	function restore(b: GraphBuildState | null) {
		if (b?.status === "building") {
			step = "building"
		} else if (b?.status === "review") {
			step = "review"
			proposalNodes = (b.proposal?.nodes ?? []).map((n) => ({ ...n }))
			proposalRels = (b.proposal?.relationships ?? []).map((r) => ({
				...r
			}))
			proposalNodeUpdates = (b.proposal?.updatedNodes ?? []).map((u) => ({
				...u
			}))
			sceneLabels = b.sceneLabels ?? []
			seedTempIdMap = b.seedTempIdMap ?? {}
			seedNodeNames = b.seedNodeNames ?? {}
			expandedNodeIdx = null
			expandedRelIdx = null
		} else if (b?.status === "error") {
			step = "error"
			errorMessage = b.errorMessage ?? "Unknown error"
			errorRaw = b.errorRaw
		} else {
			step = "preflight"
			errorMessage = ""
			errorRaw = undefined
			showRaw = false
			proposalNodes = []
			proposalRels = []
			proposalNodeUpdates = []
			sceneLabels = []
			seedTempIdMap = {}
			seedNodeNames = {}
			isApplying = false
			expandedNodeIdx = null
			expandedRelIdx = null
		}
	}

	// Restore when the modal opens and whenever the shown build or its state
	// changes — and only then, so a review keeps what the person did across
	// streamed updates and a close and reopen.
	$effect(() => {
		if (!open) return
		const key = buildKey
		untrack(() => {
			if (key === restoredKey) return
			// An apply in flight consumes its build: the activity goes before
			// the reply comes. Wait for the reply rather than flash back to a
			// preflight with the review emptied.
			if (isApplying && key === null) return
			restoredKey = key
			restore(build)
		})
	})

	function triggerBuild() {
		step = "building"
		graphBuildsCtx?.startBuild({ lorebookId, mode })
		socket.emit("narrativeGraph:build", {
			lorebookId,
			mode,
			...(mode === "extend" && sessionId != null ? { sessionId } : {}),
			...(mode === "extend" && sessionId == null && branchId != null
				? { branchId }
				: {})
		} satisfies Sockets.NarrativeGraph.Build.Params)
	}

	// `step = "building"` above is optimistic — it flips before the server has
	// accepted anything, and startBuild() fabricates a client-side activeBuild
	// to match. If the build is refused before its activity exists (the
	// pre-activity window in narrativeGraphBuildHandler), no activity:update
	// will ever arrive to move us off "building", so without this listener the
	// modal spins forever. Failures *after* the activity exists arrive as a
	// status: "error" update and are handled by the $effect above instead.
	function handleBuildError(msg: Sockets.NarrativeGraph.Build.ErrorResponse) {
		// A refusal names its book: one for another lorebook must not
		// un-stick this modal.
		if (msg.lorebookId !== undefined && msg.lorebookId !== lorebookId)
			return
		if (step !== "building") return
		graphBuildsCtx?.clearBuild(lorebookId)
		step = "preflight"
		errorMessage = ""
		errorRaw = undefined
		showRaw = false
		// No toast here on purpose: "narrativeGraph:build:error" is absent from
		// Layout's HANDLED_ERROR_EVENTS, so its catch-all already surfaces the
		// server's real message. Toasting again would double it.
	}

	/**
	 * BARE, and standing for the modal's life: `narrativeGraph:build:error` has
	 * no entry in `SCOPED_EVENTS`, so a `#<id>` key would match no payload at
	 * all, and `handleBuildError`'s own `msg.lorebookId !== lorebookId` check
	 * stays what keeps another book's failure from un-sticking this modal.
	 */
	useInterest<"narrativeGraph:build:error">(
		"narrativeGraph:build:error",
		handleBuildError
	)

	// Shared by the error step's "Start Over" and the review step's
	// "Rebuild" — both mean the same thing: discard whatever build is
	// parked (error or stale/unapplied review) and return to a clean
	// preflight so the user can actually kick a new one.
	function startOver() {
		graphBuildsCtx?.clearBuild(lorebookId)
		step = "preflight"
		errorMessage = ""
		errorRaw = undefined
		showRaw = false
	}

	/**
	 * The apply reply's **interest**, held only while an apply is in flight —
	 * declared in `apply()`, dropped on the first answer of either kind and
	 * again when the modal is destroyed (a release is idempotent, so the
	 * second call is a no-op).
	 *
	 * Both keys BARE: neither is in `SCOPED_EVENTS`, so a `#<id>` key would
	 * match no payload at all, and each handler's own
	 * `msg.lorebookId !== lorebookId` check stays the filter.
	 */
	let applyProposalReleases: Array<() => void> = []
	function cleanupApplyProposal() {
		for (const release of applyProposalReleases) release()
		applyProposalReleases = []
	}
	/**
	 * The apply in flight: its `requestId`, and what it sends, counted when it
	 * was sent — the reply may land after the build (and so the review) is
	 * gone. Only the answer naming this id settles it: an apply's reply
	 * reaches every tab of the user, so another tab's apply of the same book
	 * must not close this modal as a success. Its refusal reaches only the tab
	 * that applied, where an earlier apply's refusal still must not un-stick it.
	 */
	let pendingApply: {
		requestId: string
		/** The build it applies — the one to forget once it has. */
		activityId: string
		counts: string
	} | null = null

	function handleApplied(msg: Sockets.NarrativeGraph.ApplyProposal.Response) {
		if (!pendingApply || msg.requestId !== pendingApply.requestId) return
		const { counts, activityId } = pendingApply
		pendingApply = null
		cleanupApplyProposal()
		toaster.success({
			title: "Graph applied",
			description: [`Saved ${counts}.`, ...(msg.applyNotes ?? [])].join(
				" "
			)
		})
		// The server consumed the build with the apply, and may already have
		// said so — the shell's newest build can be another book's by now.
		// Forget this one alone; dismissing "the current build" threw that
		// other one away (a parked review lost, a running build cancelled).
		graphBuildsCtx?.forgetBuild(activityId)
		isApplying = false
		onApplied?.()
		onOpenChange({ open: false })
	}
	// Without this the Apply button spins forever on any rejection —
	// isApplying was only ever cleared on success. Stay on the review step
	// so the proposal isn't lost; Layout's catch-all toasts the message.
	function handleApplyError(
		msg: Sockets.NarrativeGraph.ApplyProposal.ErrorResponse
	) {
		if (!pendingApply) return
		// A refusal of another apply (an earlier one of this tab's) is not
		// this one's. A refusal naming no request can only
		// un-stick, and only for this book.
		if (
			msg.requestId !== undefined
				? msg.requestId !== pendingApply.requestId
				: msg.lorebookId !== undefined && msg.lorebookId !== lorebookId
		)
			return
		pendingApply = null
		cleanupApplyProposal()
		isApplying = false
		// The build may have gone while this apply was in flight (another tab
		// applied it — the refusal says so): catch the modal up with it now,
		// which the restore held off while the apply was waiting.
		if (buildKey !== restoredKey) {
			restoredKey = buildKey
			restore(build)
		}
	}

	/** "1 scene" / "3 scenes". */
	const counted = (n: number, one: string, many: string) =>
		`${n} ${n === 1 ? one : many}`

	function apply() {
		if (!build?.activityId || !canApply) return
		isApplying = true
		const requestId = nextApplyRequestId()
		pendingApply = {
			requestId,
			activityId: build.activityId,
			counts: `${counted(activeNodes.length, "new character", "new characters")}, ${counted(activeNodeUpdates.length, "change", "changes")} to the cast, ${counted(activeRels.length, "relationship", "relationships")} and who was in ${counted(sceneCastCount, "scene", "scenes")}`
		}

		// Declared BEFORE the emit, not after it as the raw listeners were:
		// the registry flushes its interest sync on the way out of every typed
		// `emit`, so the key this reply needs is on the server before the
		// request that produces it arrives. Any stale pair is dropped first —
		// the handlers are one stable reference, so declaring twice would
		// leave a subscriber a single release could not clear.
		cleanupApplyProposal()
		applyProposalReleases = [
			declareInterest<"narrativeGraph:applyProposal">(
				"narrativeGraph:applyProposal",
				handleApplied
			),
			declareInterest<"narrativeGraph:applyProposal:error">(
				"narrativeGraph:applyProposal:error",
				handleApplyError
			)
		]

		socket.emit(
			"narrativeGraph:applyProposal",
			applyProposalParams({
				lorebookId,
				build,
				review: {
					nodes: proposalNodes,
					relationships: proposalRels,
					updatedNodes: proposalNodeUpdates
				},
				requestId
			})
		)
	}

	onDestroy(() => {
		// `narrativeGraph:build:error` is not here: the interest registry
		// releases this modal's subscriber as its effect is destroyed.
		cleanupApplyProposal()
	})

	function nodeLabel(tempId: string): string {
		return (
			proposalNodes.find((n) => n.tempId === tempId)?.name ??
			seedNodeNames[tempId] ??
			tempId
		)
	}

	function sceneLabel(index: number | undefined): string {
		if (index == null) return ""
		return sceneLabels[index] ?? `Scene ${index + 1}`
	}

	const NODE_STATES = ["active", "deceased", "missing", "departed"] as const

	const REL_STATUS_COLOR: Record<string, string> = {
		active: "text-success-500",
		resolved: "text-surface-600-400",
		broken: "text-error-500",
		evolved: "text-warning-500"
	}

	// Cancel: during building = stop + go to preflight; otherwise = close
	let handleCancel = $derived(
		step === "building"
			? () => {
					if (build?.activityId)
						socket.emit("activity:cancel", { id: build.activityId })
					graphBuildsCtx?.clearBuild(lorebookId)
					step = "preflight"
					errorMessage = ""
					errorRaw = undefined
				}
			: () => onOpenChange({ open: false })
	)
</script>

{#snippet confirmBlock()}
	{#if loreWrites.off}
		<LoreWritesOffNotice />
	{/if}
	<p class="text-surface-700-300 mt-1 text-sm">
		{mode === "extend"
			? sessionId != null
				? "The LLM will process this session's new scenes on its line and add to your existing graph."
				: branchId != null
					? "The LLM will process this branch's new scenes and history entries and add them to the branch's graph."
					: "The LLM will process new scenes and add to your existing graph."
			: "The LLM will read main's summarised scenes and derive the links between cast members from them."}
	</p>
	<div class="mt-4 space-y-2">
		{#if totalReadyCount > 0}
			<div
				class="border-success-500/30 bg-success-500/10 flex items-center gap-3 rounded-lg border p-3 text-sm"
			>
				<Icons.CheckCircle
					size={16}
					class="text-success-500 shrink-0"
				/>
				<span>
					{#if (readySceneCount ?? 0) > 0}
						<strong>{readySceneCount}</strong>
						scene{(readySceneCount ?? 0) === 1 ? "" : "s"}
					{/if}
					{#if (readySceneCount ?? 0) > 0 && (ungraphedHistoryEntryCount ?? 0) > 0}
						{" + "}
					{/if}
					{#if (ungraphedHistoryEntryCount ?? 0) > 0}
						<strong>{ungraphedHistoryEntryCount}</strong>
						history {(ungraphedHistoryEntryCount ?? 0) === 1
							? "entry"
							: "entries"}
					{/if}
					{" "}ready to process
				</span>
			</div>
		{:else}
			<!--
				The inverse of the readiness count above, and nothing else.

				This was previously the {:else} of the cast-extraction
				disclosure below, so its effective condition was
				`unresolvedCastSceneCount === 0` — which says nothing about
				readiness. The healthy steady state (content ready, every cast
				already resolved) therefore rendered "N ready to process" and
				"No content is ready" simultaneously, while Start stayed
				correctly enabled off `totalReadyCount`.
			-->
			<div
				class="border-warning-500/30 bg-warning-500/10 flex items-center gap-3 rounded-lg border p-3 text-sm"
			>
				<Icons.AlertTriangle
					size={16}
					class="text-warning-500 shrink-0"
				/>
				<span>
					No content is ready to process. Generate scene summaries or
					add history entry content first.
				</span>
			</div>
		{/if}
		{#if unresolvedCastSceneCount > 0}
			<!--
				Disclosure, not a warning: these scenes have no recorded cast,
				so the build derives it from their summaries. That costs about
				one LLM call each, once — afterwards the cast is saved and
				rebuilds take the fast path. "up to" is deliberate: scenes
				holding legacy name strings resolve without any call.
			-->
			<div
				class="border-primary-500/30 bg-primary-500/10 flex items-center gap-3 rounded-lg border p-3 text-sm"
			>
				<Icons.Sparkles size={16} class="text-primary-500 shrink-0" />
				<span>
					<strong>{unresolvedCastSceneCount}</strong>
					scene{unresolvedCastSceneCount === 1 ? "" : "s"} need character
					extraction (up to {unresolvedCastSceneCount} extra LLM call{unresolvedCastSceneCount ===
					1
						? ""
						: "s"}). This is saved afterwards, so later rebuilds
					skip it.
				</span>
			</div>
		{/if}
		{#if (skippedSceneCount ?? 0) > 0}
			<div
				class="border-surface-300-700 bg-surface-200-800 flex items-center gap-3 rounded-lg border p-3 text-sm"
			>
				<Icons.SkipForward
					size={16}
					class="text-surface-600-400 shrink-0"
				/>
				<span class="text-surface-700-300">
					<strong>{skippedSceneCount}</strong>
					scene{(skippedSceneCount ?? 0) === 1 ? "" : "s"} will be skipped
					— no summary yet
				</span>
			</div>
		{/if}
		{#if hasExistingContent}
			<div
				class="border-warning-500/40 bg-warning-500/10 flex items-start gap-3 rounded-lg border p-3 text-sm"
			>
				<Icons.AlertTriangle
					size={16}
					class="text-warning-500 mt-0.5 shrink-0"
				/>
				<!--
					States only what a rebuild actually does. It used to warn
					that "N unbound nodes and M relationships will be
					permanently deleted", but narrativeGraph.ts is explicit
					that a rebuild "NEVER deletes a lorebookBindings row, full
					stop" — only relationships are cleared. Overstating the
					damage is its own bug: it talks users out of a safe action,
					and a warning known to exaggerate stops being read at all.
				-->
				<!--
					Owner ruling 2026-09-29 (Q1, places plan L1): a rebuild is
					for the ties between cast members only. It deletes those,
					every line's, and re-derives them from scenes; places and
					every link with an entry at either end are out of its
					reach. So this counts only what it deletes, and nothing
					records which ties were drawn by hand.
				-->
				<span>
					{#if existingCastToCastCount > 0}
						This will delete the
						<strong>{existingCastToCastCount}</strong>
						link{existingCastToCastCount === 1 ? "" : "s"} between cast
						members in this book, on main and on every branch, and
						re-create them on main from your scenes, so any drawn by
						hand or on a branch do not come back.
					{:else}
						This will re-create the links between cast members from
						your scenes.
					{/if}
					{" "}Places, and links with a place or other entry at either
					end, are kept.
					{#if existingUnboundNodeCount > 0}
						{" "}So are your characters — including the{" "}
						<strong>{existingUnboundNodeCount}</strong>
						unbound node{existingUnboundNodeCount === 1 ? "" : "s"}.
					{:else}
						{" "}So are your characters.
					{/if}
				</span>
			</div>
		{/if}
	</div>
{/snippet}

{#snippet previewBlock()}
	{#if progressTotalScenes > 0}
		<div class="text-surface-700-300 flex justify-between text-xs">
			<span>
				{progressCurrentSceneLabel ?? `Scene ${progressSceneIndex + 1}`}
				({progressSceneIndex + 1} / {progressTotalScenes})
			</span>
			<span>
				{progressNodesFound} nodes · {progressRelsFound} relationships
			</span>
		</div>
	{/if}
	{#if progressCurrentPair}
		<div class="mt-3 space-y-1">
			<p
				class="text-surface-600-400 text-xs font-semibold"
			>
				Extracting perspective
			</p>
			<div class="bg-surface-200-800 rounded-lg p-3 text-sm">
				<p class="text-surface-700-300 font-mono text-xs">
					{progressCurrentPair}
				</p>
			</div>
		</div>
	{:else}
		<div class="text-surface-700-300 py-6 text-center text-sm">
			<div
				class="bg-primary-500 mx-auto mb-2 h-2 w-2 animate-pulse rounded-full"
			></div>
			Waiting for LLM…
		</div>
	{/if}
{/snippet}

{#snippet reviewBlock()}
	{#if loreWrites.off}
		<!-- A review reopened after the setting moved: it cannot apply. -->
		<div class="mb-4"><LoreWritesOffNotice /></div>
	{/if}
	<p class="text-surface-700-300 -mt-1 mb-4 text-sm">
		{activeNodes.length} new · {activeNodeUpdates.length} updated · {activeRels.length}
		relationships{#if sceneCastCount > 0}
			· who was in {sceneCastCount}
			{sceneCastCount === 1 ? "scene" : "scenes"}{/if}
	</p>
	<!--
		What Apply will do is the build's, not this modal's: a parked Rebuild
		reopened from a session's Extend button is applied as a Rebuild, so the
		review says so.
	-->
	<p class="text-surface-700-300 -mt-2 mb-4 text-sm">
		{shownMode === "replace"
			? "This is a rebuild: applying it deletes the links between cast members in this book, on main and on every branch, and puts these in their place."
			: "Applying adds these to your graph."}
	</p>

	<!--
		A failed build and an uneventful one both arrive here as small numbers.
		Only this banner distinguishes them, and it matters most in replace mode,
		where applying an empty proposal destroys the graph it replaces.
	-->
	{#if systemicFailure}
		<div
			class="preset-tonal-error border-error-500 mb-4 rounded-lg border p-3 text-sm"
			role="alert"
		>
			<p class="font-semibold">This build did not run correctly.</p>
			<p class="mt-1">{systemicFailure}</p>
		</div>
	{/if}

	<!-- Node updates to existing characters -->
	{#if proposalNodeUpdates.length > 0}
		<section class="mb-4 space-y-2">
			<h3
				class="text-surface-600-400 text-xs font-semibold"
			>
				Updates to existing characters
			</h3>
			{#each proposalNodeUpdates as update, i}
				<div
					class="bg-surface-200-800 rounded-lg border transition-opacity {update._deleted
						? 'opacity-40'
						: 'border-surface-300-700'}"
				>
					<div class="flex items-center gap-2 px-3 py-2">
						<span class="flex-1 truncate text-sm font-medium">
							{update.name}
						</span>
						{#if update.nodeState}
							<span
								class="badge preset-tonal-warning shrink-0 text-xs"
							>
								{update.previousNodeState} → {update.nodeState}
							</span>
						{/if}
						{#if update.summary !== undefined}
							<span
								class="badge preset-tonal-primary shrink-0 text-xs"
							>
								summary
							</span>
						{/if}
						<button
							type="button"
							class="btn btn-icon btn-icon-sm preset-tonal-surface shrink-0"
							aria-label={update._deleted
								? `Restore update for ${update.name}`
								: `Discard update for ${update.name}`}
							onclick={() =>
								(proposalNodeUpdates[i]._deleted =
									!update._deleted)}
						>
							{#if update._deleted}
								<Icons.Undo2 size={14} />
							{:else}
								<Icons.Trash2 size={14} />
							{/if}
						</button>
					</div>
					{#if update.summary !== undefined || update.nodeStateReason}
						<div
							class="border-surface-300-700 space-y-1 border-t px-3 py-2"
						>
							{#if update.summary !== undefined}
								<p class="text-sm">{update.summary}</p>
							{/if}
							{#if update.nodeStateReason}
								<p class="text-surface-700-300 text-xs italic">
									Reason: {update.nodeStateReason}
								</p>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</section>
	{/if}

	<!-- Nodes -->
	<section class="mb-4 space-y-2">
		<h3
			class="text-surface-600-400 text-xs font-semibold"
		>
			Nodes
		</h3>
		{#if proposalNodes.length === 0}
			<p class="text-surface-700-300 text-sm italic">
				No new nodes extracted.
			</p>
		{/if}
		{#if unnamedNode}
			<p class="text-error-700-300 text-xs" role="status">
				A new character needs a name before the graph can be applied.
				Name it, or remove it.
			</p>
		{/if}
		<!--
			Screened-out names are reported, never dropped in silence. The
			filter treats a name matching a world lore, place or item entry as
			a subject of the setting rather than a member of the cast — right
			for a station or an artefact, wrong for a character who happens to
			have a lore page. Naming them is what makes that second case
			recoverable.
		-->
		{#if (build?.filteredWorldLoreNames?.length ?? 0) > 0}
			<p class="text-surface-700-300 text-xs">
				Not created — these match a world lore, place or item entry, so
				they were read as places or things rather than characters:
				<span class="font-semibold">
					{build?.filteredWorldLoreNames?.join(", ")}
				</span>
				. Add one as a character manually if that was wrong.
			</p>
		{/if}
		{#each proposalNodes as node, i}
			<div
				class="bg-surface-200-800 rounded-lg border transition-opacity {node._deleted
					? 'opacity-40'
					: 'border-surface-300-700'}"
			>
				<div
					class="flex cursor-pointer items-center gap-2 px-3 py-2"
					role="button"
					tabindex="0"
					onclick={() =>
						(expandedNodeIdx = expandedNodeIdx === i ? null : i)}
					onkeydown={(e) =>
						e.key === "Enter" &&
						(expandedNodeIdx = expandedNodeIdx === i ? null : i)}
				>
					<Icons.User size={14} class="text-primary-500 shrink-0" />
					<span class="flex-1 truncate text-sm font-medium">
						{node.name}
					</span>
					<span class="text-surface-600-400 text-xs">
						{node.nodeState}
					</span>
					{#if node.sceneIndex != null}
						<span class="text-surface-600-400 text-xs">
							{sceneLabel(node.sceneIndex)}
						</span>
					{/if}
					<button
						aria-label={node._deleted ? "Restore node" : "Remove node"}
						class="text-surface-600-400 hover:text-error-500 ml-1 shrink-0"
						onclick={(e) => {
							e.stopPropagation()
							proposalNodes[i]._deleted =
								!proposalNodes[i]._deleted
						}}
						title={node._deleted ? "Restore" : "Remove"}
					>
						{#if node._deleted}
							<Icons.RotateCcw size={14} />
						{:else}
							<Icons.Trash2 size={14} />
						{/if}
					</button>
					<Icons.ChevronDown
						size={14}
						class="text-surface-600-400 transition-transform {expandedNodeIdx ===
						i
							? 'rotate-180'
							: ''}"
					/>
				</div>
				{#if expandedNodeIdx === i && !node._deleted}
					<div
						class="border-surface-300-700 space-y-2 border-t px-3 py-2"
					>
						<div class="space-y-1">
							<p
								class="text-surface-600-400 text-xs font-semibold"
							>
								Name
							</p>
							<input
								aria-label="Name"
								class="input text-sm"
								type="text"
								bind:value={proposalNodes[i].name}
							/>
						</div>
						<div class="space-y-1">
							<p
								class="text-surface-600-400 text-xs font-semibold"
							>
								State
							</p>
							<Select
								label="State"
								labelHidden
								class="text-sm"
								options={NODE_STATES.map((s) => ({ value: s, label: s }))}
								bind:value={proposalNodes[i].nodeState}
							/>
						</div>
						<div class="space-y-1">
							<p
								class="text-surface-600-400 text-xs font-semibold"
							>
								Summary
							</p>
							<textarea
								aria-label="Summary"
								class="textarea min-h-12 text-sm"
								maxlength="200"
								bind:value={proposalNodes[i].summary}
							></textarea>
							<p class="text-surface-600-400 text-right text-xs">
								{(proposalNodes[i].summary ?? "").length} / 200
							</p>
						</div>
					</div>
				{/if}
			</div>
		{/each}
	</section>

	<!-- Relationships -->
	<section class="mb-4 space-y-2">
		<h3
			class="text-surface-600-400 text-xs font-semibold"
		>
			Relationships
		</h3>
		{#if proposalRels.length === 0}
			<p class="text-surface-700-300 text-sm italic">
				No relationships extracted.
			</p>
		{/if}
		<!--
			Sibling of the list, not nested inside the empty case: a build that
			kept four relationships and dropped six needs this just as much as
			one that kept none. See relationshipDropSummary, which stays silent
			when there is genuinely nothing to report.
		-->
		{#if relationshipDropSummary.length > 0}
			<ul
				class="text-surface-700-300 list-inside list-disc space-y-0.5 text-xs"
			>
				{#each relationshipDropSummary as line}
					<li>{line}</li>
				{/each}
			</ul>
		{/if}
		{#each proposalRels as rel, i}
			{@const goneWith = removedWith(rel, proposalNodes)}
			<div
				class="bg-surface-200-800 rounded-lg border transition-opacity {rel._deleted ||
				goneWith
					? 'opacity-40'
					: 'border-surface-300-700'}"
			>
				<div
					class="flex cursor-pointer items-center gap-2 px-3 py-2"
					role="button"
					tabindex="0"
					onclick={() =>
						(expandedRelIdx = expandedRelIdx === i ? null : i)}
					onkeydown={(e) =>
						e.key === "Enter" &&
						(expandedRelIdx = expandedRelIdx === i ? null : i)}
				>
					<span class="truncate text-sm">
						<span class="font-medium">
							{nodeLabel(rel.fromTempId)}
						</span>
						<span class="text-surface-600-400 mx-1">→</span>
						<span class="text-primary-500 text-xs">
							{rel.relationshipType.replace(/_/g, " ")}
						</span>
						<span class="text-surface-600-400 mx-1">→</span>
						<span class="font-medium">
							{nodeLabel(rel.toTempId)}
						</span>
					</span>
					{#if rel.visibility === "secret"}
						<span
							class="text-warning-500 shrink-0 text-xs"
							title="Secret"
						>
							🔒
						</span>
					{:else if rel.visibility === "public"}
						<span
							class="text-primary-400 shrink-0 text-xs"
							title="Public"
						>
							📢
						</span>
					{/if}
					<span
						class="ml-auto shrink-0 text-xs {REL_STATUS_COLOR[
							rel.status
						] ?? ''}"
					>
						{rel.status}
					</span>
					{#if rel.sceneIndex != null}
						<span class="text-surface-600-400 text-xs">
							{sceneLabel(rel.sceneIndex)}
						</span>
					{/if}
					{#if goneWith}
						<!--
							Removed with the character it names: a relationship
							to someone who will not exist cannot be applied.
							Restoring the character brings it back.
						-->
						<span class="text-surface-600-400 shrink-0 text-xs">
							Removed with {goneWith.name}
						</span>
					{:else}
						<button
							aria-label={rel._deleted ? "Restore relationship" : "Remove relationship"}
							class="text-surface-600-400 hover:text-error-500 ml-1 shrink-0"
							onclick={(e) => {
								e.stopPropagation()
								proposalRels[i]._deleted = !proposalRels[i]._deleted
							}}
							title={rel._deleted ? "Restore" : "Remove"}
						>
							{#if rel._deleted}
								<Icons.RotateCcw size={14} />
							{:else}
								<Icons.Trash2 size={14} />
							{/if}
						</button>
					{/if}
					<Icons.ChevronDown
						size={14}
						class="text-surface-600-400 transition-transform {expandedRelIdx ===
						i
							? 'rotate-180'
							: ''}"
					/>
				</div>
				{#if expandedRelIdx === i && !rel._deleted && !goneWith}
					<div
						class="border-surface-300-700 space-y-2 border-t px-3 py-2"
					>
						<div class="grid grid-cols-3 gap-2">
							<div class="space-y-1">
								<p
									class="text-surface-600-400 text-xs font-semibold"
								>
									Type
								</p>
								<input
									aria-label="Relationship type"
									class="input text-sm"
									type="text"
									bind:value={
										proposalRels[i].relationshipType
									}
								/>
							</div>
							<div class="space-y-1">
								<p
									class="text-surface-600-400 text-xs font-semibold"
								>
									Status
								</p>
								<Select
									label="Status"
									labelHidden
									class="text-sm"
									options={RELATIONSHIP_STATUSES.map((s) => ({ value: s, label: s }))}
									bind:value={proposalRels[i].status}
								/>
							</div>
							<div class="space-y-1">
								<p
									class="text-surface-600-400 text-xs font-semibold"
								>
									Visibility
								</p>
								<Select
									label="Visibility"
									labelHidden
									class="text-sm"
									options={RELATIONSHIP_VISIBILITIES.map((v) => ({ value: v, label: v }))}
									bind:value={proposalRels[i].visibility}
								/>
							</div>
						</div>
						<div class="space-y-1">
							<p
								class="text-surface-600-400 text-xs font-semibold"
							>
								Description
							</p>
							<textarea
								aria-label="Description"
								class="textarea min-h-12 text-sm"
								bind:value={proposalRels[i].description}
							></textarea>
						</div>
						<div class="space-y-1">
							<p
								class="text-surface-600-400 text-xs font-semibold"
							>
								Reason for change
							</p>
							<input
								aria-label="Reason for change"
								class="input text-sm"
								type="text"
								placeholder="Optional"
								bind:value={proposalRels[i].reason}
							/>
						</div>
					</div>
				{/if}
			</div>
		{/each}
	</section>
{/snippet}

{#snippet reviewExtraBlock()}
	<button
		class="btn preset-filled-surface-400-600"
		onclick={() => onOpenChange({ open: false })}
	>
		Close
	</button>
	<button class="btn preset-tonal-warning" onclick={startOver}>
		<Icons.RefreshCw size={16} /> Rebuild
	</button>
{/snippet}

{#snippet errorExtraBlock()}
	{#if errorRaw}
		<button
			class="text-surface-700-300 hover:text-surface-700-300 flex items-center gap-1 text-xs"
			onclick={() => (showRaw = !showRaw)}
		>
			<Icons.ChevronDown
				size={14}
				class="transition-transform {showRaw ? 'rotate-180' : ''}"
			/>
			{showRaw ? "Hide" : "Show"} raw LLM output
		</button>
		{#if showRaw}
			<pre
				class="bg-surface-200-800 mt-2 max-h-40 overflow-y-auto rounded p-3 text-xs whitespace-pre-wrap">{errorRaw}</pre>
		{/if}
	{/if}
{/snippet}

{#snippet debugBlock()}
	{#if (build?.trace?.length ?? 0) > 0}
		<button
			class="text-surface-700-300 hover:text-surface-700-300 flex w-full items-center justify-between text-xs"
			onclick={() => (showTrace = !showTrace)}
		>
			<span>Debug ({build?.trace?.length ?? 0} calls)</span>
			<Icons.ChevronDown
				size={14}
				class="transition-transform {showTrace ? 'rotate-180' : ''}"
			/>
		</button>
		{#if showTrace}
			<div class="mt-3 max-h-[60vh] space-y-2 overflow-y-auto pr-1">
				{#each build?.trace ?? [] as entry, i}
					<div
						class="bg-surface-100-900 border-surface-300-700 overflow-hidden rounded-lg border text-xs"
					>
						<button
							class="hover:bg-surface-200-800 flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors"
							onclick={() =>
								(expandedTraceIdx =
									expandedTraceIdx === i ? null : i)}
						>
							<Icons.ChevronRight
								size={12}
								class="text-surface-600-400 shrink-0 transition-transform {expandedTraceIdx ===
								i
									? 'rotate-90'
									: ''}"
							/>
							<span
								class="text-primary-400 shrink-0 font-mono font-medium"
							>
								{i + 1}.
							</span>
							<span class="truncate font-medium">
								{entry.label}
							</span>
						</button>
						{#if expandedTraceIdx === i}
							<div
								class="divide-surface-300-700 border-surface-300-700 divide-y border-t"
							>
								<div class="space-y-1 p-3">
									<p
										class="text-surface-600-400 text-xs font-medium"
									>
										System
									</p>
									<pre
										class="bg-surface-200-800 max-h-56 overflow-y-auto rounded p-2.5 leading-relaxed whitespace-pre-wrap">{entry.system}</pre>
								</div>
								<div class="space-y-1 p-3">
									<p
										class="text-surface-600-400 text-xs font-medium"
									>
										User
									</p>
									<pre
										class="bg-surface-200-800 max-h-56 overflow-y-auto rounded p-2.5 leading-relaxed whitespace-pre-wrap">{entry.user}</pre>
								</div>
								<div class="space-y-1 p-3">
									<p
										class="text-surface-600-400 text-xs font-medium"
									>
										Response
									</p>
									<pre
										class="bg-surface-200-800 max-h-56 overflow-y-auto rounded p-2.5 leading-relaxed whitespace-pre-wrap">{entry.response}</pre>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	{/if}
{/snippet}

<AiTaskModal
	{open}
	{onOpenChange}
	title={modalTitle}
	{runningTitle}
	reviewTitle="Review graph proposal"
	step={aiStep}
	{progressPercent}
	{progressLabel}
	canStart={!loreWrites.off && totalReadyCount > 0}
	{startLabel}
	canSave={canApply}
	saveLabel="Apply graph"
	isSaving={isApplying}
	{errorMessage}
	retryLabel="Retry step"
	onStart={triggerBuild}
	onSave={apply}
	onCancel={handleCancel}
	onMinimize={() => onOpenChange({ open: false })}
	onRetry={() => {
		step = "building"
		errorMessage = ""
		errorRaw = undefined
		showRaw = false
		// The failed build's own mode: a Rebuild that failed and was reopened
		// from a session's Extend button resumes as the Rebuild it was.
		socket.emit("narrativeGraph:build", {
			lorebookId,
			mode: shownMode,
			resume: true,
			...(shownMode === "extend" && sessionId != null ? { sessionId } : {}),
			...(shownMode === "extend" && sessionId == null && branchId != null
				? { branchId }
				: {})
		} satisfies Sockets.NarrativeGraph.Build.Params)
	}}
	onStartOver={startOver}
	onDiscard={() => {
		graphBuildsCtx?.clearBuild(lorebookId)
		onOpenChange({ open: false })
	}}
	confirm={confirmBlock}
	preview={previewBlock}
	review={reviewBlock}
	reviewExtra={reviewExtraBlock}
	errorExtra={errorExtraBlock}
	debug={debugBlock}
	size="lg"
/>
