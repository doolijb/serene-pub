<script lang="ts">
	import SpProgress from "$lib/client/components/hostElements/SpProgress.svelte"
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import { getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import EmptyState from "$lib/client/components/EmptyState.svelte"
	import ListGroupLabel from "$lib/client/components/panels/ListGroupLabel.svelte"
	import PanelTabStrip, {
		type PanelTab
	} from "$lib/client/components/panels/PanelTabStrip.svelte"
	import { notifications } from "$lib/client/notifications/notifications.svelte"
	import {
		notificationKind,
		type NotificationLevel,
		type NotificationRow
	} from "$lib/shared/notifications/kinds"
	import { statusText } from "$lib/client/i18n/state.svelte"
	import { openHref } from "$lib/client/shell/openHref"
	import { isPlainClick } from "$lib/client/shell/viewLinks"
	import { timeAgo } from "$lib/client/utils/timeAgo"
	import { momentKey } from "$lib/shared/lorebooks/loreRoute"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}

	let { onclose = $bindable() }: Props = $props()
	const uid = $props.id()

	const socket = useTypedSocket()

	let graphBuildsCtx: GraphBuildsCtx = $state(getContext("graphBuildsCtx"))
	let sceneSummarizesCtx: SceneSummarizesCtx = $state(
		getContext("sceneSummarizesCtx")
	)
	let compileEntriesCtx: CompileEntriesCtx = $state(
		getContext("compileEntriesCtx")
	)
	let sessionSummarizesCtx: SessionSummarizesCtx = $state(
		getContext("sessionSummarizesCtx")
	)
	let taskQueueCtx: TaskQueueCtx = $state(getContext("taskQueueCtx"))
	let panelsCtx: PanelsCtx = $state(getContext("panelsCtx"))
	let userCtx: UserCtx = $state(getContext("userCtx"))

	/**
	 * Every graph build, one card each (plan B8) — the newest alone hid a
	 * second book's parked review or running build until the first was
	 * dismissed.
	 */
	let builds = $derived(graphBuildsCtx?.builds ?? [])
	let sceneActivities = $derived(sceneSummarizesCtx?.activities ?? [])
	let compileActivities = $derived(compileEntriesCtx?.activities ?? [])
	let sessionSummarizeActivities = $derived(
		sessionSummarizesCtx?.activities ?? []
	)
	let hasActivity = $derived(
		builds.length > 0 ||
			sceneActivities.length > 0 ||
			compileActivities.length > 0 ||
			sessionSummarizeActivities.length > 0
	)
	let activityCount = $derived(
		builds.length +
			sceneActivities.length +
			compileActivities.length +
			sessionSummarizeActivities.length
	)
	let queueCount = $derived(taskQueueCtx?.tasks?.length ?? 0)

	/**
	 * Waiting on you: open notifications, unread first, then read. The store
	 * already orders newest raise first and `sort` is stable, so each half
	 * keeps that order.
	 */
	let waiting = $derived(
		[...notifications.open].sort(
			(a, b) => Number(!!a.readAt) - Number(!!b.readAt)
		)
	)
	let earlier = $derived(notifications.cleared)
	/** The Activity tab's count, in its copy (STYLE-GUIDE §10: no badges). */
	let tabCount = $derived(waiting.length + activityCount)
	let nothingHere = $derived(
		waiting.length === 0 && earlier.length === 0 && !hasActivity
	)

	/**
	 * The level as words — the dot is never the only carrier (§6.11). The same
	 * words the admin Overview's rows use, so one dot reads one way; never
	 * "Needs you", which is the admin attention list's name (R1).
	 */
	const LEVEL_WORD: Record<NotificationLevel, string> = {
		error: "Problem",
		attention: "To do",
		info: "For your information"
	}
	const LEVEL_DOT: Record<NotificationLevel, string> = {
		error: "bg-error-500",
		attention: "bg-primary-500",
		info: "bg-surface-500"
	}

	function rowText(row: NotificationRow) {
		const kind = notificationKind(row.kind)
		const vars = row.vars ?? {}
		return {
			title: kind ? statusText({ i18n: kind.title, vars }) : row.kind,
			detail: kind?.detail ? statusText({ i18n: kind.detail, vars }) : "",
			cta: kind ? statusText({ i18n: kind.cta, vars }) : "Open"
		}
	}

	/**
	 * The CTA is a real link, so a modified click still opens a new tab and
	 * an `/admin` or `/docs` href is already taken over by the shell's own
	 * view-link handler (Layout.svelte). A plain click on anything else —
	 * a session page, a lore address — goes through `openHref`.
	 */
	function followCta(event: MouseEvent, row: NotificationRow) {
		notifications.read([row.id])
		if (!isPlainClick(event)) return
		event.preventDefault()
		void openHref(panelsCtx, row.href)
	}

	let isAdmin = $derived(!!userCtx?.user?.isAdmin)
	const isOwnBuild = (build: GraphBuildState) =>
		build.userId === userCtx?.user?.id
	const canStopBuild = (build: GraphBuildState) =>
		build.status === "building" && (isOwnBuild(build) || isAdmin)
	let activeTab = $state<string>("activity")
	/**
	 * Only admins have a second tab, so only admins get a strip: a one-tab
	 * strip is a heading dressed as a control. Everyone else sees the
	 * Activity content directly. The counts are in the tabs' copy, never a
	 * badge (STYLE-GUIDE §10), and only when there is something to count.
	 */
	let showTabs = $derived(isAdmin)
	let shownTab = $derived(showTabs ? activeTab : "activity")
	const tabIdPrefix = `${uid}-pane`
	let tabStrip: PanelTab[] = $derived([
		{
			value: "activity",
			label: "Activity",
			icon: Icons.Bell,
			count: tabCount > 0 ? tabCount : undefined
		},
		{
			value: "queue",
			label: "LLM queue",
			icon: Icons.Cpu,
			count: queueCount > 0 ? queueCount : undefined
		}
	])

	/**
	 * ⚠ `document.visibilityState` is a plain DOM property — reading it in an
	 * effect samples it once and never hears about it changing. Mirrored into
	 * state so the poll below actually stops when the browser tab goes away.
	 */
	let pageVisible = $state(true)
	$effect(() => {
		const onVisibilityChange = () => {
			pageVisible = document.visibilityState === "visible"
		}
		onVisibilityChange()
		document.addEventListener("visibilitychange", onVisibilityChange)
		return () =>
			document.removeEventListener("visibilitychange", onVisibilityChange)
	})

	/** "3 minutes ago" goes stale; tick while someone is looking. */
	let now = $state(Date.now())
	$effect(() => {
		if (panelsCtx.activeView !== "activity" || !pageVisible) return
		now = Date.now()
		const interval = setInterval(() => (now = Date.now()), 30_000)
		return () => clearInterval(interval)
	})

	/**
	 * Four conditions, all of them live, because this shell keeps every view
	 * a person has opened MOUNTED behind the `hidden` attribute. Gated on the
	 * tab alone, one visit to the Queue tab left a 1 Hz socket round-trip
	 * running for the rest of the session — invisible, unstoppable, and paid
	 * for again by every other Activity tab anyone ever opened.
	 *
	 * `activeView` is the one that fixes that: it is false for a view that is
	 * open but hidden. Page visibility is the same argument one level up —
	 * a backgrounded browser tab has nobody watching the numbers tick.
	 *
	 * All four are read reactively, so the poll restarts on its own the
	 * moment the view is shown again or the tab comes back to the front.
	 */
	let pollTaskQueue = $derived(
		isAdmin &&
			shownTab === "queue" &&
			panelsCtx.activeView === "activity" &&
			pageVisible
	)

	$effect(() => {
		if (!pollTaskQueue) return
		socket.emit("taskQueue:get", {})
		const interval = setInterval(
			() => socket.emit("taskQueue:get", {}),
			1000
		)
		return () => clearInterval(interval)
	})
	let expandedTaskId = $state<string | null>(null)

	function toggleTask(id: string) {
		expandedTaskId = expandedTaskId === id ? null : id
	}

	function elapsedLabel(startedAt: string): string {
		const s = Math.floor(
			(Date.now() - new Date(startedAt).getTime()) / 1000
		)
		if (s < 60) return `${s}s`
		const m = Math.floor(s / 60)
		if (m < 60) return `${m}m ${s % 60}s`
		return `${Math.floor(m / 60)}h ${m % 60}m`
	}

	function navigateToGraphTab(build: GraphBuildState) {
		if (!isOwnBuild(build)) return
		panelsCtx.digest.lore = {
			lorebookId: build.lorebookId,
			scope: "all",
			lens: "graph"
		}
		panelsCtx.openPanel({ key: "lorebooks", toggle: false })
	}

	function openModal(build: GraphBuildState) {
		if (!isOwnBuild(build)) return
		panelsCtx.digest.lore = {
			lorebookId: build.lorebookId,
			scope: "all",
			lens: "graph"
		}
		panelsCtx.openPanel({ key: "lorebooks", toggle: false })
		graphBuildsCtx.reopenLorebookId = build.lorebookId
	}

	function navigateToScene(activity: SceneSummarizeState) {
		// A scene is addressed under the history entry it was compiled into,
		// so a scene with no entry yet is the History list and nothing more.
		panelsCtx.digest.lore = activity.historyEntryId
			? {
					lorebookId: activity.lorebookId,
					scope: "scenes",
					entryId: activity.historyEntryId,
					sceneId: activity.sceneId
				}
			: { lorebookId: activity.lorebookId, scope: "history" }
		panelsCtx.openPanel({ key: "lorebooks", toggle: false })
	}

	/**
	 * Unlike the graph/scene/compile cards, which open a panel via
	 * panelsCtx.digest, a session summarize belongs to a route — so reopening means
	 * navigating to the session first and letting that page pick the run back up
	 * from `reviewActivityId`.
	 */
	function navigateToSessionSummarize(activity: SessionSummarizeState) {
		sessionSummarizesCtx.setReviewActivityId(activity.activityId)
		goto(`/sessions/${activity.sessionId}`)
	}

	function navigateToCompileEntry(activity: CompileEntryState) {
		// At the reading the compile was asked from: its review saves there,
		// so it is read against the entry as that line and moment show it.
		panelsCtx.digest.lore = {
			lorebookId: activity.lorebookId,
			scope: "history",
			entryId: activity.historyEntryId,
			...(activity.branchId != null ? { branch: activity.branchId } : {}),
			...(activity.moment ? { moment: momentKey(activity.moment) } : {})
		}
		panelsCtx.openPanel({ key: "lorebooks", toggle: false })
	}

	const BUILD_STATUS_COLOR: Record<string, string> = {
		building: "text-primary-ink",
		review: "text-success-500",
		error: "text-error-600-400"
	}
	const BUILD_STATUS_LABEL: Record<string, string> = {
		building: "In progress",
		review: "Ready to review",
		error: "Failed"
	}
