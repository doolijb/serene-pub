<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { getSocket } from "$lib/client/sockets/socketInstance"

	interface Props {
		sessionId: number
		totalMessages: number
	}

	let { sessionId, totalMessages }: Props = $props()

	const socket = getSocket()!

	type RagStatus = Sockets.Vectorization.CheckRagStatus.Response
	let ragStatus: RagStatus | null = $state(null)
	let prioritizing = $state(false)
	let ignoring = $state(false)

	function fetchStatus() {
		socket.emit(
			"vectorization:checkRagStatus",
			{ sessionId },
			(res: RagStatus) => {
				ragStatus = res
			}
		)
	}

	$effect(() => {
		// Re-fetch whenever sessionId or message count changes
		sessionId
		totalMessages
		fetchStatus()
	})

	// Re-fetch when the queue reports a status change (items may have finished)
	socket.on("vectorization:progress", () => {
		if (ragStatus?.applicable) {
			fetchStatus()
		}
	})

	function handleMoveToTop() {
		prioritizing = true
		socket.emit("vectorization:addToQueue", { sessionId }, () => {
			fetchStatus()
			prioritizing = false
		})
	}

	function handleSetRagIgnored(ignored: boolean) {
		ignoring = true
		socket.emit(
			"vectorization:setSessionRagIgnored",
			{ sessionId, ignored },
			(res: Sockets.Vectorization.SetSessionRagIgnored.Response) => {
				if (ragStatus)
					ragStatus = { ...ragStatus, ragIgnored: res.ragIgnored }
				ignoring = false
			}
		)
	}

	/** Aggregate counts across all content types */
	let totals = $derived.by(() => {
		if (!ragStatus) return null
		const { messages, characters, personas, lorebook } = ragStatus
		const lb = lorebook ?? {
			total: 0,
			nullCount: 0,
			staleCount: 0,
			readyCount: 0
		}
		return {
			total:
				messages.total + characters.total + personas.total + lb.total,
			nullCount:
				messages.nullCount +
				characters.nullCount +
				personas.nullCount +
				lb.nullCount,
			staleCount:
				messages.staleCount +
				characters.staleCount +
				personas.staleCount +
				lb.staleCount,
			readyCount:
				messages.readyCount +
				characters.readyCount +
				personas.readyCount +
				lb.readyCount
		}
	})

	/**
	 * Derive the notice variant:
	 *   "none"       — nothing has been embedded
	 *   "stale"      — all embedded content uses a stale model
	 *   "processing" — partially indexed (mix of ready + pending)
	 */
	let variant = $derived.by((): "none" | "stale" | "processing" | null => {
		if (!ragStatus?.applicable || ragStatus.ragIgnored || !totals)
			return null
		const { total, nullCount, staleCount, readyCount } = totals
		if (total === 0) return null
		if (readyCount === total) return null // all good
		if (staleCount > 0 && nullCount === 0) return "stale"
		if (nullCount === total) return "none"
		return "processing"
	})

	/** Build a human-readable summary of what needs work */
	let needsSummary = $derived.by(() => {
		if (!ragStatus || !totals) return ""
		const parts: string[] = []
		if (ragStatus.messages.nullCount + ragStatus.messages.staleCount > 0)
			parts.push("messages")
		if (
			ragStatus.characters.nullCount + ragStatus.characters.staleCount >
			0
		)
			parts.push("characters")
		if (ragStatus.personas.nullCount + ragStatus.personas.staleCount > 0)
			parts.push("personas")
		if (
			ragStatus.lorebook &&
			ragStatus.lorebook.nullCount + ragStatus.lorebook.staleCount > 0
		)
			parts.push("lorebook entries")
		if (parts.length === 0) return ""
		if (parts.length === 1) return parts[0]
		return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1]
	})
</script>

{#if ragStatus?.applicable && variant}
	<div
		class="preset-tonal-warning border-warning-500/50 mx-2 mb-1 rounded-lg border px-3 py-2 text-sm"
		role="alert"
		aria-live="polite"
	>
		<div class="flex flex-wrap items-start gap-2">
			<div class="flex min-w-0 flex-1 items-start gap-2">
				{#if variant === "processing"}
					<Icons.Loader
						size={16}
						class="text-warning-600 mt-0.5 shrink-0 animate-spin"
						aria-hidden="true"
					/>
				{:else}
					<Icons.AlertTriangle
						size={16}
						class="text-warning-600 mt-0.5 shrink-0"
						aria-hidden="true"
					/>
				{/if}

				<div class="min-w-0">
					{#if variant === "none"}
						<p class="font-medium">RAG content not yet indexed</p>
						<p class="text-surface-600-400 text-xs">
							Older {needsSummary} haven't been embedded yet — RAG
							won't surface relevant context from this session.
						</p>
					{:else if variant === "stale"}
						<p class="font-medium">
							RAG content indexed with a different model
						</p>
						<p class="text-surface-600-400 text-xs">
							{needsSummary} were embedded with a previous model and
							need re-indexing with
							<span class="font-mono">
								{ragStatus.activeModelName}
							</span>
							.
						</p>
					{:else if variant === "processing"}
						<p class="font-medium">Indexing in progress…</p>
						<p class="text-surface-600-400 text-xs">
							{totals?.readyCount} of {totals?.total} items indexed
							({needsSummary} pending).
							{#if !ragStatus.queueRunning}Queue paused.{/if}
						</p>
					{/if}
				</div>
			</div>

			<div class="flex shrink-0 flex-wrap gap-1">
				<button
					class="btn btn-sm preset-tonal-warning text-xs"
					onclick={handleMoveToTop}
					disabled={prioritizing}
					title="Move this session and its linked content to the top of the embedding queue"
				>
					{#if prioritizing}
						<Icons.Loader
							size={12}
							class="animate-spin"
							aria-hidden="true"
						/>
					{:else}
						<Icons.ArrowUpToLine size={12} aria-hidden="true" />
					{/if}
					Prioritize in queue
				</button>

				<button
					class="btn btn-sm preset-outlined text-xs"
					onclick={() => handleSetRagIgnored(true)}
					disabled={ignoring}
					title="Ignore RAG for this session and hide this notice"
				>
					Ignore for this session
				</button>
			</div>
		</div>
	</div>
{:else if ragStatus?.ragIgnored && ragStatus.applicable}
	<div class="mx-2 mb-1 flex items-center gap-2 px-3 py-1 text-xs opacity-60">
		<Icons.SearchX size={12} aria-hidden="true" />
		<span>RAG disabled for this session.</span>
		<button
			class="hover:text-primary-500 underline"
			onclick={() => handleSetRagIgnored(false)}
		>
			Re-enable
		</button>
	</div>
{/if}
