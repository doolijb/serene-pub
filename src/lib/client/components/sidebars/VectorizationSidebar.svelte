<script lang="ts">
    import * as Icons from "@lucide/svelte"
    import { getContext, onMount } from "svelte"
    import * as skio from "sveltekit-io"
    import { Modal, Tabs } from "@skeletonlabs/skeleton-svelte"
    import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
    import type { ValueChangeDetails } from "@zag-js/tabs"

    interface Props {
        onclose?: () => Promise<boolean> | undefined
    }

    let { onclose = $bindable() }: Props = $props()

    const rawSocket = skio.get()!
    const socket = useTypedSocket()
    let vectorizationCtx: VectorizationCtx = $state(getContext("vectorizationCtx"))

    let activeTab = $state<"queue" | "settings">("queue")

    function handleTabChange(e: ValueChangeDetails) {
        activeTab = e.value as "queue" | "settings"
    }

    // Queue state
    let startingQueue = $state(false)
    let stoppingQueue = $state(false)
    let removingGroup = $state<string | null>(null)

    // Model management state
    type ModelDef = {
        id: string
        name: string
        description: string
        dimensions: number
        sizeLabel: string
        tier: "fast" | "balanced" | "best"
    }
    let availableModels = $state<ModelDef[]>([])
    let activeModelName = $state<string | null>(null)
    let modelReady = $state(false)
    let modelCached = $state(false)
    let modelLoadError = $state<string | null>(null)
    let isChangingModel = $state(false)
    let showChangeModelModal = $state(false)
    let selectedModelForChange = $state<string>("")
    let downloadProgress = $state<{
        status: "loading" | "downloading" | "ready" | "error"
        percent?: number
    } | null>(null)

    onMount(() => {
        onclose = async () => true
        rawSocket.emit("vectorization:getQueue", {}, (res: Sockets.Vectorization.GetQueue.Response) => {
            vectorizationCtx.priorityQueue = res.queue
            vectorizationCtx.history = res.history ?? []
        })
        socket?.emit("vectorization:listModels", {})
    })

    $effect(() => {
        if (!socket) return

        const handleListModels = (message: any) => {
            availableModels = message.models ?? []
            activeModelName = message.activeModelName ?? null
            modelReady = message.modelReady ?? false
            modelCached = message.modelCached ?? false
            modelLoadError = message.loadError ?? null
        }
        const handleSetModel = (message: any) => {
            isChangingModel = false
            downloadProgress = null
            if (message.success) {
                activeModelName = message.modelName
                showChangeModelModal = false
                socket?.emit("vectorization:listModels", {})
            }
        }
        const handleModelDownloadProgress = (message: any) => {
            downloadProgress = { status: message.status, percent: message.percent }
            if (message.status === "ready") {
                modelReady = true
                downloadProgress = null
                socket?.emit("vectorization:listModels", {})
            }
            if (message.status === "error") {
                isChangingModel = false
            }
        }
        const handleSetModelError = (_message: any) => {
            isChangingModel = false
            downloadProgress = null
        }

        socket.on("vectorization:listModels", handleListModels)
        socket.on("vectorization:setModel", handleSetModel)
        socket.on("vectorization:modelDownloadProgress", handleModelDownloadProgress)
        socket.on("vectorization:setModel:error", handleSetModelError)

        return () => {
            socket.off("vectorization:listModels", handleListModels)
            socket.off("vectorization:setModel", handleSetModel)
            socket.off("vectorization:modelDownloadProgress", handleModelDownloadProgress)
            socket.off("vectorization:setModel:error", handleSetModelError)
        }
    })

    function startQueue() {
        startingQueue = true
        rawSocket.emit("vectorization:startQueue", {}, () => { startingQueue = false })
    }

    function stopQueue() {
        stoppingQueue = true
        rawSocket.emit("vectorization:stopQueue", {}, () => { stoppingQueue = false })
    }

    function removeGroup(groupId: string) {
        removingGroup = groupId
        rawSocket.emit(
            "vectorization:removeFromQueue",
            { groupId },
            (res: Sockets.Vectorization.RemoveFromQueue.Response) => {
                vectorizationCtx.priorityQueue = res.queue
                removingGroup = null
            }
        )
    }

    function moveGroup(groupId: string, direction: "up" | "down") {
        rawSocket.emit(
            "vectorization:moveQueueGroup",
            { groupId, direction },
            (res: Sockets.Vectorization.MoveQueueGroup.Response) => {
                vectorizationCtx.priorityQueue = res.queue
            }
        )
    }

    function openChangeModelModal() {
        selectedModelForChange = activeModelName ?? availableModels[0]?.id ?? ""
        showChangeModelModal = true
    }

    function cancelChangeModel() {
        showChangeModelModal = false
        downloadProgress = null
    }

    function confirmChangeModel() {
        if (!selectedModelForChange) return
        isChangingModel = true
        downloadProgress = null
        socket?.emit("vectorization:setModel", { modelName: selectedModelForChange })
    }

    function reloadModel() {
        if (!activeModelName) return
        isChangingModel = true
        socket?.emit("vectorization:setModel", { modelName: activeModelName })
    }

    const statusColor = $derived(
        vectorizationCtx.status === "running" ? "text-success-500"
        : vectorizationCtx.status === "paused" ? "text-warning-500"
        : "text-surface-400"
    )

    const statusLabel = $derived(
        vectorizationCtx.status === "running" ? "Running"
        : vectorizationCtx.status === "paused" ? "Paused"
        : "Idle"
    )

    const activeModelDef = $derived(availableModels.find((m) => m.id === activeModelName))

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
            parts.push(`${group.characterIds.length} char${group.characterIds.length !== 1 ? "s" : ""}`)
        if (group.personaIds.length > 0)
            parts.push(`${group.personaIds.length} persona${group.personaIds.length !== 1 ? "s" : ""}`)
        if (group.lorebookIds.length > 0)
            parts.push(`${group.lorebookIds.length} lorebook${group.lorebookIds.length !== 1 ? "s" : ""}`)
        return parts.join(" · ")
    }
