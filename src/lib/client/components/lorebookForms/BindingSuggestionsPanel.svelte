<script lang="ts">
	/**
	 * Suggested cast members: names the story used that resolve to nothing.
	 *
	 * ## Why this lives in the Bindings tab
	 *
	 * Accepting a suggestion *produces a binding*, and it lands in the list
	 * directly above this panel — so the proposal and its result are on one
	 * screen, and the user sees the thing they just agreed to appear. The tab
	 * also already hosts two surfaces of exactly this genre (proactive duplicate
	 * review, and the collapsed Recent-merges log), so a found-and-dismissed log
	 * is a third of a kind rather than a new idea in a new place. A seventh
	 * icon-only tab for a secondary workflow would be worse on both counts.
	 *
	 * ## Two empty states, and they must not look alike
	 *
	 * ⚠ Annotation runs in the background. A book the lane has not reached has
	 * *no candidates yet*, which an empty list renders as *"nothing to add"* —
	 * confident, and wrong. `scanned` and `outstanding` come over the wire for
	 * this reason alone, and the two notices below are the whole point of
	 * carrying them.
	 *
	 * ## The evidence is not decoration
	 *
	 * A suggestion the user cannot evaluate in place is one they dismiss by
	 * default. So every row carries the count, the span of time it covers, and a
	 * line of the passage that named it — enough to decide without going hunting
	 * for the message it came from.
	 */
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import * as Icons from "@lucide/svelte"
	import { onMount, onDestroy } from "svelte"
	import { SvelteSet } from "svelte/reactivity"
	import { toaster } from "$lib/client/utils/toaster"

	interface Props {
		lorebookId: number
	}

	let { lorebookId }: Props = $props()

	const socket = useTypedSocket()

	let suggestions = $state<Sockets.BindingSuggestions.Suggestion[]>([])
	// ⚠ Not `false` — "we have not heard back yet" is a third state, and
	// rendering it as "not scanned" would flash a wrong notice on every open.
	let scanned = $state<boolean | null>(null)
	let outstanding = $state(0)
	let loaded = $state(false)
	let showLog = $state(false)

	/**
	 * Rows with a request in flight.
	 *
	 * ⚠ `SvelteSet`, not `$state(new Set())` — a plain Set in `$state` does not
	 * make `.add()`/`.delete()` reactive, so the buttons would never re-enable.
	 */
	const busy = new SvelteSet<number>()

	/** The row whose name is being edited before accepting, and the draft. */
	let renamingId = $state<number | null>(null)
	let renameDraft = $state("")

	let pending = $derived(suggestions.filter((s) => s.status === "pending"))
	let decided = $derived(suggestions.filter((s) => s.status !== "pending"))
	let ignoredCount = $derived(
		suggestions.filter((s) => s.status === "ignored").length
	)

	function refresh() {
		socket?.emit("bindingSuggestions:list", { lorebookId })
	}

	function handleList(msg: Sockets.BindingSuggestions.List.Response) {
		if (msg.lorebookId !== lorebookId) return
		suggestions = msg.suggestions
		scanned = msg.scanned
		outstanding = msg.outstanding
		loaded = true
		busy.clear()
		renamingId = null
	}

	/**
	 * A refusal clears the busy flag and says what it was.
	 *
	 * The server answers each refusal on its own `:error` channel with the real
	 * sentence ("already added", "already has a binding for that name"); without
	 * this the row would sit disabled for ever on a request that was answered.
	 */
	function handleError(msg: { error?: string }) {
		busy.clear()
		toaster.error({
			title: "Suggestion",
			description: msg?.error || "That could not be done."
		})
	}

	function ignore(id: number) {
		busy.add(id)
		socket?.emit("bindingSuggestions:ignore", { id })
	}

	function unignore(id: number) {
		busy.add(id)
		socket?.emit("bindingSuggestions:unignore", { id })
	}

	function startAdd(s: Sockets.BindingSuggestions.Suggestion) {
		renamingId = s.id
		// The key is lowercased by the extractor, so the surface form the
		// passage actually used is the better default — and it is still worth
		// showing, because "Emberfall" and "the ashguard riders" want different
		// capitalisation and only a person knows which.
		renameDraft = s.surface || s.name
	}

	function confirmAdd(id: number) {
		const name = renameDraft.trim()
		if (!name) return
		busy.add(id)
		socket?.emit("bindingSuggestions:add", { id, name })
	}

	const ERRORS = [
		"bindingSuggestions:list:error",
		"bindingSuggestions:ignore:error",
		"bindingSuggestions:unignore:error",
		"bindingSuggestions:add:error"
	] as const

	onMount(() => {
		if (!socket) return
		socket.on("bindingSuggestions:list", handleList)
		for (const e of ERRORS) socket.on(e, handleError)
		refresh()
	})

	onDestroy(() => {
		if (!socket) return
		socket.off("bindingSuggestions:list", handleList)
		for (const e of ERRORS) socket.off(e, handleError)
	})

	/** A date a person reads, or nothing if the value never made it over. */
	function when(iso: string): string {
		if (!iso) return ""
		const d = new Date(iso)
		return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString()
	}

	/** "seen 12 times across 3 places", said in words rather than in badges. */
	function evidenceLine(s: Sockets.BindingSuggestions.Suggestion): string {
		const times = s.occurrences === 1 ? "once" : `${s.occurrences} times`
		const places =
			s.sourceCount === 1 ? "one place" : `${s.sourceCount} places`
		const first = when(s.firstSeenAt)
		const last = when(s.lastSeenAt)
		const span =
			first && last && first !== last
				? `, ${first} – ${last}`
				: first
					? `, ${first}`
					: ""
		return `Seen ${times} in ${places}${span}`
	}

	const STATUS_LABEL: Record<string, string> = {
		ignored: "Dismissed",
		added: "Added"
	}
