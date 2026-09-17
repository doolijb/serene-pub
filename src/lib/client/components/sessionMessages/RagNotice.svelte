<script lang="ts">
	/**
	 * ⚠ No request here takes an ack callback, and none may.
	 * `sockets/index.ts`'s `register` listens with a one-argument handler and
	 * answers by EMITTING the request's own event back, so a three-argument
	 * `socket.emit(event, params, callback)` is a callback nothing ever calls —
	 * which is a notice that never paints. Every request is a
	 * `requestWithInterest` whose handler IS the reply.
	 */
	import * as Icons from "@lucide/svelte"
	import { onDestroy } from "svelte"
	import {
		requestWithInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"

	interface Props {
		sessionId: number
		totalMessages: number
	}

	let { sessionId, totalMessages }: Props = $props()

	type RagStatus = Sockets.Vectorization.CheckRagStatus.Response
	let ragStatus: RagStatus | null = $state(null)
	let prioritizing = $state(false)
	let ignoring = $state(false)

	/**
	 * The one-shot request interests, released the moment their reply lands.
	 *
	 * Held here as well so an unmount mid-flight releases them — a reply that
	 * never comes (the request was refused) would otherwise leave this notice's
	 * interest declared for the life of the tab.
	 */
	const pending = new Set<() => void>()

	/**
	 * A request whose interest lasts exactly as long as its reply takes: the
	 * handler calls `done` when it fires, and anything still outstanding is
	 * released on destroy.
	 */
	function oneShot(begin: (done: () => void) => () => void): void {
		let release: () => void = () => {}
		const done = () => {
			pending.delete(release)
			release()
		}
		release = begin(done)
		pending.add(release)
	}

	function fetchStatus() {
		oneShot((done) =>
			requestWithInterest(
				"vectorization:checkRagStatus",
				{ sessionId },
				(res) => {
					ragStatus = res
					done()
				}
			)
		)
	}

	$effect(() => {
		// Re-fetch whenever sessionId or message count changes
		sessionId
		totalMessages
		fetchStatus()
	})

	// Re-fetch when the queue reports a status change (items may have
	// finished). Declared through the registry, so it is released on destroy
	// rather than piling another listener on the socket per session shown.
	useInterest<"vectorization:progress">("vectorization:progress", () => {
		if (ragStatus?.applicable) {
			fetchStatus()
		}
	})

	onDestroy(() => {
		for (const release of [...pending]) release()
		pending.clear()
	})

	function handleMoveToTop() {
		prioritizing = true
		oneShot((done) =>
			requestWithInterest(
				"vectorization:addToQueue",
				{ sessionId },
				() => {
					done()
					prioritizing = false
					fetchStatus()
				}
			)
		)
	}

	function handleSetRagIgnored(ignored: boolean) {
		ignoring = true
		oneShot((done) =>
			requestWithInterest(
				"vectorization:setSessionRagIgnored",
				{ sessionId, ignored },
				(res) => {
					done()
					if (ragStatus)
						ragStatus = { ...ragStatus, ragIgnored: res.ragIgnored }
					ignoring = false
				}
			)
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

<!-- One quiet line, sized and placed by whatever hosts it: the composer sets
     it above the card, opposite the Actions label. -->
{#if ragStatus?.applicable && variant}
	<div
		class="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs"
		role="alert"
		aria-live="polite"
	>
		{#if variant === "processing"}
			<Icons.Loader
				size={12}
				class="text-warning-600 dark:text-warning-500 shrink-0 animate-spin"
				aria-hidden="true"
			/>
		{:else}
			<Icons.AlertTriangle
				size={12}
				class="text-warning-600 dark:text-warning-500 shrink-0"
				aria-hidden="true"
			/>
		{/if}

		<span class="text-surface-600 dark:text-surface-400 min-w-0">
			{#if variant === "none"}
				Older {needsSummary} aren't embedded yet, so RAG can't surface them.
			{:else if variant === "stale"}
				{needsSummary} were embedded with a different model and need re-indexing
				with {ragStatus.activeModelName}.
			{:else if variant === "processing"}
				Indexing {totals?.readyCount} of {totals?.total}, {needsSummary}
				pending.
				{#if !ragStatus.queueRunning}
					Queue paused.
				{/if}
			{/if}
		</span>

		<button
			type="button"
			class="rag-notice-link"
			onclick={handleMoveToTop}
			disabled={prioritizing}
			title="Move this session and its linked content to the top of the embedding queue"
		>
			Prioritize in queue
		</button>

		<button
			type="button"
			class="rag-notice-link"
			onclick={() => handleSetRagIgnored(true)}
			disabled={ignoring}
			title="Ignore RAG for this session and hide this notice"
		>
			Ignore for this session
		</button>
	</div>
{:else if ragStatus?.ragIgnored && ragStatus.applicable}
	<div
		class="text-surface-500 flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs"
	>
		<Icons.SearchX size={12} class="shrink-0" aria-hidden="true" />
		<span>RAG is off for this session.</span>
		<button
			type="button"
			class="rag-notice-link"
			onclick={() => handleSetRagIgnored(false)}
		>
			Re-enable
		</button>
	</div>
{/if}

<style>
	/* A text link, not a button box: at 12px beside the sentence it explains,
	   a bordered control would outweigh the notice itself. */
	.rag-notice-link {
		color: var(--color-primary-700);
		text-underline-offset: 2px;
		cursor: pointer;
	}

	:global([data-mode="dark"]) .rag-notice-link {
		color: var(--color-primary-500);
	}

	.rag-notice-link:hover:not(:disabled) {
		text-decoration: underline;
	}

	.rag-notice-link:disabled {
		opacity: 0.4;
		pointer-events: none;
	}

	.rag-notice-link:focus-visible {
		outline: 2px solid var(--color-primary-500);
		outline-offset: 2px;
	}
</style>