</script>

<div class="flex h-full flex-col overflow-hidden">
    <Tabs value={activeTab} onValueChange={handleTabChange}>
        {#snippet list()}
            <Tabs.Control value="queue">
                <Icons.List size={20} class="inline" />
                {#if activeTab === "queue"}Queue{/if}
            </Tabs.Control>
            <Tabs.Control value="settings">
                <Icons.Settings size={20} class="inline" />
                {#if activeTab === "settings"}Settings{/if}
            </Tabs.Control>
        {/snippet}
        {#snippet content()}

            <!-- Queue Tab -->
            <Tabs.Panel value="queue">
            <div class="flex flex-col gap-4 overflow-y-auto p-4">

                <!-- Status card -->
                <div class="preset-tonal-surface rounded-lg p-3">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            {#if vectorizationCtx.status === "running"}
                                <Icons.Loader size={16} class="text-success-500 animate-spin" aria-hidden="true" />
                            {:else if vectorizationCtx.status === "paused"}
                                <Icons.PauseCircle size={16} class="text-warning-500" aria-hidden="true" />
                            {:else}
                                <Icons.Circle size={16} class="text-surface-400" aria-hidden="true" />
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
                                        <Icons.Loader size={12} class="animate-spin" aria-hidden="true" />
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
                                        <Icons.Loader size={12} class="animate-spin" aria-hidden="true" />
                                    {:else}
                                        <Icons.Play size={12} aria-hidden="true" />
                                    {/if}
                                    Start
                                </button>
                            {/if}
                        </div>
                    </div>

                    {#if vectorizationCtx.currentItem && vectorizationCtx.status === "running"}
                        <div class="text-surface-500 mt-2 flex items-center gap-1.5 text-xs">
                            <Icons.Cpu size={12} class="shrink-0" aria-hidden="true" />
                            <span class="truncate">{vectorizationCtx.currentItem.label}</span>
                        </div>
                    {/if}

                    <div class="text-surface-500 mt-2 grid grid-cols-2 gap-2 text-xs">
                        <div>
                            <span class="text-surface-400">Completed</span>
                            <span class="ml-1 font-mono font-medium">{vectorizationCtx.completed}</span>
                        </div>
                        <div>
                            <span class="text-surface-400">Queued</span>
                            <span class="ml-1 font-mono font-medium">{vectorizationCtx.priorityQueue.length}</span>
                        </div>
                    </div>
                </div>

                <!-- Queue list -->
                <section>
                    <h3 class="text-surface-400 mb-2 text-xs font-semibold uppercase tracking-wider">
                        Queue ({vectorizationCtx.priorityQueue.length})
                    </h3>

                    {#if vectorizationCtx.priorityQueue.length === 0}
                        <div class="text-surface-400 flex flex-col items-center gap-2 py-6 text-center text-sm">
                            <Icons.Inbox size={28} class="opacity-40" aria-hidden="true" />
                            <p class="text-xs">Queue is empty</p>
                        </div>
                    {:else}
                        <ol class="flex flex-col gap-1.5" aria-label="Embedding queue">
                            {#each vectorizationCtx.priorityQueue as group, i (group.groupId)}
                                {@const summary = groupSummary(group)}
                                <li class="preset-tonal-surface flex items-start gap-2 rounded-lg p-2.5 text-xs">
                                    <span
                                        class="bg-surface-300-700 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                                    >{i + 1}</span>

                                    <div class="min-w-0 flex-1">
                                        <p class="truncate font-medium" title={group.label}>{group.label}</p>
                                        <p class="text-surface-500 truncate">{group.ownerDisplayName}</p>
                                        {#if summary}
                                            <p class="text-surface-400 mt-0.5">{summary}</p>
                                        {/if}
                                    </div>

                                    <div class="flex shrink-0 flex-col gap-0.5">
                                        <button
                                            class="btn-ghost rounded p-0.5 disabled:opacity-30"
                                            onclick={() => moveGroup(group.groupId, "up")}
                                            disabled={i === 0}
                                            title="Move up"
                                            aria-label="Move {group.label} up"
                                        >
                                            <Icons.ChevronUp size={14} aria-hidden="true" />
                                        </button>
                                        <button
                                            class="btn-ghost rounded p-0.5 disabled:opacity-30"
                                            onclick={() => moveGroup(group.groupId, "down")}
                                            disabled={i === vectorizationCtx.priorityQueue.length - 1}
                                            title="Move down"
                                            aria-label="Move {group.label} down"
                                        >
                                            <Icons.ChevronDown size={14} aria-hidden="true" />
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

                <!-- History -->
                {#if vectorizationCtx.history.length > 0}
                    <section>
                        <h3 class="text-surface-400 mb-2 text-xs font-semibold uppercase tracking-wider">
                            Recent ({vectorizationCtx.history.length})
                        </h3>
                        <ol class="flex flex-col gap-1.5" aria-label="Completed embeddings">
                            {#each vectorizationCtx.history as item (item.groupId)}
                                {@const summary = groupSummary(item)}
                                <li class="preset-tonal-surface flex items-start gap-2 rounded-lg p-2.5 text-xs opacity-70">
                                    <Icons.CheckCircle size={14} class="text-success-500 mt-0.5 shrink-0" aria-hidden="true" />
                                    <div class="min-w-0 flex-1">
                                        <p class="truncate font-medium" title={item.label}>{item.label}</p>
                                        <p class="text-surface-500 truncate">{item.ownerDisplayName}</p>
                                        {#if summary}
                                            <p class="text-surface-400 mt-0.5">{summary}</p>
                                        {/if}
                                    </div>
                                    <span class="text-surface-400 shrink-0 tabular-nums">{timeAgo(item.completedAt)}</span>
                                </li>
                            {/each}
                        </ol>
                    </section>
                {/if}

            </div>
            </Tabs.Panel>

            <!-- Settings Tab -->
            <Tabs.Panel value="settings">
            <div class="flex flex-col gap-4 overflow-y-auto p-4">

                <!-- Model not in memory warning -->
                {#if !modelReady}
                    <div class="border-warning-500/30 bg-warning-500/10 flex items-start gap-3 rounded-lg border p-3">
                        <Icons.AlertTriangle size={16} class="text-warning-500 mt-0.5 shrink-0" aria-hidden="true" />
                        <div class="min-w-0 flex-1 space-y-2">
                            {#if !modelCached}
                                <p class="text-sm font-medium">Model files missing</p>
                                <p class="text-surface-500 text-xs">The embedding model is not in the local cache. Re-download it to resume vectorization.</p>
                            {:else if modelLoadError}
                                <p class="text-sm font-medium">Model failed to load</p>
                                <p class="text-surface-500 text-xs">{modelLoadError}</p>
                            {:else}
                                <p class="text-sm font-medium">Model not loaded</p>
                                <p class="text-surface-500 text-xs">The server restarted and the model needs to be reloaded before vectorization can run.</p>
                            {/if}
                            <button
                                class="btn btn-sm preset-tonal-warning text-xs"
                                onclick={reloadModel}
                                disabled={!activeModelName || isChangingModel}
                            >
                                {#if isChangingModel && !showChangeModelModal}
                                    <Icons.Loader size={12} class="animate-spin" aria-hidden="true" />
                                    Loading…
                                {:else}
                                    <Icons.Download size={12} aria-hidden="true" />
                                    {modelCached ? "Reload Model" : "Re-download Model"}
                                {/if}
                            </button>
                        </div>
                    </div>
                {/if}

                <!-- Current model card -->
                <div class="bg-surface-200-800 rounded-lg p-3 space-y-1">
                    <div class="flex items-center gap-2 mb-2">
                        <Icons.Cpu size={16} class={modelReady ? 'text-primary-500' : 'text-surface-400'} aria-hidden="true" />
                        <span class="text-xs font-semibold uppercase tracking-wider text-surface-400">Embedding Model</span>
                    </div>
                    <p class="text-sm font-medium">
                        {activeModelDef?.name ?? activeModelName ?? "Unknown model"}
                    </p>
                    {#if activeModelDef}
                        <div class="flex flex-wrap items-center gap-1.5 text-xs text-surface-500">
                            {#if activeModelDef.tier === "fast"}
                                <span class="rounded-full bg-sky-500/15 px-1.5 py-0.5 text-xs font-medium text-sky-600">Fast</span>
                            {:else if activeModelDef.tier === "balanced"}
                                <span class="rounded-full bg-violet-500/15 px-1.5 py-0.5 text-xs font-medium text-violet-600">Balanced</span>
                            {:else}
                                <span class="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-600">Best</span>
                            {/if}
                            <span>{activeModelDef.dimensions}d · {activeModelDef.sizeLabel}</span>
                        </div>
                        <p class="text-xs text-surface-500 mt-1">{activeModelDef.description}</p>
                    {/if}
                    {#if !modelReady}
                        <span class="inline-block mt-1 rounded-full bg-warning-500/20 px-2 py-0.5 text-xs font-medium text-warning-600">Not loaded</span>
                    {:else}
                        <span class="inline-block mt-1 rounded-full bg-success-500/20 px-2 py-0.5 text-xs font-medium text-success-600">Loaded</span>
                    {/if}
                </div>

                <!-- Download progress -->
                {#if downloadProgress}
                    <div class="space-y-1">
                        <div class="flex items-center justify-between text-xs">
                            <span class="text-surface-500 capitalize">{downloadProgress.status}…</span>
                            {#if downloadProgress.percent !== undefined}
                                <span class="font-mono">{downloadProgress.percent}%</span>
                            {/if}
                        </div>
                        {#if downloadProgress.percent !== undefined}
                            <div class="bg-surface-300-700 h-1.5 w-full overflow-hidden rounded-full">
                                <div class="bg-primary-500 h-full transition-all duration-300" style="width: {downloadProgress.percent}%"></div>
                            </div>
                        {:else}
                            <div class="bg-surface-300-700 h-1.5 w-full overflow-hidden rounded-full">
                                <div class="bg-primary-500 h-full w-1/3 animate-pulse rounded-full"></div>
                            </div>
                        {/if}
                    </div>
                {/if}

                <!-- Change model button -->
                <button
                    class="btn btn-sm preset-tonal-surface w-full text-xs"
                    onclick={openChangeModelModal}
                    disabled={isChangingModel}
                >
                    <Icons.RefreshCw size={12} aria-hidden="true" />
                    Change Model
                </button>

            </div>
            </Tabs.Panel>

        {/snippet}
    </Tabs>
</div>

<!-- Change Model Modal -->
<Modal
    open={showChangeModelModal}
    onOpenChange={(e) => { if (!e.open) cancelChangeModel() }}
    contentBase="card bg-surface-100-900 p-6 space-y-5 shadow-xl max-w-lg w-full"
    backdropClasses="backdrop-blur-sm"
>
    {#snippet content()}
        <header class="flex items-center gap-3">
            <Icons.RefreshCw class="text-primary-500 h-5 w-5 shrink-0" />
            <h2 class="text-lg font-bold">Change Embedding Model</h2>
        </header>

        <div class="text-warning-500 flex items-start gap-2 text-sm">
            <Icons.AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
            <p>Changing the model will stop the current vectorization queue. All existing embeddings will need to be regenerated with the new model.</p>
        </div>

        <div class="space-y-2">
            {#each availableModels as model}
                <label
                    class="flex cursor-pointer items-start gap-3 rounded-lg border-2 p-3 transition-all
                        {selectedModelForChange === model.id
                        ? 'border-primary-500 bg-primary-500/5'
                        : 'border-surface-300-600 hover:border-surface-400-500'}"
                >
                    <input
                        type="radio"
                        name="change-model"
                        value={model.id}
                        bind:group={selectedModelForChange}
                        class="mt-0.5"
                    />
                    <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="font-medium">{model.name}</span>
                            {#if model.tier === "fast"}
                                <span class="rounded-full bg-sky-500/15 px-1.5 py-0.5 text-xs font-medium text-sky-600">Fast</span>
                            {:else if model.tier === "balanced"}
                                <span class="rounded-full bg-violet-500/15 px-1.5 py-0.5 text-xs font-medium text-violet-600">Balanced</span>
                            {:else}
                                <span class="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-600">Best</span>
                            {/if}
                            {#if model.id === activeModelName}
                                <span class="bg-primary-500/20 text-primary-600 rounded-full px-1.5 py-0.5 text-xs">current</span>
                            {/if}
                            <span class="text-surface-500 text-xs">{model.sizeLabel} · {model.dimensions}d</span>
                        </div>
                        <p class="text-surface-500 mt-0.5 text-xs">{model.description}</p>
                    </div>
                </label>
            {/each}
        </div>

        {#if downloadProgress}
            <div class="space-y-1">
                <div class="flex items-center justify-between text-xs">
                    <span class="text-surface-500 capitalize">{downloadProgress.status}…</span>
                    {#if downloadProgress.percent !== undefined}
                        <span class="font-mono">{downloadProgress.percent}%</span>
                    {/if}
                </div>
                {#if downloadProgress.percent !== undefined}
                    <div class="bg-surface-300-600 h-1.5 w-full overflow-hidden rounded-full">
                        <div class="bg-primary-500 h-full transition-all duration-300" style="width: {downloadProgress.percent}%"></div>
                    </div>
                {:else}
                    <div class="bg-surface-300-600 h-1.5 w-full overflow-hidden rounded-full">
                        <div class="bg-primary-500 h-full w-1/3 animate-pulse rounded-full"></div>
                    </div>
                {/if}
            </div>
        {/if}

        <footer class="flex justify-end gap-2">
            <button class="btn preset-tonal-surface" onclick={cancelChangeModel} disabled={isChangingModel}>Cancel</button>
            <button
                class="btn preset-filled-primary-500"
                onclick={confirmChangeModel}
                disabled={!selectedModelForChange || selectedModelForChange === activeModelName || isChangingModel}
            >
                {#if isChangingModel}
                    <Icons.Loader class="h-4 w-4 animate-spin" />
                    Loading…
                {:else}
                    <Icons.RefreshCw class="h-4 w-4" />
                    Switch Model
                {/if}
            </button>
        </footer>
    {/snippet}
</Modal>
