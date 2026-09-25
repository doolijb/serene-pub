<script lang="ts">
	/**
	 * The transcript ledger: what one message changed, under that message.
	 *
	 * Every line is a real row anchored to this message, which is what makes it
	 * revertible WITH the message: delete or regenerate the reply and the rows it
	 * wrote go too, so the ledger cannot drift from the fiction it describes.
	 * It renders nothing at all for a message that changed nothing, which is
	 * almost every message in almost every session.
	 *
	 * Pending lines are the model's proposals waiting at the gate. They sit here
	 * rather than in a queue somewhere else because the sentence that justifies a
	 * change is the one above them; **Review** opens the same rows for the whole
	 * session, for when they have scrolled away.
	 */
	import StateProposalList from "./StateProposalList.svelte"
	import { useConversation } from "./conversation.svelte"

	interface Props {
		messageId: number
	}
	let { messageId }: Props = $props()

	// What this line changed and what waits on it: the page's projection of
	// the session state (C0b), read off the conversation.
	const conv = useConversation()
	let groups = $derived(conv.dossier?.state.ledgers[messageId] ?? [])
	let pending = $derived(conv.dossier?.state.pending[messageId] ?? [])
	let waiting = $derived(conv.dossier?.state.waiting ?? [])
	let reviewOpen = $state(false)
</script>

{#if groups.length || pending.length}
	<div class="sp-ledger" data-ledger-message={messageId}>
		{#each groups as group (group.ownerKey)}
			<p class="sp-ledger-line" data-owner-key={group.ownerKey}>
				<span class="sp-ledger-who">{group.ownerLabel}</span>
				{#each group.lines as line, i (line.key)}
					{#if i > 0}<span class="sp-ledger-sep">·</span>{/if}
					<span class="sp-ledger-change" title="changed by {line.updatedBy}">
						{line.text}
					</span>
				{/each}
			</p>
		{/each}

		{#if pending.length}
			<StateProposalList proposals={pending} />
		{/if}

		{#if waiting.length}
			<!-- `sp-popover` (§3.5): our button is the trigger, the card the panel. -->
			<sp-popover
				placement="bottom-start"
				label="Waiting for you"
				open={reviewOpen}
				onopen-change={(e: CustomEvent<{ open: boolean }>) => (reviewOpen = e.detail.open)}
			>
				<button slot="trigger" type="button" class="sp-ledger-review">
					<sp-icon name="clipboard-check" size="11"></sp-icon>
					<span>
						Review
						{waiting.length === 1
							? "1 change"
							: `${waiting.length} changes`}
					</span>
				</button>
						<div class="card bg-surface-100-900 w-[min(92vw,360px)] space-y-2 p-3">
							<header
								class="flex items-center gap-1.5 text-xs font-semibold"
							>
								<sp-icon name="clipboard-check" size="14"></sp-icon>
								<span>Waiting for you</span>
							</header>
							<p class="text-surface-600-400 text-[0.68rem]">
								The AI asked for these. Nothing changes until
								you accept one.
							</p>
							<StateProposalList proposals={waiting} showAnchor />
						</div>
			</sp-popover>
		{/if}
	</div>
{/if}
