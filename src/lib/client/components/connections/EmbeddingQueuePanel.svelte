<script lang="ts">
	/**
	 * The embedding queue, as the STARRED connection's detail panel.
	 *
	 * ## What belongs here, and what does not
	 *
	 * Only the part that belongs to no single field: the indexing QUEUE, which is
	 * instance-wide, and whether the backend is up. Everything else about an
	 * embedding endpoint is an ordinary connection control and must stay one —
	 * the service in the New Connection picker, the endpoint and key in the
	 * connection form, the model in `ConnectionModels`, and "off" is unstarring.
	 * A setup flow, a model list or a disable switch added here would be a second
	 * place to set something the connection already holds.
	 *
	 * ## Why it renders only for the starred connection
	 *
	 * There is one queue, and it runs against whichever connection is starred. A
	 * queue panel under an unstarred embedding connection would be showing
	 * somebody another connection's work under this one's heading.
	 */
	import * as Icons from "@lucide/svelte"
	import { getContext, onMount } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { useInterest } from "$lib/client/sockets/interest.svelte"

	interface Props {
		/** Whether the connection this is mounted under is the one starred. */
		isStarred: boolean
	}
	let { isStarred }: Props = $props()

	const socket = useTypedSocket()
	const vectorizationCtx: VectorizationCtx = getContext("vectorizationCtx")

	let status = $state<Sockets.Vectorization.ListModels.Response | null>(null)
	let startingQueue = $state(false)
	let stoppingQueue = $state(false)
	let loadingModel = $state(false)
	let removingGroup = $state<string | null>(null)
	/** A first local load downloads several hundred megabytes; show it moving. */
	let downloadProgress = $state<{
		status: "loading" | "downloading" | "ready" | "error"
		percent?: number
	} | null>(null)

	const modelReady = $derived(status?.modelReady ?? false)

	function handleListModels(msg: Sockets.Vectorization.ListModels.Response) {
		status = msg
		loadingModel = false
	}
	function handleLoadModel() {
		loadingModel = false
		downloadProgress = null
	}
	function handleDownloadProgress(
		msg: Sockets.Vectorization.ModelDownloadProgress.Response
	) {
		if (msg.status === "ready" || msg.status === "error") {
			downloadProgress = null
			loadingModel = false
			return
		}
		downloadProgress = { status: msg.status, percent: msg.percent }
	}
	function handleStartQueue() {
		startingQueue = false
	}
	function handleStopQueue() {
		stoppingQueue = false
	}
	function handleGetQueue(msg: Sockets.Vectorization.GetQueue.Response) {
		vectorizationCtx.priorityQueue = msg.queue
		vectorizationCtx.history = msg.history ?? []
	}
	function handleRemoveFromQueue(
		msg: Sockets.Vectorization.RemoveFromQueue.Response
	) {
		vectorizationCtx.priorityQueue = msg.queue
		removingGroup = null
	}
	function handleMoveQueueGroup(
		msg: Sockets.Vectorization.MoveQueueGroup.Response
	) {
		vectorizationCtx.priorityQueue = msg.queue
	}

	// Standing interest in the queue's eight replies, declared ABOVE the mount
	// that asks for the first two: effects run in creation order, so a
	// declaration made after the emit would miss the interest sync the request
	// flushes. `vectorization:` is not a restricted prefix — two of its handlers
	// serve every user — so these keys are declared unconditionally.
	useInterest<"vectorization:listModels">(
		"vectorization:listModels",
		handleListModels
	)
	useInterest<"vectorization:loadModel">(
		"vectorization:loadModel",
		handleLoadModel
	)
	useInterest<"vectorization:modelDownloadProgress">(
		"vectorization:modelDownloadProgress",
		handleDownloadProgress
	)
	useInterest<"vectorization:startQueue">(
		"vectorization:startQueue",
		handleStartQueue
	)
	useInterest<"vectorization:stopQueue">(
		"vectorization:stopQueue",
		handleStopQueue
	)
	useInterest<"vectorization:getQueue">(
		"vectorization:getQueue",
		handleGetQueue
	)
	useInterest<"vectorization:removeFromQueue">(
		"vectorization:removeFromQueue",
		handleRemoveFromQueue
	)
	useInterest<"vectorization:moveQueueGroup">(
		"vectorization:moveQueueGroup",
		handleMoveQueueGroup
	)

	onMount(() => {
		socket.emit("vectorization:listModels", {})
		socket.emit("vectorization:getQueue", {})
	})

	function startQueue() {
		startingQueue = true
		socket.emit("vectorization:startQueue", {})
	}
	function stopQueue() {
		stoppingQueue = true
		socket.emit("vectorization:stopQueue", {})
	}
	function loadModel() {
		loadingModel = true
		socket.emit("vectorization:loadModel", {})
	}
	function removeGroup(groupId: string) {
		removingGroup = groupId
		socket.emit("vectorization:removeFromQueue", { groupId })
	}
	function moveGroup(groupId: string, direction: "up" | "down") {
		socket.emit("vectorization:moveQueueGroup", { groupId, direction })
	}

	const statusColor = $derived(
		vectorizationCtx.status === "running"
			? "text-success-500"
			: vectorizationCtx.status === "paused"
				? "text-warning-500"
				: "text-surface-400"
	)
	const statusLabel = $derived(
		vectorizationCtx.status === "running"
			? "Running"
			: vectorizationCtx.status === "paused"
				? "Paused"
				: "Idle"
	)

	function timeAgo(iso: string): string {
		const diff = Date.now() - new Date(iso).getTime()
		const s = Math.floor(diff / 1000)
		if (s < 60) return `${s}s ago`
		const m = Math.floor(s / 60)
		if (m < 60) return `${m}m ago`
		const h = Math.floor(m / 60)
		if (h < 24) return `${h}h ago`
		return `${Math.floor(h / 24)}d ago`
	}

	function groupSummary(group: Sockets.Vectorization.PriorityGroup): string {
		const parts: string[] = []
		if (group.characterIds.length > 0)
			parts.push(
				`${group.characterIds.length} char${group.characterIds.length !== 1 ? "s" : ""}`
			)
		if (group.personaIds.length > 0)
			parts.push(
				`${group.personaIds.length} persona${group.personaIds.length !== 1 ? "s" : ""}`
			)
		if (group.lorebookIds.length > 0)
			parts.push(
				`${group.lorebookIds.length} lorebook${group.lorebookIds.length !== 1 ? "s" : ""}`
			)
		return parts.join(" · ")
	}
