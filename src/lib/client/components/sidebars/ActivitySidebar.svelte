<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import { getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}

	let { onclose = $bindable() }: Props = $props()

	const socket = useTypedSocket()

	let graphBuildsCtx: GraphBuildsCtx = $state(getContext("graphBuildsCtx"))
	let sceneSummarizesCtx: SceneSummarizesCtx = $state(
		getContext("sceneSummarizesCtx")
	)
	let compileEntriesCtx: CompileEntriesCtx = $state(
		getContext("compileEntriesCtx")
	)
	let chatSummarizesCtx: ChatSummarizesCtx = $state(
		getContext("chatSummarizesCtx")
	)
	let taskQueueCtx: TaskQueueCtx = $state(getContext("taskQueueCtx"))
	let panelsCtx: PanelsCtx = $state(getContext("panelsCtx"))
	let userCtx: UserCtx = $state(getContext("userCtx"))

	let build = $derived(graphBuildsCtx?.activeBuild)
	let sceneActivities = $derived(sceneSummarizesCtx?.activities ?? [])
	let compileActivities = $derived(compileEntriesCtx?.activities ?? [])
	let chatSummarizeActivities = $derived(
		chatSummarizesCtx?.activities ?? []
	)
	let hasActivity = $derived(
		!!build ||
			sceneActivities.length > 0 ||
			compileActivities.length > 0 ||
			chatSummarizeActivities.length > 0
	)
	let activityCount = $derived(
		(build ? 1 : 0) +
			sceneActivities.length +
			compileActivities.length +
			chatSummarizeActivities.length
	)
	let queueCount = $derived(taskQueueCtx?.tasks?.length ?? 0)

	let isAdmin = $derived(!!userCtx?.user?.isAdmin)
	let isOwnActivity = $derived(!!build && build.userId === userCtx?.user?.id)
	let canStop = $derived(
		!!build && build.status === "building" && (isOwnActivity || isAdmin)
	)
	let activeTab = $state<"activity" | "queue">("activity")

	$effect(() => {
		if (activeTab !== "queue" || !isAdmin) return
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

	function navigateToGraphTab() {
		if (!build || !isOwnActivity) return
		panelsCtx.digest.lorebookId = build.lorebookId
		panelsCtx.digest.lorebookTab = "graph"
		panelsCtx.openPanel({ key: "lorebooks", toggle: false })
	}

	function openModal() {
		if (!build || !isOwnActivity) return
		panelsCtx.digest.lorebookId = build.lorebookId
		panelsCtx.digest.lorebookTab = "graph"
		panelsCtx.openPanel({ key: "lorebooks", toggle: false })
		graphBuildsCtx.reopenLorebookId = build.lorebookId
	}

	function navigateToScene(activity: SceneSummarizeState) {
		panelsCtx.digest.lorebookId = activity.lorebookId
		if (activity.historyEntryId) {
			panelsCtx.digest.historyEntryId = activity.historyEntryId
			panelsCtx.digest.historyEntryTab = "scenes"
			panelsCtx.digest.sceneId = activity.sceneId
		} else {
			panelsCtx.digest.lorebookTab = "history"
		}
		panelsCtx.openPanel({ key: "lorebooks", toggle: false })
	}

	/**
	 * Unlike the graph/scene/compile cards, which open a panel via
	 * panelsCtx.digest, a chat summarize belongs to a route — so reopening means
	 * navigating to the chat first and letting that page pick the run back up
	 * from `reviewActivityId`.
	 */
	function navigateToChatSummarize(activity: ChatSummarizeState) {
		chatSummarizesCtx.setReviewActivityId(activity.activityId)
		goto(`/chats/${activity.chatId}`)
	}

	function navigateToCompileEntry(activity: CompileEntryState) {
		panelsCtx.digest.lorebookId = activity.lorebookId
		panelsCtx.digest.lorebookTab = "history"
		panelsCtx.digest.historyEntryId = activity.historyEntryId
		panelsCtx.openPanel({ key: "lorebooks", toggle: false })
	}

	const BUILD_STATUS_COLOR: Record<string, string> = {
		building: "text-primary-500",
		review: "text-success-500",
		error: "text-error-500"
	}
	const BUILD_STATUS_LABEL: Record<string, string> = {
		building: "In progress",
		review: "Ready to review",
		error: "Failed"
	}
</script>

<!-- Tabs -->
<div class="border-surface-200-800 flex shrink-0 border-b">
	<button
		class="flex-1 px-4 py-2 text-sm font-medium transition-colors {activeTab ===
		'activity'
			? 'border-primary-500 text-primary-500 border-b-2'
			: 'text-surface-700-300 hover:text-surface-700-300'}"
		onclick={() => (activeTab = "activity")}
	>
		Activity
		{#if hasActivity}
			<span
				class="bg-primary-500/20 text-primary-500 ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px]"
			>
				{activityCount}
			</span>
		{/if}
	</button>
	{#if isAdmin}
		<button
			class="flex-1 px-4 py-2 text-sm font-medium transition-colors {activeTab ===
			'queue'
				? 'border-primary-500 text-primary-500 border-b-2'
				: 'text-surface-700-300 hover:text-surface-700-300'}"
			onclick={() => (activeTab = "queue")}
		>
			LLM Queue
			{#if queueCount > 0}
				<span
					class="bg-warning-500/20 text-warning-500 ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px]"
				>
					{queueCount}
				</span>
			{/if}
		</button>
	{/if}
</div>

<!-- Content -->
<div class="flex-1 overflow-y-auto">
	{#if activeTab === "activity"}
		{#if build}
			<div class="m-4 mb-0">
				<div
					class="bg-surface-200-800 border-surface-300-700 space-y-3 rounded-lg border p-3"
				>
					<!-- Card header: title + dismiss -->
					<div class="flex items-start justify-between gap-2">
						<div class="min-w-0 flex-1">
							{#if isOwnActivity}
								<button
									class="hover:text-primary-500 block w-full truncate text-left text-sm font-medium transition-colors"
									onclick={navigateToGraphTab}
									title="Go to graph tab"
								>
									{build.lorebookLabel ??
										`Lorebook #${build.lorebookId}`}
								</button>
							{:else}
								<p class="truncate text-sm font-medium">
									{build.lorebookLabel ??
										`Lorebook #${build.lorebookId}`}
								</p>
							{/if}
							<p class="text-surface-700-300 text-xs">
								{build.mode === "extend" ? "Extend" : "Build"} graph
								·
								<span class={BUILD_STATUS_COLOR[build.status]}>
									{BUILD_STATUS_LABEL[build.status]}
								</span>
							</p>
						</div>
						{#if build.status !== "building"}
							<button
								class="text-surface-400 hover:text-surface-600-400 shrink-0 transition-colors"
								onclick={() => graphBuildsCtx?.clearBuild()}
								title="Dismiss"
							>
								<Icons.X size={14} />
							</button>
						{/if}
					</div>

					{#if build.status === "building"}
						<div class="space-y-1">
							<p class="text-surface-700-300 text-xs capitalize">
								{build.phase.replace(/_/g, " ")}
								{#if build.totalScenes > 0}· scene {build.sceneIndex +
										1}/{build.totalScenes}{/if}
							</p>
							<div
								class="bg-surface-300-700 h-1.5 w-full overflow-hidden rounded-full"
							>
								<div
									class="bg-primary-500 h-full rounded-full transition-all duration-500"
									style="width: {build.totalScenes > 0
										? Math.max(
												10,
												Math.round(
													(build.sceneIndex /
														build.totalScenes) *
														80
												) + 5
											)
										: 5}%"
								></div>
							</div>
							{#if build.currentPair}
								<p
									class="text-surface-400 truncate font-mono text-xs"
								>
									{build.currentPair}
								</p>
							{/if}
						</div>
					{/if}

					<!-- Card footer: stop + action buttons -->
					<div class="flex items-center gap-2">
						{#if canStop}
							<button
								class="btn btn-sm preset-tonal-error"
								onclick={() =>
									build?.activityId &&
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
									class="btn btn-sm preset-filled-surface-400-600"
									onclick={openModal}
								>
									<Icons.Eye size={14} /> View Progress
								</button>
							{:else if build.status === "review"}
								<button
									class="btn btn-sm preset-filled-primary-500"
									onclick={openModal}
								>
									<Icons.Check size={14} /> Review & Apply
								</button>
							{:else if build.status === "error"}
								<button
									class="btn btn-sm preset-tonal-error"
									onclick={openModal}
								>
									<Icons.AlertCircle size={14} /> View Error
								</button>
							{/if}
						{/if}
					</div>
				</div>
			</div>
		{/if}
		{#each sceneActivities as activity (activity.activityId)}
			{@const isOwn = activity.userId === userCtx?.user?.id}
			<div class="m-4 mb-0">
				<div
					class="bg-surface-200-800 border-surface-300-700 space-y-3 rounded-lg border p-3"
				>
					<div class="flex items-start justify-between gap-2">
						<div class="min-w-0 flex-1">
							{#if isOwn}
								<button
									class="hover:text-primary-500 block w-full truncate text-left text-sm font-medium transition-colors"
									onclick={() => {
										sceneSummarizesCtx.setReviewSceneId(
											activity.sceneId
										)
										navigateToScene(activity)
									}}
									title={activity.status === "running"
										? "View progress"
										: "Go to scene"}
								>
									{activity.sceneName ??
										`Scene #${activity.sceneId}`}
								</button>
							{:else}
								<p class="truncate text-sm font-medium">
									{activity.sceneName ??
										`Scene #${activity.sceneId}`}
								</p>
							{/if}
							<p class="text-surface-700-300 text-xs">
								{activity.lorebookLabel ??
									`Lorebook #${activity.lorebookId}`} · Scene
								{#if activity.status === "running"}
									· <span class="text-primary-500">
										Processing…
									</span>
								{:else if activity.status === "review"}
									· <span class="text-warning-500">
										Ready to review
									</span>
								{:else if activity.status === "error"}
									· <span class="text-error-500">Failed</span>
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
							<button
								class="text-surface-400 hover:text-error-500 shrink-0 transition-colors"
								onclick={() =>
									socket.emit("activity:cancel", {
										id: activity.activityId
									})}
								title="Stop processing"
							>
								<Icons.Square size={14} />
							</button>
						{:else}
							<button
								class="text-surface-400 hover:text-surface-600-400 shrink-0 transition-colors"
								onclick={() =>
									sceneSummarizesCtx.dismiss(
										activity.activityId
									)}
								title="Dismiss"
							>
								<Icons.X size={14} />
							</button>
						{/if}
					</div>
					{#if activity.status === "running" && activity.phase}
						<div class="space-y-1">
							<p class="text-surface-700-300 text-xs capitalize">
								{activity.phase}
								{#if activity.totalBatches && activity.totalBatches > 1}
									· batch {activity.batch ??
										0}/{activity.totalBatches}
								{/if}
							</p>
							<div
								class="bg-surface-300-700 h-1.5 w-full overflow-hidden rounded-full"
							>
								<div
									class="bg-primary-500 h-full rounded-full transition-all duration-500"
									style="width: {activity.phase ===
									'extracting'
										? 95
										: activity.phase === 'naming'
											? 90
											: activity.totalBatches &&
												  activity.totalBatches > 1
												? Math.max(
														5,
														Math.round(
															((activity.batch ?? 0) /
																activity.totalBatches) *
																80
														)
													)
												: activity.phase === 'synthesizing'
													? 80
													: 40}%"
								></div>
							</div>
						</div>
					{/if}
					{#if activity.status === "error" && activity.errorMessage}
						<p class="text-error-500 text-xs">
							{activity.errorMessage}
						</p>
					{/if}
					{#if isOwn && activity.status === "review"}
						<div class="flex items-center gap-2">
							<button
								class="btn btn-sm preset-filled-warning-500"
								onclick={() => {
									sceneSummarizesCtx.setReviewSceneId(
										activity.sceneId
									)
									navigateToScene(activity)
								}}
							>
								<Icons.Eye size={14} /> Review Results
							</button>
						</div>
					{:else if isOwn && activity.status === "error"}
						<div class="flex items-center gap-2">
							<button
								class="btn btn-sm preset-filled-surface-400-600"
								onclick={() => navigateToScene(activity)}
							>
								<Icons.ExternalLink size={14} /> Go to Scene
							</button>
						</div>
					{/if}
				</div>
			</div>
		{/each}
		{#each chatSummarizeActivities as activity (activity.activityId)}
			{@const isOwn = activity.userId === userCtx?.user?.id}
			<div class="m-4 mb-0">
				<div
					class="bg-surface-200-800 border-surface-300-700 space-y-3 rounded-lg border p-3"
				>
					<div class="flex items-start justify-between gap-2">
						<div class="min-w-0 flex-1">
							{#if isOwn}
								<button
									class="hover:text-primary-500 block w-full truncate text-left text-sm font-medium transition-colors"
									onclick={() =>
										navigateToChatSummarize(activity)}
									title={activity.status === "running"
										? "View progress"
										: "Go to chat"}
								>
									{activity.topic ||
										activity.chatLabel ||
										`Chat #${activity.chatId}`}
								</button>
							{:else}
								<p class="truncate text-sm font-medium">
									{activity.topic ||
										activity.chatLabel ||
										`Chat #${activity.chatId}`}
								</p>
							{/if}
							<p class="text-surface-700-300 text-xs">
								{activity.loreType === "world"
									? "World lore"
									: "Character lore"}
								{#if activity.status === "running"}
									· <span class="text-primary-500">
										Summarizing…
									</span>
								{:else if activity.status === "review"}
									· <span class="text-warning-500">
										Ready to review
									</span>
								{:else if activity.status === "error"}
									· <span class="text-error-500">Failed</span>
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
							<button
								class="text-surface-400 hover:text-error-500 shrink-0 transition-colors"
								onclick={() =>
									socket.emit("activity:cancel", {
										id: activity.activityId
									})}
								title="Stop summarizing"
							>
								<Icons.Square size={14} />
							</button>
						{:else}
							<button
								class="text-surface-400 hover:text-surface-600-400 shrink-0 transition-colors"
								onclick={() =>
									chatSummarizesCtx.dismiss(
										activity.activityId
									)}
								title="Dismiss"
							>
								<Icons.X size={14} />
							</button>
						{/if}
					</div>
					{#if activity.status === "running" && activity.phase}
						<p class="text-surface-700-300 text-xs capitalize">
							{activity.phase}
							{#if activity.totalBatches && activity.totalBatches > 1}
								· batch {activity.batch ??
									0}/{activity.totalBatches}
							{/if}
						</p>
					{/if}
					{#if activity.status === "error" && activity.errorMessage}
						<p class="text-error-500 text-xs">
							{activity.errorMessage}
						</p>
					{/if}
				</div>
			</div>
		{/each}
		{#each compileActivities as activity (activity.activityId)}
			{@const isOwn = activity.userId === userCtx?.user?.id}
			<div class="m-4 mb-0">
				<div
					class="bg-surface-200-800 border-surface-300-700 space-y-3 rounded-lg border p-3"
				>
					<div class="flex items-start justify-between gap-2">
						<div class="min-w-0 flex-1">
							{#if isOwn}
								<button
									class="hover:text-primary-500 block w-full truncate text-left text-sm font-medium transition-colors"
									onclick={() =>
										navigateToCompileEntry(activity)}
									title="Go to history entry"
								>
									{activity.historyEntryDate}
								</button>
							{:else}
								<p class="truncate text-sm font-medium">
									{activity.historyEntryDate}
								</p>
							{/if}
							<p class="text-surface-700-300 text-xs">
								{activity.lorebookLabel} · Compile
								{#if activity.status === "running"}
									· <span class="text-primary-500">
										Compiling…
									</span>
								{:else if activity.status === "review"}
									· <span class="text-warning-500">
										Ready to review
									</span>
								{:else if activity.status === "error"}
									· <span class="text-error-500">Failed</span>
								{/if}
							</p>
						</div>
						{#if activity.status !== "running"}
							<button
								class="text-surface-400 hover:text-surface-600-400 shrink-0 transition-colors"
								onclick={() =>
									compileEntriesCtx.dismiss(
										activity.activityId
									)}
								title="Dismiss"
							>
								<Icons.X size={14} />
							</button>
						{/if}
					</div>
					{#if activity.status === "running" && activity.phase}
						<div class="space-y-1">
							<p class="text-surface-700-300 text-xs capitalize">
								{activity.phase}
								{#if activity.totalBatches && activity.totalBatches > 1}
									· batch {activity.batch ??
										0}/{activity.totalBatches}
								{/if}
							</p>
							<div
								class="bg-surface-300-700 h-1.5 w-full overflow-hidden rounded-full"
							>
								<div
									class="bg-primary-500 h-full rounded-full transition-all duration-500"
									style="width: {activity.phase ===
									'synthesizing'
										? 80
										: activity.totalBatches &&
											  activity.totalBatches > 1
											? Math.max(
													5,
													Math.round(
														((activity.batch ?? 0) /
															activity.totalBatches) *
															75
													)
												)
											: 40}%"
								></div>
							</div>
						</div>
					{/if}
					{#if activity.status === "error" && activity.errorMessage}
						<p class="text-error-500 text-xs">
							{activity.errorMessage}
						</p>
					{/if}
					{#if isOwn && activity.status === "review"}
						<div class="flex items-center gap-2">
							<button
								class="btn btn-sm preset-filled-warning-500"
								onclick={() => {
									compileEntriesCtx.setReviewHistoryEntryId(
										activity.historyEntryId
									)
									navigateToCompileEntry(activity)
								}}
							>
								<Icons.Eye size={14} /> Review & Apply
							</button>
						</div>
					{:else if isOwn && activity.status === "error"}
						<div class="flex items-center gap-2">
							<button
								class="btn btn-sm preset-filled-surface-400-600"
								onclick={() => navigateToCompileEntry(activity)}
							>
								<Icons.ExternalLink size={14} /> Go to Entry
							</button>
						</div>
					{/if}
				</div>
			</div>
		{/each}
		{#if !build && sceneActivities.length === 0 && compileActivities.length === 0}
			<div
				class="text-surface-700-300 flex flex-col items-center gap-2 py-12 text-sm"
			>
				<Icons.CheckCircle size={28} class="opacity-30" />
				No active tasks
			</div>
		{:else}
			<div class="h-4"></div>
		{/if}
	{:else if activeTab === "queue" && isAdmin}
		{#if queueCount === 0}
			<div
				class="text-surface-700-300 flex flex-col items-center gap-2 py-12 text-sm"
			>
				<Icons.Cpu size={28} class="opacity-30" />
				Queue is empty
			</div>
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
								<p class="truncate text-sm font-medium">
									{task.label ?? task.taskType}
								</p>
								<p class="text-surface-700-300 text-xs">
									{task.connectionName}{#if task.samplingName}
										· {task.samplingName}{/if}
								</p>
							</div>
							<div class="flex shrink-0 items-center gap-2">
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
									class="text-surface-400 transition-transform {expanded
										? 'rotate-180'
										: ''}"
								/>
							</div>
						</button>
						{#if expanded}
							<div
								class="bg-surface-100-900 space-y-1.5 px-4 py-3 text-xs"
							>
								<div class="flex justify-between gap-2">
									<span class="text-surface-700-300">
										Status
									</span>
									<span
										class="text-right font-mono capitalize"
									>
										{task.status}
									</span>
								</div>
								<div class="flex justify-between gap-2">
									<span class="text-surface-700-300">
										Type
									</span>
									<span class="text-right font-mono">
										{task.taskType}
									</span>
								</div>
								<div class="flex justify-between gap-2">
									<span class="text-surface-700-300">
										Connection
									</span>
									<span class="truncate text-right">
										{task.connectionName}
									</span>
								</div>
								{#if task.samplingName}
									<div class="flex justify-between gap-2">
										<span class="text-surface-700-300">
											Sampling
										</span>
										<span class="truncate text-right">
											{task.samplingName}
										</span>
									</div>
								{/if}
								{#if task.chatId}
									<div class="flex justify-between gap-2">
										<span class="text-surface-700-300">
											Chat ID
										</span>
										<span class="font-mono">
											{task.chatId}
										</span>
									</div>
								{/if}
								{#if task.lorebookId}
									<div class="flex justify-between gap-2">
										<span class="text-surface-700-300">
											Lorebook ID
										</span>
										<span class="font-mono">
											{task.lorebookId}
										</span>
									</div>
								{/if}
								<div class="flex justify-between gap-2">
									<span class="text-surface-700-300">
										Running
									</span>
									<span class="font-mono">
										{elapsedLabel(task.startedAt)}
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
