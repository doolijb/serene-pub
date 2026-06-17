<script lang="ts">
    import * as Icons from "@lucide/svelte"
    import { getContext, onMount } from "svelte"
    import * as skio from "sveltekit-io"

    interface Props {
        onclose?: () => Promise<boolean> | undefined
    }

    let { onclose = $bindable() }: Props = $props()

    const socket = skio.get()!
    let vectorizationCtx: VectorizationCtx = $state(getContext("vectorizationCtx"))

    let startingQueue = $state(false)
    let stoppingQueue = $state(false)
    let removingGroup = $state<string | null>(null)

    onMount(() => {
        onclose = async () => true
        socket.emit("vectorization:getQueue", {}, (res: Sockets.Vectorization.GetQueue.Response) => {
            vectorizationCtx.priorityQueue = res.queue
            vectorizationCtx.history = res.history ?? []
        })
    })

    function startQueue() {
        startingQueue = true
        socket.emit("vectorization:startQueue", {}, () => { startingQueue = false })
    }

    function stopQueue() {
        stoppingQueue = true
        socket.emit("vectorization:stopQueue", {}, () => { stoppingQueue = false })
    }

    function removeGroup(groupId: string) {
        removingGroup = groupId
        socket.emit(
            "vectorization:removeFromQueue",
            { groupId },
            (res: Sockets.Vectorization.RemoveFromQueue.Response) => {
                vectorizationCtx.priorityQueue = res.queue
                removingGroup = null
            }
        )
    }

    function moveGroup(groupId: string, direction: "up" | "down") {
        socket.emit(
            "vectorization:moveQueueGroup",
            { groupId, direction },
            (res: Sockets.Vectorization.MoveQueueGroup.Response) => {
                vectorizationCtx.priorityQueue = res.queue
            }
        )
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

<div class="flex h-full flex-col gap-4 p-4 overflow-hidden">
    <!-- Status card -->
    <div class="preset-tonal-surface shrink-0 rounded-lg p-3">
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

    <!-- Scrollable body: queue + history -->
    <div class="flex flex-1 flex-col gap-4 overflow-y-auto min-h-0">

        <!-- Queue -->
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
                            <!-- Position -->
                            <span
                                class="bg-surface-300-700 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                            >{i + 1}</span>

                            <!-- Info -->
                            <div class="min-w-0 flex-1">
                                <p class="truncate font-medium" title={group.label}>{group.label}</p>
                                <p class="text-surface-500 truncate">{group.ownerDisplayName}</p>
                                {#if summary}
                                    <p class="text-surface-400 mt-0.5">{summary}</p>
                                {/if}
                            </div>

                            <!-- Controls -->
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
</div>