</script>

<div class="mt-6 flex flex-col gap-3">
	<span class="flex items-center gap-2 font-semibold">
		<Icons.List size={14} aria-hidden="true" />
		Indexing
	</span>

	{#if !isStarred}
		<p class="text-muted text-xs">
			There is one embedding queue and it runs on whichever connection is
			in use. Press "Use for embeddings" above to see its progress here.
		</p>
	{:else}
		<!-- Backend health. The one thing a person cannot see from the form
		     fields: whether the model is actually resident. -->
		{#if !modelReady}
			<div
				class="border-warning-500/30 bg-warning-500/10 flex items-start gap-3 rounded-lg border p-3"
			>
				<Icons.AlertTriangle
					size={16}
					class="text-warning-500 mt-0.5 shrink-0"
					aria-hidden="true"
				/>
				<div class="min-w-0 flex-1 space-y-2">
					<p class="text-sm font-medium">Backend not loaded</p>
					<p class="text-surface-700-300 text-xs">
						{status?.loadError ??
							(status?.modelCached === false
								? "The model files are not in the local cache. Loading downloads them."
								: "Retrieval falls back to keyword search until this loads.")}
					</p>
					<button
						class="btn btn-sm preset-tonal-warning text-xs"
						onclick={loadModel}
						disabled={loadingModel}
					>
						{#if loadingModel}
							<Icons.Loader
								size={12}
								class="animate-spin"
								aria-hidden="true"
							/>
							Loading…
						{:else}
							<Icons.Download size={12} aria-hidden="true" />
							Load now
						{/if}
					</button>
					{#if downloadProgress}
						<div class="space-y-1">
							<div
								class="flex items-center justify-between text-xs"
							>
								<span class="text-surface-700-300 capitalize">
									{downloadProgress.status}…
								</span>
								{#if downloadProgress.percent !== undefined}
									<span class="font-mono">
										{downloadProgress.percent}%
									</span>
								{/if}
							</div>
							<div
								class="bg-surface-300-700 h-1.5 w-full overflow-hidden rounded-full"
							>
								{#if downloadProgress.percent !== undefined}
									<div
										class="bg-primary-500 h-full transition-all duration-300"
										style="width: {downloadProgress.percent}%"
									></div>
								{:else}
									<!-- The source gave no total, so an
									     indeterminate bar rather than a
									     percentage nobody measured. -->
									<div
										class="bg-primary-500 h-full w-1/3 animate-pulse rounded-full"
									></div>
								{/if}
							</div>
						</div>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Queue status -->
		<div class="preset-tonal-surface rounded-lg p-3">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2">
					{#if vectorizationCtx.status === "running"}
						<Icons.Loader
							size={16}
							class="text-success-500 animate-spin"
							aria-hidden="true"
						/>
					{:else if vectorizationCtx.status === "paused"}
						<Icons.PauseCircle
							size={16}
							class="text-warning-500"
							aria-hidden="true"
						/>
					{:else}
						<Icons.Circle
							size={16}
							class="text-surface-400"
							aria-hidden="true"
						/>
					{/if}
					<span class="font-medium {statusColor}">{statusLabel}</span>
				</div>
				<div class="flex gap-1">
					{#if vectorizationCtx.status === "running"}
						<button
							class="btn btn-sm preset-tonal-error text-xs"
							onclick={stopQueue}
							disabled={stoppingQueue}
							title="Stop queue"
						>
							{#if stoppingQueue}
								<Icons.Loader
									size={12}
									class="animate-spin"
									aria-hidden="true"
								/>
							{:else}
								<Icons.Square size={12} aria-hidden="true" />
							{/if}
							Stop
						</button>
					{:else}
						<button
							class="btn btn-sm preset-tonal-success text-xs"
							onclick={startQueue}
							disabled={startingQueue}
							title="Start queue"
						>
							{#if startingQueue}
								<Icons.Loader
									size={12}
									class="animate-spin"
									aria-hidden="true"
								/>
							{:else}
								<Icons.Play size={12} aria-hidden="true" />
							{/if}
							Start
						</button>
					{/if}
				</div>
			</div>

			{#if vectorizationCtx.currentItem && vectorizationCtx.status === "running"}
				<div
					class="text-surface-700-300 mt-2 flex items-center gap-1.5 text-xs"
				>
					<Icons.Cpu size={12} class="shrink-0" aria-hidden="true" />
					<span class="truncate">
						{vectorizationCtx.currentItem.label}
					</span>
				</div>
			{/if}

			<div
				class="text-surface-700-300 mt-2 grid grid-cols-1 gap-2 text-xs @lg/view:grid-cols-2"
			>
				<div>
					<span class="text-surface-400">Completed</span>
					<span class="ml-1 font-mono font-medium">
						{vectorizationCtx.completed}
					</span>
				</div>
				<div>
					<span class="text-surface-400">Queued</span>
					<span class="ml-1 font-mono font-medium">
						{vectorizationCtx.priorityQueue.length}
					</span>
				</div>
			</div>
		</div>

		<!-- Queue list -->
		<section>
			<h3
				class="text-surface-400 mb-2 text-xs font-semibold tracking-wider uppercase"
			>
				Queue ({vectorizationCtx.priorityQueue.length})
			</h3>

			{#if vectorizationCtx.priorityQueue.length === 0}
				<div
					class="text-surface-400 flex flex-col items-center gap-2 py-6 text-center text-sm"
				>
					<Icons.Inbox
						size={28}
						class="opacity-40"
						aria-hidden="true"
					/>
					<p class="text-xs">Queue is empty</p>
				</div>
			{:else}
				<ol class="flex flex-col gap-1.5" aria-label="Embedding queue">
					{#each vectorizationCtx.priorityQueue as group, i (group.groupId)}
						{@const summary = groupSummary(group)}
						<li
							class="preset-tonal-surface flex items-start gap-2 rounded-lg p-2.5 text-xs"
						>
							<span
								class="bg-surface-300-700 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
							>
								{i + 1}
							</span>
							<div class="min-w-0 flex-1">
								<p
									class="truncate font-medium"
									title={group.label}
								>
									{group.label}
								</p>
								<p class="text-surface-700-300 truncate">
									{group.ownerDisplayName}
								</p>
								{#if summary}
									<p class="text-surface-400 mt-0.5">
										{summary}
									</p>
								{/if}
							</div>
							<div class="flex shrink-0 flex-col gap-0.5">
								<button
									class="btn-ghost rounded p-0.5 disabled:opacity-30"
									onclick={() =>
										moveGroup(group.groupId, "up")}
									disabled={i === 0}
									title="Move up"
									aria-label="Move {group.label} up"
								>
									<Icons.ChevronUp
										size={14}
										aria-hidden="true"
									/>
								</button>
								<button
									class="btn-ghost rounded p-0.5 disabled:opacity-30"
									onclick={() =>
										moveGroup(group.groupId, "down")}
									disabled={i ===
										vectorizationCtx.priorityQueue.length -
											1}
									title="Move down"
									aria-label="Move {group.label} down"
								>
									<Icons.ChevronDown
										size={14}
										aria-hidden="true"
									/>
								</button>
								<button
									class="btn-ghost text-error-500 rounded p-0.5"
									onclick={() => removeGroup(group.groupId)}
									disabled={removingGroup === group.groupId}
									title="Remove from queue"
									aria-label="Remove {group.label} from queue"
								>
									<Icons.X size={14} aria-hidden="true" />
								</button>
							</div>
						</li>
					{/each}
				</ol>
			{/if}
		</section>

		{#if vectorizationCtx.history.length > 0}
			<section>
				<h3
					class="text-surface-400 mb-2 text-xs font-semibold tracking-wider uppercase"
				>
					Recent ({vectorizationCtx.history.length})
				</h3>
				<ol
					class="flex flex-col gap-1.5"
					aria-label="Completed embeddings"
				>
					{#each vectorizationCtx.history as item (item.groupId)}
						{@const summary = groupSummary(item)}
						<li
							class="preset-tonal-surface flex items-start gap-2 rounded-lg p-2.5 text-xs opacity-70"
						>
							<Icons.CheckCircle
								size={14}
								class="text-success-500 mt-0.5 shrink-0"
								aria-hidden="true"
							/>
							<div class="min-w-0 flex-1">
								<p
									class="truncate font-medium"
									title={item.label}
								>
									{item.label}
								</p>
								<p class="text-surface-700-300 truncate">
									{item.ownerDisplayName}
								</p>
								{#if summary}
									<p class="text-surface-400 mt-0.5">
										{summary}
									</p>
								{/if}
							</div>
							<span
								class="text-surface-400 shrink-0 tabular-nums"
							>
								{timeAgo(item.completedAt)}
							</span>
						</li>
					{/each}
				</ol>
			</section>
		{/if}
	{/if}
</div>
