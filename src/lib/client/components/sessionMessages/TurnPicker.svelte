<script lang="ts">
	/**
	 * "Someone else" (PLAN-turn-order §4.9): the session's turn candidates —
	 * `turnOrder.candidates`, the cast as the strategy saw it — and the
	 * narrator, one of which takes the turn instead of the prepared head.
	 *
	 * A pick is a fire with an entry (`sessions:fireTurn`, `via: 'pick'`); the
	 * server decides whether this person may make it (§4.7: the owner may
	 * name anyone, a guest only a prepared turn that is theirs), so the list
	 * never guesses. A person's persona is not offered: a person's turn is
	 * theirs to take by writing, not something a click fires for them.
	 */

	type Candidate = {
		ref: string
		kind: string
		name: string
		nickname?: string
	}

	interface Props {
		open: boolean
		candidates: Candidate[]
		/** The order's head, marked in the list: null is the narrator, undefined no order. */
		headRef?: string | null
		/** A face for a candidate, when the session has one loaded. */
		avatarFor?: (ref: string) => unknown
		/** Whether the genre has a narrator to hand the turn to. */
		offerNarrator?: boolean
		onPick: (entry: { ref: string | null }) => void
		onClose: () => void
	}

	let {
		open,
		candidates,
		headRef,
		avatarFor,
		offerNarrator = false,
		onPick,
		onClose
	}: Props = $props()

	const speakable = $derived(candidates.filter((c) => c.kind !== "persona"))
	const label = (c: Candidate) => c.nickname || c.name
</script>

<!-- `sp-dialog` (§3.5): the host's modal — focus-trapped, Escape and the
     backdrop close it; core's base skin draws it (hostElements.css). -->
<sp-dialog
	{open}
	label="Who speaks next?"
	onopen-change={(e: CustomEvent<{ open: boolean }>) => {
		if (!e.detail.open) onClose()
	}}
>
	<span slot="title">Who speaks next?</span>
	<ul class="flex flex-col gap-1">
		{#each speakable as c (c.ref)}
			<li>
				<button
					type="button"
					class="hover:bg-surface-200-800 flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left"
					onclick={() => onPick({ ref: c.ref })}
				>
					{#if avatarFor?.(c.ref)}
						<sp-avatar ref={c.ref} size="md"></sp-avatar>
					{:else}
						<span
							class="bg-surface-300-700 grid size-8 place-items-center rounded-full"
							aria-hidden="true"
						>
							<sp-icon name="user" size="16"></sp-icon>
						</span>
					{/if}
					<span class="min-w-0 flex-1 truncate text-sm">{label(c)}</span>
					{#if c.ref === headRef}
						<span class="text-surface-600-400 text-xs">next</span>
					{/if}
				</button>
			</li>
		{/each}
		{#if offerNarrator}
			<li>
				<button
					type="button"
					class="hover:bg-surface-200-800 flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left"
					onclick={() => onPick({ ref: null })}
				>
					<span
						class="bg-surface-300-700 grid size-8 place-items-center rounded-full"
						aria-hidden="true"
					>
						<sp-icon name="book-open-text" size="16"></sp-icon>
					</span>
					<span class="min-w-0 flex-1 truncate text-sm">The narrator</span>
					{#if headRef === null}
						<span class="text-surface-600-400 text-xs">next</span>
					{/if}
				</button>
			</li>
		{/if}
	</ul>
	{#if !speakable.length && !offerNarrator}
		<p class="text-surface-600-400 text-sm">
			Nobody else can take this turn.
		</p>
	{/if}
</sp-dialog>
