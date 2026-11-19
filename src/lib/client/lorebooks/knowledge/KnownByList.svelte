<script lang="ts">
	import { SvelteMap, SvelteSet } from "svelte/reactivity"
	import { knownByWords } from "./knownByWords"
	import KnowledgeSwitch from "./KnowledgeSwitch.svelte"

	/**
	 * 🚧 The Known by tab's body: one row per cast member, a three-way switch
	 * (Default · Knows · Kept from) and, under it, what that member does with
	 * the entry and why.
	 *
	 * Presentational: the rows, the mark and the write come in as props, so it
	 * is testable without a socket. It keeps only each row's pending flag and
	 * refusal, and says a refusal in place, never as a toast.
	 */
	type Hand = Sockets.EntryKnowledge.Hand
	type Moment = Sockets.EntryKnowledge.Moment

	interface Props {
		/** The entry is marked not common knowledge. */
		marked: boolean
		rows: Sockets.EntryKnowledge.Row[]
		loaded: boolean
		error: string | null
		formatDate: (m: Moment) => string
		onSet: (castMemberId: number, hand: Hand | null) => Promise<unknown>
	}

	let { marked, rows, loaded, error, formatDate, onSet }: Props = $props()

	const uid = $props.id()
	const pending = new SvelteSet<number>()
	const refusals = new SvelteMap<number, string>()

	async function press(memberId: number, hand: Hand | null) {
		refusals.delete(memberId)
		pending.add(memberId)
		try {
			await onSet(memberId, hand)
		} catch (err) {
			refusals.set(
				memberId,
				err instanceof Error && err.message
					? err.message
					: "Who knows this entry could not be saved."
			)
		} finally {
			pending.delete(memberId)
		}
	}
</script>

<div class="flex flex-col gap-2" data-lore-known-by>
	<p class="text-surface-600-400 text-meta">
		{marked
			? "Only the cast members who know this entry read it when they speak."
			: "This entry is common knowledge: every cast member reads it unless it is kept from them."}
	</p>
	<p class="text-surface-600-400 text-meta">
		These are this lorebook's ties; a session's notes can hold newer ones,
		which win in that session unless a tie is set here by hand and the session's notes hold no hand tie of their own.
	</p>
	{#if error}
		<p role="alert" class="text-error-700-300 text-xs">{error}</p>
	{:else if !loaded}
		<p class="text-surface-600-400 text-meta">
			Reading who knows this entry…
		</p>
	{:else if rows.length === 0}
		<p class="text-surface-600-400 text-meta">
			This lorebook has no cast members yet.
		</p>
	{:else}
		<ul class="flex flex-col gap-3">
			{#each rows as row (row.castMemberId)}
				{@const words = knownByWords(row, marked, formatDate)}
				{@const busy = pending.has(row.castMemberId)}
				<li
					class="flex flex-col gap-1"
					data-known-by-row={row.castMemberId}
				>
					<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
						<span
							id="{uid}-name-{row.castMemberId}"
							class="min-w-0 flex-1 text-sm font-medium break-words"
						>
							{row.name}
						</span>
						<KnowledgeSwitch
							labelledBy="{uid}-name-{row.castMemberId}"
							hand={row.hand}
							{busy}
							onPress={(hand) => press(row.castMemberId, hand)}
						/>
					</div>
					<div aria-live="polite" class="flex flex-col gap-0.5">
						<p class="text-surface-600-400 text-meta">
							{words.result}
						</p>
						{#if words.note}
							<p class="text-surface-600-400 text-meta">
								{words.note}
							</p>
						{/if}
					</div>
					{#if refusals.has(row.castMemberId)}
						<p role="alert" class="text-error-700-300 text-xs">
							{refusals.get(row.castMemberId)}
						</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
