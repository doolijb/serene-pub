<script lang="ts">
	/**
	 * Everything that has ever fired in this session.
	 *
	 * The panel above it explains one turn, which is the right shape for "why
	 * did *that* reply say that" and the wrong shape for the question an author
	 * actually arrives with: *which of my entries is this session using at
	 * all?* Answering that from single runs means opening them one at a time
	 * and keeping the tally in your head, which is how an entry that has never
	 * once fired goes unnoticed for a hundred turns.
	 *
	 * Three things it follows from its sibling:
	 *
	 * · **The sentence before the table.** The server writes the finding —
	 *   which entry this session reaches for most — and the rows are the
	 *   support for it, not the answer.
	 * · **The bound is said out loud.** A tally that quietly stopped counting
	 *   at some depth is not a partial answer, it is a wrong one: "this never
	 *   fires" is precisely what somebody would conclude and act on. The
	 *   server's `notes` carry the depth, the previews left out and the tail
	 *   not listed, and all three render.
	 * · **Asked for, not assumed.** The aggregate reads across every receipt in
	 *   the session, so it is fetched when a reader opens this rather than on
	 *   every receipt they happen to click.
	 */
	import * as Icons from "@lucide/svelte"
	import { onDestroy, onMount } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"

	interface Props {
		/** The session the open receipt belongs to. Nothing is asked without one. */
		sessionId: number | null | undefined
	}

	let { sessionId }: Props = $props()

	const socket = useTypedSocket()

	type Usage = Sockets.Pipelines.SessionEntryUsage.Response

	let usage = $state<Usage | null>(null)
	let loading = $state(false)
	let shown = $state(false)
	/**
	 * The session a request has gone out for — one request per session rather
	 * than one per effect pass, and what makes hiding and re-showing the panel
	 * free.
	 */
	let requestedFor = $state<number | null>(null)
	let order = $state<"used" | "recent">("used")

	const onUsage = (res: Usage) => {
		loading = false
		if (res.error) {
			toaster.error({ title: res.error })
			return
		}
		// The receipt above can move to a run in another session while this is
		// open. A tally rendered under the wrong session's heading is worse
		// than no tally, so a late answer for a session the reader has left is
		// dropped rather than shown.
		if (res.sessionId !== sessionId) return
		usage = res
	}

	/** The read failed: stop waiting, and show the sentence the server wrote. */
	const showRefusal = (res: { error?: string }) => {
		loading = false
		if (res?.error) toaster.error({ title: res.error })
	}

	onMount(() => {
		socket.on("pipelines:sessionEntryUsage", onUsage)
		socket.on("pipelines:sessionEntryUsage:error", showRefusal)
	})
	onDestroy(() => {
		socket.off("pipelines:sessionEntryUsage", onUsage)
		socket.off("pipelines:sessionEntryUsage:error", showRefusal)
	})

	/**
	 * Ask once, and only when a reader is looking.
	 *
	 * The single place a request is made — a `reveal()` that emitted as well
	 * would send two for the same session, because opening the panel re-runs
	 * this too. `requestedFor` is the marker that makes the second pass a
	 * no-op; a different session under the same open panel is a different
	 * answer and drops the held one.
	 */
	$effect(() => {
		const id = sessionId
		if (id !== requestedFor) usage = null
		if (!shown || id == null || id === requestedFor) return
		requestedFor = id
		loading = true
		socket.emit("pipelines:sessionEntryUsage", { sessionId: id })
	})

	const rows = $derived(usage?.entries ?? [])
	/**
	 * The server answers most-used-first, because that is the question:
	 * an entry in forty of fifty turns is shaping this session whether or not
	 * it happened to fire in the last one. Recency is the other reading of the
	 * same rows and is one click away rather than a second request.
	 */
	const ordered = $derived(
		order === "used"
			? rows
			: [...rows].sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
	)

	const when = (iso: string) => new Date(iso).toLocaleString()

	const ORDERS: Array<{ key: "used" | "recent"; label: string }> = [
		{ key: "used", label: "Used most often" },
		{ key: "recent", label: "Used most recently" }
	]
</script>

{#if sessionId != null}
	<!-- A bordered section rather than a second card, for the reason the
	     retrieval panel beside it is one: this renders INSIDE the receipt's own
	     filled card, and the same preset nested in itself reads as a rendering
	     fault rather than as a division. -->
	<section
		class="border-surface-300-700 flex flex-col gap-2 rounded border p-3"
		aria-label="What this session has used"
	>
		<div class="flex flex-wrap items-baseline gap-2">
			<h4 class="text-sm font-semibold">Across this session</h4>
			<span class="text-surface-600-400 text-xs">
				Everything that has gone into a prompt here, not just this turn.
			</span>
			<span class="flex-1"></span>
			<button
				type="button"
				class="text-surface-600-400 text-xs underline"
				onclick={() => (shown = !shown)}
				aria-expanded={shown}
				aria-controls="session-usage"
			>
				{shown ? "Hide" : "Show"}
			</button>
		</div>

		{#if shown}
			<div id="session-usage" class="flex flex-col gap-2">
				{#if loading}
					<p class="text-surface-600-400 text-sm">
						Adding up the turns…
					</p>
				{:else if usage}
					<!-- The finding first. The rows below are what it rests on. -->
					{#if usage.summary}
						<p
							class="text-surface-700-300 flex items-start gap-2 text-xs"
						>
							<Icons.Repeat
								size={14}
								class="mt-0.5 shrink-0"
								aria-hidden="true"
							/>
							<span>{usage.summary}</span>
						</p>
					{/if}

					<!-- What the tally did not cover. Rendered plainly rather
					     than as a warning: none of these is a fault, and all
					     three change what the list means. -->
					{#if usage.notes?.length}
						<ul
							class="text-surface-600-400 flex flex-col gap-0.5 text-xs"
						>
							{#each usage.notes as n (n)}
								<li>{n}</li>
							{/each}
						</ul>
					{/if}

					{#if rows.length}
						<div class="flex flex-wrap items-center gap-1.5">
							{#each ORDERS as o (o.key)}
								<button
									type="button"
									class="chip rounded-full px-2.5 py-1 text-xs {order ===
									o.key
										? 'preset-filled-primary-500'
										: 'preset-tonal-surface'}"
									onclick={() => (order = o.key)}
								>
									{o.label}
								</button>
							{/each}
						</div>

						<ul
							class="flex max-h-[22rem] flex-col gap-1 overflow-y-auto"
						>
							{#each ordered as row (row.key)}
								<li
									class="preset-tonal-surface flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded p-2"
								>
									<span class="text-sm font-medium">
										{row.title}
									</span>
									<span
										class="text-surface-600-400 text-[0.68rem] tracking-wider uppercase"
									>
										{row.sourceLabel}
									</span>
									<span class="flex-1"></span>
									<span class="text-surface-700-300 text-xs">
										In the prompt {row.usedInRuns} of the {row.judgedInRuns}
										{row.judgedInRuns === 1
											? "turn"
											: "turns"} that weighed it
									</span>
									<span
										class="text-surface-600-400 text-xs whitespace-nowrap"
										title="The last turn it went into"
									>
										last {when(row.lastUsedAt)}
									</span>
									{#if row.tokens != null}
										<span
											class="text-surface-600-400 text-xs whitespace-nowrap"
											title="What it cost the last time it went in"
										>
											{row.tokens} tok
										</span>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</div>
		{/if}
	</section>
{/if}