</script>

{#snippet notificationRow(row: NotificationRow, past: boolean)}
	{@const text = rowText(row)}
	{@const unread = !past && !row.readAt}
	<li class="flex items-start gap-3 px-4 py-3">
		<span
			class="mt-1.5 size-2 shrink-0 rounded-full {past
				? 'bg-surface-500'
				: LEVEL_DOT[row.level]}"
			aria-hidden="true"
		></span>
		<div class="min-w-0 flex-1 space-y-1">
			<p
				class="text-sm {unread
					? 'text-surface-950-50 font-semibold'
					: past
						? 'text-surface-600-400'
						: 'text-surface-800-200'}"
			>
				<span class="sr-only">{LEVEL_WORD[row.level]}:</span>
				{text.title}
			</p>
			{#if text.detail}
				<p class="text-surface-600-400 line-clamp-2 text-xs">
					{text.detail}
				</p>
			{/if}
			<p class="text-surface-600-400 text-xs">
				{#if unread}<span class="text-surface-800-200 font-semibold">
						New
					</span>
					·
				{/if}
				<time
					datetime={(past ? row.clearedAt : null) ?? row.lastRaisedAt}
				>
					{timeAgo(
						(past ? row.clearedAt : null) ?? row.lastRaisedAt,
						now
					)}
				</time>
			</p>
			<a
				href={row.href}
				class="btn btn-sm preset-tonal mt-1"
				onclick={(e) => followCta(e, row)}
			>
				{text.cta}
			</a>
		</div>
		{#if !past}
			<button
				type="button"
				class="text-surface-600-400 hover:text-surface-950-50 inline-flex size-8 shrink-0 items-center justify-center rounded-md transition-colors pointer-coarse:size-11"
				onclick={() => notifications.dismiss([row.id])}
				title="Dismiss"
				aria-label="Dismiss"
			>
				<Icons.X size={14} />
			</button>
		{/if}
	</li>
{/snippet}

<!-- The view's root (STYLE-GUIDE §5.2). No tracker: Activity has no left
     column — it is a list, centred at a list's width. The tab strip takes
     the same width as the rows under it (PLAN-0-5-polish-parity L7,
     2026-10-24): in Focus it ran 2000px over one card. -->
<div class="flex h-full min-h-0 flex-col">
	{#if showTabs}
		<PanelTabStrip
			tabs={tabStrip}
			bind:value={activeTab}
			ariaLabel="Activity"
			panelIdPrefix={tabIdPrefix}
			class="mx-auto w-full max-w-[560px]"
		/>
	{/if}

	<!-- Content. The list's measure, centred (notes 14; 560px, a list
	     column's ceiling, since L7): in Focus the rows ran 1400px from a name
	     on the left to its time on the right. -->
	<div class="min-h-0 flex-1 overflow-y-auto">
		<div
			id="{tabIdPrefix}-activity"
			role={showTabs ? "tabpanel" : undefined}
			aria-labelledby={showTabs
				? `${tabIdPrefix}-activity-tab`
				: undefined}
			hidden={shownTab !== "activity"}
			class="mx-auto w-full max-w-[560px]"
		>
			{#if shownTab === "activity"}
				{#if waiting.length > 0}
					<section aria-labelledby="{uid}-waiting">
						<ListGroupLabel
							id="{uid}-waiting"
							label="Waiting on you"
							class="px-4"
						/>
						<ul>
							{#each waiting as row (row.id)}
								{@render notificationRow(row, false)}
							{/each}
						</ul>
					</section>
				{/if}
				{#if hasActivity}
					<section aria-labelledby="{uid}-progress">
						<ListGroupLabel
							id="{uid}-progress"
							label="In progress"
							class="px-4"
						/>
						{#each builds as build (build.lorebookId)}
							{@const isOwnActivity = isOwnBuild(build)}
							<div class="panel-card mx-4 mt-4 space-y-3">
								<!-- Card header: title + dismiss -->
								<div
									class="flex items-start justify-between gap-2"
								>
									<div class="min-w-0 flex-1">
										{#if isOwnActivity}
											<button
												class="hover:text-primary-ink block w-full truncate text-left text-sm font-medium transition-colors"
												onclick={() =>
													navigateToGraphTab(build)}
												title="Go to graph tab"
											>
												{build.lorebookLabel ??
													`Lorebook #${build.lorebookId}`}
											</button>
										{:else}
											<p
												class="truncate text-sm font-medium"
											>
												{build.lorebookLabel ??
													`Lorebook #${build.lorebookId}`}
											</p>
										{/if}
										<p class="text-surface-700-300 text-xs">
											{build.mode === "extend"
												? "Extend"
												: "Build"} graph ·
											<span
												class={BUILD_STATUS_COLOR[
													build.status
												]}
											>
												{BUILD_STATUS_LABEL[
													build.status
												]}
											</span>
										</p>
									</div>
									{#if build.status !== "building"}
										<button
											class="text-surface-600-400 hover:text-surface-950-50 shrink-0 transition-colors"
											onclick={() =>
												graphBuildsCtx?.clearBuild(
													build.lorebookId
												)}
											title="Dismiss"
											aria-label="Dismiss"
										>
											<Icons.X size={14} />
										</button>
									{/if}
								</div>

								{#if build.status === "building"}
									<div class="space-y-1">
										<p
											class="text-surface-700-300 text-xs capitalize"
										>
											{build.phase.replace(/_/g, " ")}
											{#if build.totalScenes > 0}· scene {build.sceneIndex +
													1}/{build.totalScenes}{/if}
										</p>
										<div class="text-primary-500">
											<SpProgress
												attrs={{
													value: String(build.totalScenes > 0 ? Math.max( 10, Math.round( (build.sceneIndex / build.totalScenes) * 80 ) + 5 ) : 5),
													label: "Graph build progress"
												}}
											/>
										</div>
										{#if build.currentPair}
											<p
												class="text-surface-600-400 truncate font-mono text-xs"
											>
												{build.currentPair}
											</p>
										{/if}
									</div>
								{/if}

								<!-- Card footer: stop + action buttons -->
								<div class="flex items-center gap-2">
									{#if canStopBuild(build)}
										<button
											class="btn btn-sm preset-tonal-error"
											onclick={() =>
												build.activityId &&
												socket.emit("activity:cancel", {
													id: build.activityId
												})}
										>
											<Icons.Square size={14} /> Stop
										</button>
									{/if}
									{#if isOwnActivity}
										{#if build.status === "building"}
											<button
												class="btn btn-sm preset-tonal-surface"
												onclick={() => openModal(build)}
											>
												<Icons.Eye size={14} /> View progress
											</button>
										{:else if build.status === "review"}
											<button
												class="btn btn-sm preset-filled-primary-500"
												onclick={() => openModal(build)}
											>
												<Icons.Check size={14} /> Review
												and apply
											</button>
										{:else if build.status === "error"}
											<button
												class="btn btn-sm preset-tonal-error"
												onclick={() => openModal(build)}
											>
												<Icons.AlertCircle size={14} /> View
												error
											</button>
										{/if}
									{/if}
								</div>
							</div>
						{/each}
						{#each sceneActivities as activity (activity.activityId)}
							{@const isOwn =
								activity.userId === userCtx?.user?.id}
							<div class="panel-card mx-4 mt-4 space-y-3">
								<div
									class="flex items-start justify-between gap-2"
								>
									<div class="min-w-0 flex-1">
										{#if isOwn}
											<button
												class="hover:text-primary-ink block w-full truncate text-left text-sm font-medium transition-colors"
												onclick={() => {
													sceneSummarizesCtx.setReviewSceneId(
														activity.sceneId
													)
													navigateToScene(activity)
												}}
												title={activity.status ===
												"running"
													? "View progress"
													: "Go to scene"}
											>
												{activity.sceneName ??
													`Scene #${activity.sceneId}`}
											</button>
										{:else}
											<p
												class="truncate text-sm font-medium"
											>
												{activity.sceneName ??
													`Scene #${activity.sceneId}`}
											</p>
										{/if}
										<p class="text-surface-700-300 text-xs">
											{activity.lorebookLabel ??
												`Lorebook #${activity.lorebookId}`}
											· Scene
											{#if activity.status === "running"}
												· <span
													class="text-primary-500"
												>
													Processing…
												</span>
											{:else if activity.status === "review"}
												· <span
													class="text-warning-500"
												>
													Ready to review
												</span>
											{:else if activity.status === "error"}
												· <span class="text-error-600-400">
													Failed
												</span>
											{/if}
										</p>
									</div>
									{#if activity.status === "running"}
										<!--
								Without this there is no way to stop a scene
								summarize from outside its modal — the card only
								ever offered dismiss, and only once the run had
								already finished. Cancel also matters now because
								it is what deletes a scene created solely to
								carry the run.
							-->
										{#if isOwn || isAdmin}
											<button
												class="text-surface-600-400 hover:text-error-600-400 shrink-0 transition-colors"
												onclick={() =>
													socket.emit(
														"activity:cancel",
														{
															id: activity.activityId
														}
													)}
												title="Stop processing"
												aria-label="Stop processing"
											>
												<Icons.Square size={14} />
											</button>
										{/if}
									{:else}
										<button
											class="text-surface-600-400 hover:text-surface-950-50 shrink-0 transition-colors"
											onclick={() =>
												sceneSummarizesCtx.dismiss(
													activity.activityId
												)}
											title="Dismiss"
											aria-label="Dismiss"
										>
											<Icons.X size={14} />
										</button>
									{/if}
								</div>
								{#if activity.status === "running" && activity.phase}
									<div class="space-y-1">
										<p
											class="text-surface-700-300 text-xs capitalize"
										>
											{activity.phase}
											{#if activity.totalBatches && activity.totalBatches > 1}
												· batch {activity.batch ??
													0}/{activity.totalBatches}
											{/if}
										</p>
										<div class="text-primary-500">
											<SpProgress
												attrs={{
													value: String(activity.phase === 'extracting' ? 95 : activity.phase === 'naming' ? 90 : activity.totalBatches && activity.totalBatches > 1 ? Math.max( 5, Math.round( ((activity.batch ?? 0) / activity.totalBatches) * 80 ) ) : activity.phase === 'synthesizing' ? 80 : 40),
													label: "Progress"
												}}
											/>
										</div>
									</div>
								{/if}
								{#if activity.status === "error" && activity.errorMessage}
									<p class="text-error-600-400 text-xs">
										{activity.errorMessage}
									</p>
								{/if}
								{#if isOwn && activity.status === "review"}
									<div class="flex items-center gap-2">
										<button
											class="btn btn-sm preset-filled-primary-500"
											onclick={() => {
												sceneSummarizesCtx.setReviewSceneId(
													activity.sceneId
												)
												navigateToScene(activity)
											}}
										>
											<Icons.Eye size={14} /> Review results
										</button>
									</div>
								{:else if isOwn && activity.status === "error"}
									<div class="flex items-center gap-2">
										<button
											class="btn btn-sm preset-tonal-surface"
											onclick={() =>
												navigateToScene(activity)}
										>
											<Icons.ExternalLink size={14} /> Go to
											Scene
										</button>
									</div>
								{/if}
							</div>
						{/each}
						{#each sessionSummarizeActivities as activity (activity.activityId)}
							{@const isOwn =
								activity.userId === userCtx?.user?.id}
							<div class="panel-card mx-4 mt-4 space-y-3">
								<div
									class="flex items-start justify-between gap-2"
								>
									<div class="min-w-0 flex-1">
										{#if isOwn}
											<button
												class="hover:text-primary-ink block w-full truncate text-left text-sm font-medium transition-colors"
												onclick={() =>
													navigateToSessionSummarize(
														activity
													)}
												title={activity.status ===
												"running"
													? "View progress"
													: "Go to session"}
											>
												{activity.topic ||
													activity.sessionLabel ||
													`Session #${activity.sessionId}`}
											</button>
										{:else}
											<p
												class="truncate text-sm font-medium"
											>
												{activity.topic ||
													activity.sessionLabel ||
													`Session #${activity.sessionId}`}
											</p>
										{/if}
										<p class="text-surface-700-300 text-xs">
											{activity.loreType === "world"
												? "World lore"
												: "Character lore"}
											{#if activity.status === "running"}
												· <span
													class="text-primary-500"
												>
													Summarizing…
												</span>
											{:else if activity.status === "review"}
												· <span
													class="text-warning-500"
												>
													Ready to review
												</span>
											{:else if activity.status === "error"}
												· <span class="text-error-600-400">
													Failed
												</span>
											{/if}
										</p>
									</div>
									{#if activity.status === "running"}
										<!--
								Present from the outset, deliberately: the scene
								card shipped without a stop control and had to
								have one retrofitted. A background run the user
								cannot stop is worse than no background run.
							-->
										{#if isOwn || isAdmin}
											<button
												class="text-surface-600-400 hover:text-error-600-400 shrink-0 transition-colors"
												onclick={() =>
													socket.emit(
														"activity:cancel",
														{
															id: activity.activityId
														}
													)}
												title="Stop summarizing"
												aria-label="Stop summarizing"
											>
												<Icons.Square size={14} />
											</button>
										{/if}
									{:else}
										<button
											class="text-surface-600-400 hover:text-surface-950-50 shrink-0 transition-colors"
											onclick={() =>
												sessionSummarizesCtx.dismiss(
													activity.activityId
												)}
											title="Dismiss"
											aria-label="Dismiss"
										>
											<Icons.X size={14} />
										</button>
									{/if}
								</div>
								{#if activity.status === "running" && activity.phase}
									<p
										class="text-surface-700-300 text-xs capitalize"
									>
										{activity.phase}
										{#if activity.totalBatches && activity.totalBatches > 1}
											· batch {activity.batch ??
												0}/{activity.totalBatches}
										{/if}
									</p>
								{/if}
								{#if activity.status === "error" && activity.errorMessage}
									<p class="text-error-600-400 text-xs">
										{activity.errorMessage}
									</p>
								{/if}
							</div>
						{/each}
						{#each compileActivities as activity (activity.activityId)}
							{@const isOwn =
								activity.userId === userCtx?.user?.id}
							<div class="panel-card mx-4 mt-4 space-y-3">
								<div
									class="flex items-start justify-between gap-2"
								>
									<div class="min-w-0 flex-1">
										{#if isOwn}
											<button
												class="hover:text-primary-ink block w-full truncate text-left text-sm font-medium transition-colors"
												onclick={() =>
													navigateToCompileEntry(
														activity
													)}
												title="Go to history entry"
											>
												{activity.historyEntryDate}
											</button>
										{:else}
											<p
												class="truncate text-sm font-medium"
											>
												{activity.historyEntryDate}
											</p>
										{/if}
										<p class="text-surface-700-300 text-xs">
											{activity.lorebookLabel} · Compile
											{#if activity.status === "running"}
												· <span
													class="text-primary-500"
												>
													Compiling…
												</span>
											{:else if activity.status === "review"}
												· <span
													class="text-warning-500"
												>
													Ready to review
												</span>
											{:else if activity.status === "error"}
												· <span class="text-error-600-400">
													Failed
												</span>
											{/if}
										</p>
									</div>
									{#if activity.status !== "running"}
										<button
											class="text-surface-600-400 hover:text-surface-950-50 shrink-0 transition-colors"
											onclick={() =>
												compileEntriesCtx.dismiss(
													activity.activityId
												)}
											title="Dismiss"
											aria-label="Dismiss"
										>
											<Icons.X size={14} />
										</button>
									{/if}
								</div>
								{#if activity.status === "running" && activity.phase}
									<div class="space-y-1">
										<p
											class="text-surface-700-300 text-xs capitalize"
										>
											{activity.phase}
											{#if activity.totalBatches && activity.totalBatches > 1}
												· batch {activity.batch ??
													0}/{activity.totalBatches}
											{/if}
										</p>
										<div class="text-primary-500">
											<SpProgress
												attrs={{
													value: String(activity.phase === 'synthesizing' ? 80 : activity.totalBatches && activity.totalBatches > 1 ? Math.max( 5, Math.round( ((activity.batch ?? 0) / activity.totalBatches) * 75 ) ) : 40),
													label: "Progress"
												}}
											/>
										</div>
									</div>
								{/if}
								{#if activity.status === "error" && activity.errorMessage}
									<p class="text-error-600-400 text-xs">
										{activity.errorMessage}
									</p>
								{/if}
								{#if isOwn && activity.status === "review"}
									<div class="flex items-center gap-2">
										<button
											class="btn btn-sm preset-filled-primary-500"
											onclick={() => {
												compileEntriesCtx.setReviewActivityId(
													activity.activityId
												)
												navigateToCompileEntry(activity)
											}}
										>
											<Icons.Eye size={14} /> Review and apply
										</button>
									</div>
								{:else if isOwn && activity.status === "error"}
									<div class="flex items-center gap-2">
										<button
											class="btn btn-sm preset-tonal-surface"
											onclick={() =>
												navigateToCompileEntry(
													activity
												)}
										>
											<Icons.ExternalLink size={14} /> Go to
											Entry
										</button>
									</div>
								{/if}
							</div>
						{/each}
					</section>
				{/if}
				{#if earlier.length > 0}
					<section aria-labelledby="{uid}-earlier">
						<ListGroupLabel
							id="{uid}-earlier"
							label="Earlier"
							class="px-4"
						/>
						<ul>
							{#each earlier as row (row.id)}
								{@render notificationRow(row, true)}
							{/each}
						</ul>
					</section>
				{/if}
				{#if nothingHere}
					<EmptyState
						icon={Icons.CheckCircle}
						message="Nothing is waiting on you."
					/>
				{:else}
					<div class="h-4"></div>
				{/if}
			{/if}
		</div>
		{#if showTabs}
			<div
				id="{tabIdPrefix}-queue"
				role="tabpanel"
				aria-labelledby="{tabIdPrefix}-queue-tab"
				hidden={shownTab !== "queue"}
				class="mx-auto w-full max-w-[560px]"
			>
				{#if shownTab === "queue"}
					{#if queueCount === 0}
						<EmptyState
							icon={Icons.Cpu}
							message="The queue is empty."
						/>
					{:else}
						<div class="divide-surface-200-800 divide-y">
							{#each taskQueueCtx.tasks as task}
								{@const expanded = expandedTaskId === task.id}
								<div class="divide-surface-200-800 divide-y">
									<button
										class="hover:bg-surface-100-900 flex w-full items-center gap-2 px-4 py-3 text-left transition-colors"
										onclick={() => toggleTask(task.id)}
									>
										<div class="min-w-0 flex-1">
											<p
												class="truncate text-sm font-medium"
											>
												{task.label ?? task.taskType}
											</p>
											<p
												class="text-surface-700-300 text-xs"
											>
												{task.connectionName}{#if task.samplingName}
													· {task.samplingName}{/if}
											</p>
										</div>
										<div
											class="flex shrink-0 items-center gap-2"
										>
											{#if task.status !== "generating"}
												<span
													class="text-surface-700-300 text-xs capitalize"
												>
													{task.status}
												</span>
											{/if}
											<div
												class="bg-primary-500 h-1.5 w-1.5 animate-pulse rounded-full"
											></div>
											<Icons.ChevronDown
												size={14}
												class="text-surface-600-400 transition-transform {expanded
													? 'rotate-180'
													: ''}"
											/>
										</div>
									</button>
									{#if expanded}
										<div
											class="bg-surface-100-900 space-y-1.5 px-4 py-3 text-xs"
										>
											<div
												class="flex justify-between gap-2"
											>
												<span
													class="text-surface-700-300"
												>
													Status
												</span>
												<span
													class="text-right font-mono capitalize"
												>
													{task.status}
												</span>
											</div>
											<div
												class="flex justify-between gap-2"
											>
												<span
													class="text-surface-700-300"
												>
													Type
												</span>
												<span
													class="text-right font-mono"
												>
													{task.taskType}
												</span>
											</div>
											<div
												class="flex justify-between gap-2"
											>
												<span
													class="text-surface-700-300"
												>
													Connection
												</span>
												<span
													class="truncate text-right"
												>
													{task.connectionName}
												</span>
											</div>
											{#if task.samplingName}
												<div
													class="flex justify-between gap-2"
												>
													<span
														class="text-surface-700-300"
													>
														Sampling
													</span>
													<span
														class="truncate text-right"
													>
														{task.samplingName}
													</span>
												</div>
											{/if}
											{#if task.sessionId}
												<div
													class="flex justify-between gap-2"
												>
													<span
														class="text-surface-700-300"
													>
														Session ID
													</span>
													<span class="font-mono">
														{task.sessionId}
													</span>
												</div>
											{/if}
											{#if task.lorebookId}
												<div
													class="flex justify-between gap-2"
												>
													<span
														class="text-surface-700-300"
													>
														Lorebook ID
													</span>
													<span class="font-mono">
														{task.lorebookId}
													</span>
												</div>
											{/if}
											<div
												class="flex justify-between gap-2"
											>
												<span
													class="text-surface-700-300"
												>
													Running
												</span>
												<span class="font-mono">
													{elapsedLabel(
														task.startedAt
													)}
												</span>
											</div>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				{/if}
			</div>
		{/if}
	</div>
</div>