</script>

<div class="mt-4">
	<div class="mb-2 flex items-center justify-between gap-2">
		<p
			class="text-surface-600-400 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase"
		>
			<Icons.Sparkles size={13} aria-hidden="true" />
			Suggested cast members{pending.length ? ` (${pending.length})` : ""}
		</p>
		<button
			type="button"
			class="text-surface-500 flex shrink-0 items-center gap-1 text-xs hover:underline"
			onclick={refresh}
			title="Re-scan this lorebook for names that don't resolve to anything"
		>
			<Icons.RefreshCw size={12} aria-hidden="true" />
			Rescan
		</button>
	</div>

	{#if !loaded}
		<p class="text-surface-500 text-xs">Looking…</p>
	{:else if scanned === false}
		<!--
			⚠ NOT an empty list. Nothing has been read yet, so "no suggestions"
			would be an answer to a question that has not been asked.
		-->
		<div
			class="border-surface-300-700 text-surface-600-400 rounded-lg border border-dashed p-3 text-xs"
		>
			<p class="flex items-center gap-1.5 font-medium">
				<Icons.Clock size={13} aria-hidden="true" />
				Not scanned yet
			</p>
			<p class="mt-1">
				{#if outstanding > 0}
					{outstanding}
					{outstanding === 1 ? "source is" : "sources are"} waiting on
					the background pass that reads entries and messages for names.
					Suggestions appear here once it has run. That is not the same
					as “nothing to add”.
				{:else}
					There is nothing in this lorebook to read yet. Add an entry
					or have a conversation, and names that don’t resolve to
					anything will be proposed here.
				{/if}
			</p>
		</div>
	{:else}
		{#if outstanding > 0}
			<p class="text-surface-500 mb-2 flex items-center gap-1.5 text-xs">
				<Icons.Clock size={12} aria-hidden="true" />
				{outstanding}
				{outstanding === 1 ? "source has" : "sources have"} not been scanned
				yet. More may appear.
			</p>
		{/if}

		{#if pending.length === 0}
			<p class="text-surface-500 text-xs">
				Every name this lorebook uses already resolves to a cast member
				or an entry.
			</p>
		{:else}
			<div class="flex flex-col gap-1.5">
				{#each pending as s (s.id)}
					<div
						class="border-surface-300-700 bg-surface-50-950 rounded-lg border px-3 py-2 text-xs"
					>
						<div
							class="flex flex-wrap items-baseline justify-between gap-2"
						>
							<span class="font-semibold">
								{s.surface || s.name}
							</span>
							<span class="text-surface-500">
								{evidenceLine(s)}
							</span>
						</div>
						{#if s.exampleContext}
							<!--
								The evidence, in place. A suggestion whose
								context is elsewhere is one that gets dismissed
								by default.
							-->
							<blockquote
								class="border-surface-300-700 text-surface-600-400 mt-1.5 border-l-2 pl-2 italic"
							>
								{s.exampleContext}
							</blockquote>
						{/if}
						{#if renamingId === s.id}
							<div class="mt-2 flex flex-wrap items-center gap-2">
								<label class="sr-only" for="bsug-name-{s.id}">
									Name for the new cast member
								</label>
								<input
									id="bsug-name-{s.id}"
									class="input input-sm grow"
									bind:value={renameDraft}
									onkeydown={(e) => {
										if (e.key === "Enter") confirmAdd(s.id)
										if (e.key === "Escape")
											renamingId = null
									}}
								/>
								<button
									class="btn btn-sm preset-filled-primary-500 shrink-0"
									disabled={busy.has(s.id) ||
										!renameDraft.trim()}
									onclick={() => confirmAdd(s.id)}
								>
									<Icons.Check size={12} aria-hidden="true" />
									Add to cast
								</button>
								<button
									type="button"
									class="text-surface-500 shrink-0 hover:underline"
									onclick={() => (renamingId = null)}
								>
									Cancel
								</button>
							</div>
						{:else}
							<div class="mt-2 flex shrink-0 gap-2">
								<button
									class="btn btn-sm preset-filled-primary-500"
									disabled={busy.has(s.id)}
									onclick={() => startAdd(s)}
								>
									<Icons.Plus size={12} aria-hidden="true" />
									Add to cast
								</button>
								<button
									type="button"
									class="text-surface-500 hover:underline disabled:opacity-40"
									disabled={busy.has(s.id)}
									onclick={() => ignore(s.id)}
									title="Keep it in the log below. This can be undone"
								>
									Dismiss
								</button>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		{#if decided.length > 0}
			<!--
				The found-and-ignored log. Dismissing suppresses the suggestion;
				it does not delete the decision, and the decision is reversible
				from here.
			-->
			<div class="mt-3">
				<button
					type="button"
					class="text-surface-500 flex items-center gap-1 text-xs hover:underline"
					aria-expanded={showLog}
					onclick={() => (showLog = !showLog)}
				>
					<Icons.ChevronRight
						size={12}
						aria-hidden="true"
						class="transition-transform {showLog
							? 'rotate-90'
							: ''}"
					/>
					Dismissed and added ({decided.length}{ignoredCount
						? `, ${ignoredCount} dismissed`
						: ""})
				</button>
				{#if showLog}
					<div class="mt-2 flex flex-col gap-1.5">
						{#each decided as s (s.id)}
							<div
								class="border-surface-300-700 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs"
							>
								<span class="text-surface-600-400">
									<span class="font-medium">
										{s.surface || s.name}:
									</span>
									{STATUS_LABEL[s.status] ?? s.status}
									{#if s.decidedAt}
										{when(s.decidedAt)}
									{/if}
									{#if !s.stillPresent}
										<!--
											The decision outlives its evidence:
											the passage was edited, or the
											vocabulary widened until the name
											resolves. The row stays; the claim
											that the story still says it does
											not.
										-->
										<span class="text-surface-500 italic">
											(no longer in the text)
										</span>
									{/if}
								</span>
								{#if s.status === "ignored"}
									<button
										type="button"
										class="text-primary-500 shrink-0 hover:underline disabled:opacity-40"
										disabled={busy.has(s.id)}
										onclick={() => unignore(s.id)}
										title="Put it back in the suggestions above"
									>
										Restore
									</button>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	{/if}
</div>
