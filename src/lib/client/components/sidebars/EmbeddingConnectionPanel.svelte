<script lang="ts">
    import * as Icons from "@lucide/svelte"
    import { getContext, onMount } from "svelte"
    import { Dialog, Portal, Tabs } from "@skeletonlabs/skeleton-svelte"
    import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
    import type { ValueChangeDetails } from "@zag-js/tabs"
    import VectorizationSetupScreen from "$lib/client/components/vectorization/VectorizationSetupScreen.svelte"

    const socket = useTypedSocket()
    let vectorizationCtx: VectorizationCtx = $state(getContext("vectorizationCtx"))
    let systemSettingsCtx: SystemSettingsCtx = $state(getContext("systemSettingsCtx"))
    let isAndroidWrapper = $derived(systemSettingsCtx.settings?.isAndroidWrapper ?? false)

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
    let showDisableConfirmModal = $state(false)
    let selectedModelForChange = $state<string>("")
    let downloadProgress = $state<{
        status: "loading" | "downloading" | "ready" | "error"
        percent?: number
    } | null>(null)

    // "mode" is whichever backend the server actually has active.
    // "settingsView" is which Settings-tab screen is shown — a state machine
    // (chooser → setup-local/setup-api → configured) mirroring
    // KoboldCppSidebar's isUnconfigured/setup-screen/main-view flow, since
    // vectorization has no nullable "unconfigured" sentinel column: the
    // existing vectorizationEnabled flag already means "setup completed for
    // whichever mode," so !vectorizationEnabled is the chooser state.
    type SettingsView = "chooser" | "setup-local" | "setup-api" | "configured"
    let mode = $state<"local" | "api">("local")
    let vectorizationEnabled = $state(false)
    let settingsView = $state<SettingsView>("chooser")
    // Where a setup screen's "Back" link returns to — the raw chooser for a
    // true first-time setup, or straight back to the configured summary when
    // this setup screen was reached via "Switch to X" on an already-working setup.
    let backTarget: SettingsView = $derived(vectorizationEnabled ? "configured" : "chooser")
    let apiBaseUrl = $state("")
    let apiKey = $state("")
    let apiModelInput = $state("")
    let apiDimensions = $state<number | null>(null)
    let testingApi = $state(false)
    let apiTestError = $state<string | null>(null)
    let disabling = $state(false)

    onMount(() => {
        socket?.emit("vectorization:getQueue", {})
        socket?.emit("vectorization:listModels", {})
    })

    // Reactive (not a plain flag) so the template can gate on it — avoids a
    // flash of the "chooser" screen for already-configured users while the
    // real state is still loading (this panel has no pre-loaded shared
    // context to read, unlike KoboldCppSidebar's koboldCppSettingsCtx).
    let settingsViewInitialized = $state(false)

    $effect(() => {
        if (!socket) return

        const handleListModels = (message: any) => {
            availableModels = message.models ?? []
            activeModelName = message.activeModelName ?? null
            modelReady = message.modelReady ?? false
            modelCached = message.modelCached ?? false
            modelLoadError = message.loadError ?? null
            mode = message.mode ?? "local"
            vectorizationEnabled = message.vectorizationEnabled ?? false
            apiBaseUrl = message.apiBaseUrl ?? ""
            apiKey = message.apiKey ?? ""
            apiModelInput = message.apiModel ?? ""
            apiDimensions = message.apiDimensions ?? null
            // Only set the initial screen once — afterward, leave navigation
            // alone so an in-progress setup/switch flow doesn't get yanked
            // back to "configured" by an unrelated listModels refresh.
            if (!settingsViewInitialized) {
                settingsView = vectorizationEnabled ? "configured" : "chooser"
                settingsViewInitialized = true
            }
        }
        const handleSetModel = (message: any) => {
            isChangingModel = false
            downloadProgress = null
            if (message.success) {
                activeModelName = message.modelName
                showChangeModelModal = false
                settingsView = "configured"
                socket?.emit("vectorization:listModels", {})
            }
        }
        const handleModelDownloadProgress = (message: any) => {
            downloadProgress = { status: message.status, percent: message.percent }
            if (message.status === "ready") {
                modelReady = true
                downloadProgress = null
                isChangingModel = false
                // Fires for both the first-time "enable local" setup flow and
                // the already-configured "change model"/"reload" flows — in
                // all three cases, a successful load means the local model is
                // now the working, configured backend.
                settingsView = "configured"
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
        const handleEnableError = (_message: any) => {
            isChangingModel = false
            downloadProgress = null
        }
        const handleDisable = (message: any) => {
            disabling = false
            if (message?.success) {
                vectorizationEnabled = false
                settingsView = "chooser"
            }
        }
        const handleSetApiConfig = (message: Sockets.Vectorization.SetApiConfig.Response) => {
            testingApi = false
            if (message.success) {
                mode = "api"
                vectorizationEnabled = true
                activeModelName = message.modelName ?? null
                apiDimensions = message.dimensions ?? null
                settingsView = "configured"
                socket?.emit("vectorization:listModels", {})
            } else {
                apiTestError = message.error ?? "Failed to validate the embeddings API"
            }
        }
        const handleStartQueue = () => { startingQueue = false }
        const handleStopQueue = () => { stoppingQueue = false }
        const handleGetQueue = (message: Sockets.Vectorization.GetQueue.Response) => {
            vectorizationCtx.priorityQueue = message.queue
            vectorizationCtx.history = message.history ?? []
        }
        const handleRemoveFromQueue = (message: Sockets.Vectorization.RemoveFromQueue.Response) => {
            vectorizationCtx.priorityQueue = message.queue
            removingGroup = null
        }
        const handleMoveQueueGroup = (message: Sockets.Vectorization.MoveQueueGroup.Response) => {
            vectorizationCtx.priorityQueue = message.queue
        }
        const handleVectorizationConfigUpdate = () => { savingTtl = false }

        socket.on("vectorization:listModels", handleListModels)
        socket.on("vectorization:setModel", handleSetModel)
        socket.on("vectorization:modelDownloadProgress", handleModelDownloadProgress)
        socket.on("vectorization:setModel:error", handleSetModelError)
        socket.on("vectorization:enable:error", handleEnableError)
        socket.on("vectorization:disable", handleDisable)
        socket.on("vectorization:setApiConfig", handleSetApiConfig)
        socket.on("vectorization:startQueue", handleStartQueue)
        socket.on("vectorization:stopQueue", handleStopQueue)
        socket.on("vectorization:getQueue", handleGetQueue)
        socket.on("vectorization:removeFromQueue", handleRemoveFromQueue)
        socket.on("vectorization:moveQueueGroup", handleMoveQueueGroup)
        socket.on("vectorizationConfig:update", handleVectorizationConfigUpdate)

        return () => {
            socket.off("vectorization:listModels", handleListModels)
            socket.off("vectorization:setModel", handleSetModel)
            socket.off("vectorization:modelDownloadProgress", handleModelDownloadProgress)
            socket.off("vectorization:setModel:error", handleSetModelError)
            socket.off("vectorization:enable:error", handleEnableError)
            socket.off("vectorization:disable", handleDisable)
            socket.off("vectorization:setApiConfig", handleSetApiConfig)
            socket.off("vectorization:startQueue", handleStartQueue)
            socket.off("vectorization:stopQueue", handleStopQueue)
            socket.off("vectorization:getQueue", handleGetQueue)
            socket.off("vectorization:removeFromQueue", handleRemoveFromQueue)
            socket.off("vectorization:moveQueueGroup", handleMoveQueueGroup)
            socket.off("vectorizationConfig:update", handleVectorizationConfigUpdate)
        }
    })

    function startQueue() {
        startingQueue = true
        socket?.emit("vectorization:startQueue", {})
    }

    function stopQueue() {
        stoppingQueue = true
        socket?.emit("vectorization:stopQueue", {})
    }

    function removeGroup(groupId: string) {
        removingGroup = groupId
        socket?.emit("vectorization:removeFromQueue", { groupId })
    }

    function moveGroup(groupId: string, direction: "up" | "down") {
        socket?.emit("vectorization:moveQueueGroup", { groupId, direction })
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

    // Chooser → setup screens. Defaulting the tier selection here (rather
    // than leaving it to whatever the modal happens to have last set) covers
    // the true first-time case, where there's no activeModelName yet.
    function goToLocalSetup() {
        selectedModelForChange =
            mode === "local" && activeModelName ? activeModelName : (availableModels[0]?.id ?? "")
        settingsView = "setup-local"
    }
    function goToApiSetup() {
        settingsView = "setup-api"
    }

    function enableLocalModel() {
        if (!selectedModelForChange) return
        isChangingModel = true
        downloadProgress = null
        // On success, the model-download-progress "ready" event (already
        // streaming throughout the load) is what flips settingsView to
        // "configured" and clears isChangingModel. On failure, the
        // vectorization:enable:error listener above handles it.
        socket?.emit("vectorization:enable", { modelName: selectedModelForChange, startNow: true })
    }

    function saveApiConfig() {
        apiTestError = null
        testingApi = true
        socket?.emit("vectorization:setApiConfig", {
            baseUrl: apiBaseUrl.trim(),
            apiKey: apiKey.trim() || null,
            model: apiModelInput.trim(),
            startNow: true
        })
    }

    function disableVectorization() {
        disabling = true
        socket?.emit("vectorization:disable", {})
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

    // TTL config
    let ttlMinutes = $state(5)
    let ttlInput = $state("5")
    let savingTtl = $state(false)

    $effect(() => {
        if (!socket) return
        const handleVecConfig = (res: Sockets.VectorizationConfig.Get.Response) => {
            ttlMinutes = res.config.embeddingModelTtlMinutes
            ttlInput = String(ttlMinutes)
        }
        socket.on("vectorizationConfig:get", handleVecConfig)
        socket.emit("vectorizationConfig:get", {})
        return () => socket.off("vectorizationConfig:get", handleVecConfig)
    })

    function saveTtl() {
        const val = parseInt(ttlInput, 10)
        if (isNaN(val) || val < 0) return
        savingTtl = true
        socket?.emit("vectorizationConfig:update", { embeddingModelTtlMinutes: val })
    }

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
    {#if !settingsViewInitialized}
        <div class="flex flex-1 flex-col items-center justify-center gap-2 p-4">
            <Icons.Loader2 size={24} class="animate-spin opacity-50" aria-hidden="true" />
            <p class="text-sm opacity-50">Loading…</p>
        </div>
    {:else if settingsView !== "configured"}
        <!-- Not yet configured: the setup flow is the whole panel, no tabs —
             mirrors KoboldCppSidebar's isUnconfigured/setup-screen pattern,
             so opening this panel always lands on setup first until done. -->
        <div class="flex flex-col gap-4 overflow-y-auto p-4">

            {#if settingsView === "chooser"}
                <!-- First-time setup: choose backend -->
                <VectorizationSetupScreen
                    {isAndroidWrapper}
                    onChooseLocal={goToLocalSetup}
                    onChooseApi={goToApiSetup}
                />

            {:else if settingsView === "setup-local"}
                <!-- Local: pick a model tier -->
                <div class="flex items-center justify-between">
                    <span class="text-sm font-semibold">Choose a Local Model</span>
                    <button
                        class="btn btn-sm preset-filled-surface-400-600 text-xs"
                        onclick={() => (settingsView = backTarget)}
                    >
                        <Icons.ArrowLeft size={12} aria-hidden="true" />
                        Back
                    </button>
                </div>

                {#if availableModels.length === 0}
                    <div class="text-center opacity-50 text-sm py-4">Loading available models…</div>
                {:else}
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
                                    name="setup-local-model"
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
                                        <span class="text-surface-700-300 text-xs">{model.sizeLabel} · {model.dimensions}d</span>
                                    </div>
                                    <p class="text-surface-700-300 mt-0.5 text-xs">{model.description}</p>
                                </div>
                            </label>
                        {/each}
                    </div>
                {/if}

                {#if downloadProgress}
                    <div class="space-y-1">
                        <div class="flex items-center justify-between text-xs">
                            <span class="text-surface-700-300 capitalize">{downloadProgress.status}…</span>
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

                <button
                    class="btn preset-filled-primary-500 w-full"
                    onclick={enableLocalModel}
                    disabled={!selectedModelForChange || isChangingModel}
                >
                    {#if isChangingModel}
                        <Icons.Loader size={16} class="animate-spin" aria-hidden="true" />
                        Setting up…
                    {:else}
                        <Icons.Cpu size={16} aria-hidden="true" />
                        Save & Enable
                    {/if}
                </button>

            {:else if settingsView === "setup-api"}
                <!-- External API config -->
                <div class="flex items-center justify-between">
                    <span class="text-sm font-semibold">External API Setup</span>
                    <button
                        class="btn btn-sm preset-filled-surface-400-600 text-xs"
                        onclick={() => (settingsView = backTarget)}
                    >
                        <Icons.ArrowLeft size={12} aria-hidden="true" />
                        Back
                    </button>
                </div>
                <p class="text-xs text-surface-700-300">
                    Any OpenAI-compatible /embeddings endpoint — OpenAI itself, Ollama, LM Studio, llama.cpp server, etc.
                </p>

                <label class="block">
                    <span class="text-xs text-surface-700-300">Base URL</span>
                    <input
                        type="text"
                        class="input text-sm w-full"
                        placeholder="https://api.openai.com/v1"
                        bind:value={apiBaseUrl}
                    />
                </label>
                <label class="block">
                    <span class="text-xs text-surface-700-300">API Key</span>
                    <input
                        type="password"
                        class="input text-sm w-full"
                        placeholder="(optional, depending on provider)"
                        bind:value={apiKey}
                    />
                </label>
                <label class="block">
                    <span class="text-xs text-surface-700-300">Model</span>
                    <input
                        type="text"
                        class="input text-sm w-full"
                        placeholder="text-embedding-3-small"
                        bind:value={apiModelInput}
                    />
                </label>

                {#if apiTestError}
                    <p class="text-error-500 text-xs">{apiTestError}</p>
                {/if}

                <button
                    class="btn preset-filled-primary-500 w-full"
                    onclick={saveApiConfig}
                    disabled={testingApi || !apiBaseUrl.trim() || !apiModelInput.trim()}
                >
                    {#if testingApi}
                        <Icons.Loader size={16} class="animate-spin" aria-hidden="true" />
                        Testing…
                    {:else}
                        <Icons.Check size={16} aria-hidden="true" />
                        Test & Save
                    {/if}
                </button>
            {/if}

        </div>
    {:else}
    <Tabs value={activeTab} onValueChange={handleTabChange}>
        <Tabs.List class="flex flex-wrap gap-1">
            <Tabs.Trigger value="queue">
                <span title="Queue" aria-label="Queue tab" class="flex items-center gap-1">
                    <Icons.List size={20} class="inline" />
                    {#if activeTab === "queue"}Queue{/if}
                </span>
            </Tabs.Trigger>
            <Tabs.Trigger value="settings">
                <span title="Settings" aria-label="Settings tab" class="flex items-center gap-1">
                    <Icons.Settings size={20} class="inline" />
                    {#if activeTab === "settings"}Settings{/if}
                </span>
            </Tabs.Trigger>
        </Tabs.List>

            <!-- Queue Tab -->
            <Tabs.Content value="queue">
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
                        <div class="text-surface-700-300 mt-2 flex items-center gap-1.5 text-xs">
                            <Icons.Cpu size={12} class="shrink-0" aria-hidden="true" />
                            <span class="truncate">{vectorizationCtx.currentItem.label}</span>
                        </div>
                    {/if}

                    <div class="text-surface-700-300 mt-2 grid grid-cols-2 gap-2 text-xs">
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
                                        <p class="text-surface-700-300 truncate">{group.ownerDisplayName}</p>
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
                                        <p class="text-surface-700-300 truncate">{item.ownerDisplayName}</p>
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
            </Tabs.Content>

            <!-- Settings Tab -->
            <Tabs.Content value="settings">
            <div class="flex flex-col gap-4 overflow-y-auto p-4">

                <!-- Configured: summary + reconfigure/disable -->
                {#if !modelReady}
                        <div class="border-warning-500/30 bg-warning-500/10 flex items-start gap-3 rounded-lg border p-3">
                            <Icons.AlertTriangle size={16} class="text-warning-500 mt-0.5 shrink-0" aria-hidden="true" />
                            <div class="min-w-0 flex-1 space-y-2">
                                {#if mode === "api"}
                                    <p class="text-sm font-medium">External API not working</p>
                                    <p class="text-surface-700-300 text-xs">
                                        {modelLoadError ?? "RAG retrieval is skipped (falls back to keyword search) until the embeddings API is reachable again."}
                                    </p>
                                {:else if !modelCached}
                                    <p class="text-sm font-medium">Model files missing</p>
                                    <p class="text-surface-700-300 text-xs">The embedding model is not in the local cache. Re-download it to resume embeddings.</p>
                                {:else if modelLoadError}
                                    <p class="text-sm font-medium">Model failed to load</p>
                                    <p class="text-surface-700-300 text-xs">{modelLoadError}</p>
                                {:else}
                                    <p class="text-sm font-medium">Model not loaded</p>
                                    <p class="text-surface-700-300 text-xs">The server restarted and the model needs to be reloaded before embeddings can run.</p>
                                {/if}
                                {#if mode === "local"}
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
                                {/if}
                            </div>
                        </div>
                    {/if}

                    {#if mode === "local"}
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
                                <div class="flex flex-wrap items-center gap-1.5 text-xs text-surface-700-300">
                                    {#if activeModelDef.tier === "fast"}
                                        <span class="rounded-full bg-sky-500/15 px-1.5 py-0.5 text-xs font-medium text-sky-600">Fast</span>
                                    {:else if activeModelDef.tier === "balanced"}
                                        <span class="rounded-full bg-violet-500/15 px-1.5 py-0.5 text-xs font-medium text-violet-600">Balanced</span>
                                    {:else}
                                        <span class="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-600">Best</span>
                                    {/if}
                                    <span>{activeModelDef.dimensions}d · {activeModelDef.sizeLabel}</span>
                                </div>
                                <p class="text-xs text-surface-700-300 mt-1">{activeModelDef.description}</p>
                            {/if}
                            {#if !modelReady}
                                <span class="inline-block mt-1 rounded-full bg-warning-500/20 px-2 py-0.5 text-xs font-medium text-warning-600">Not loaded</span>
                            {:else}
                                <span class="inline-block mt-1 rounded-full bg-success-500/20 px-2 py-0.5 text-xs font-medium text-success-600">Loaded</span>
                            {/if}
                        </div>

                        {#if downloadProgress}
                            <div class="space-y-1">
                                <div class="flex items-center justify-between text-xs">
                                    <span class="text-surface-700-300 capitalize">{downloadProgress.status}…</span>
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

                        <!-- Model idle TTL — no-op in API mode, only meaningful here -->
                        <div class="bg-surface-200-800 rounded-lg p-3 space-y-2">
                            <div class="flex items-center gap-2">
                                <Icons.Timer size={16} class="text-surface-400" aria-hidden="true" />
                                <span class="text-xs font-semibold uppercase tracking-wider text-surface-400">Model Idle TTL</span>
                            </div>
                            <p class="text-xs text-surface-700-300">Unload the embedding model after this many minutes of inactivity. Set to 0 to keep it loaded indefinitely.</p>
                            <div class="flex items-center gap-2">
                                <input
                                    type="number"
                                    min="0"
                                    step="1"
                                    class="input text-sm w-24"
                                    bind:value={ttlInput}
                                />
                                <span class="text-xs text-surface-700-300">minutes</span>
                                <button
                                    class="btn btn-sm preset-tonal-primary text-xs ml-auto"
                                    onclick={saveTtl}
                                    disabled={savingTtl}
                                >
                                    {#if savingTtl}
                                        <Icons.Loader size={12} class="animate-spin" aria-hidden="true" />
                                    {:else}
                                        <Icons.Save size={12} aria-hidden="true" />
                                    {/if}
                                    Save
                                </button>
                            </div>
                        </div>

                        <button
                            class="btn btn-sm preset-filled-surface-400-600 w-full text-xs"
                            onclick={openChangeModelModal}
                            disabled={isChangingModel}
                        >
                            <Icons.RefreshCw size={12} aria-hidden="true" />
                            Change Model
                        </button>
                    {:else}
                        <!-- Current API card -->
                        <div class="bg-surface-200-800 rounded-lg p-3 space-y-1">
                            <div class="flex items-center gap-2 mb-2">
                                <Icons.Globe size={16} class={modelReady ? 'text-primary-500' : 'text-surface-400'} aria-hidden="true" />
                                <span class="text-xs font-semibold uppercase tracking-wider text-surface-400">Embeddings API</span>
                            </div>
                            <p class="text-sm font-medium">{apiModelInput || "Unknown model"}</p>
                            <p class="text-xs text-surface-700-300 truncate" title={apiBaseUrl}>{apiBaseUrl}</p>
                            {#if apiDimensions}
                                <p class="text-xs text-surface-700-300">{apiDimensions}d</p>
                            {/if}
                            {#if !modelReady}
                                <span class="inline-block mt-1 rounded-full bg-warning-500/20 px-2 py-0.5 text-xs font-medium text-warning-600">Not ready</span>
                            {:else}
                                <span class="inline-block mt-1 rounded-full bg-success-500/20 px-2 py-0.5 text-xs font-medium text-success-600">Ready</span>
                            {/if}
                        </div>
                    {/if}

                    <!-- Switch backend — not offered on Android, where local can't work -->
                    {#if !(isAndroidWrapper && mode === "api")}
                        <button
                            class="btn btn-sm preset-tonal-primary w-full text-xs"
                            onclick={mode === "local" ? goToApiSetup : goToLocalSetup}
                        >
                            <Icons.RefreshCw size={12} aria-hidden="true" />
                            Switch to {mode === "local" ? "External API" : "Local Model"}
                        </button>
                    {/if}

                    <button
                        class="btn btn-sm preset-tonal-error w-full text-xs"
                        onclick={() => (showDisableConfirmModal = true)}
                    >
                        <Icons.PowerOff size={12} aria-hidden="true" />
                        Disable Embeddings
                    </button>

            </div>
            </Tabs.Content>

    </Tabs>
    {/if}
</div>

<!-- Change Model Modal -->
<Dialog open={showChangeModelModal} onOpenChange={(e) => { if (!e.open) cancelChangeModel() }}>
    <Portal>
        <Dialog.Backdrop class="fixed inset-0 z-50 bg-surface-50-950/50 backdrop-blur-sm" />
        <Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
            <Dialog.Content class="card bg-surface-100-900 p-6 space-y-5 shadow-xl max-w-lg w-full">
                <header class="flex items-center gap-3">
                    <Icons.RefreshCw class="text-primary-500 h-5 w-5 shrink-0" />
                    <h2 class="text-lg font-bold">Change Embedding Model</h2>
                </header>

                <div class="text-warning-500 flex items-start gap-2 text-sm">
                    <Icons.AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
                    <p>Changing the model will stop the current embedding queue. All existing embeddings will need to be regenerated with the new model.</p>
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
                                    <span class="text-surface-700-300 text-xs">{model.sizeLabel} · {model.dimensions}d</span>
                                </div>
                                <p class="text-surface-700-300 mt-0.5 text-xs">{model.description}</p>
                            </div>
                        </label>
                    {/each}
                </div>

                {#if downloadProgress}
                    <div class="space-y-1">
                        <div class="flex items-center justify-between text-xs">
                            <span class="text-surface-700-300 capitalize">{downloadProgress.status}…</span>
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
                    <button class="btn preset-filled-surface-400-600" onclick={cancelChangeModel} disabled={isChangingModel}>Cancel</button>
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
            </Dialog.Content>
        </Dialog.Positioner>
    </Portal>
</Dialog>

<!-- Disable Confirmation Modal -->
<Dialog open={showDisableConfirmModal} onOpenChange={(e) => (showDisableConfirmModal = e.open)}>
    <Portal>
        <Dialog.Backdrop class="fixed inset-0 z-50 bg-surface-50-950/50 backdrop-blur-sm" />
        <Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
            <Dialog.Content class="card bg-surface-100-900 p-6 space-y-5 shadow-xl max-w-lg w-full">
                <header class="flex items-center gap-3">
                    <Icons.AlertTriangle class="text-error-500 h-5 w-5 shrink-0" />
                    <h2 class="text-lg font-bold">Disable Embeddings?</h2>
                </header>

                <p class="text-sm">
                    RAG will fall back to keyword search for all chats. You can re-enable embeddings and reconfigure at any time — existing embeddings aren't deleted, just unused until you turn this back on.
                </p>

                <footer class="flex justify-end gap-2">
                    <button class="btn preset-filled-surface-400-600" onclick={() => (showDisableConfirmModal = false)}>
                        Cancel
                    </button>
                    <button
                        class="btn preset-filled-error-500"
                        onclick={() => { showDisableConfirmModal = false; disableVectorization() }}
                    >
                        <Icons.PowerOff class="h-4 w-4" />
                        Disable Embeddings
                    </button>
                </footer>
            </Dialog.Content>
        </Dialog.Positioner>
    </Portal>
</Dialog>
