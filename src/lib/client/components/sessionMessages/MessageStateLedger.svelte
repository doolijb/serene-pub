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
	import * as Icons from "@lucide/svelte"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import {
		openSessionState,
		sessionState
	} from "$lib/client/state/sessionState.svelte"
	import StateProposalList from "./StateProposalList.svelte"

	interface Props {
		messageId: number
		sessionId: number | null
	}
	let { messageId, sessionId }: Props = $props()

	const store = sessionState()
	$effect(() => openSessionState(sessionId))

	let groups = $derived(store.ledgerFor(messageId))
	let pending = $derived(store.pendingFor(messageId))
	let waiting = $derived(store.pending)
	let reviewOpen = $state(false)
</script>

{#if groups.length || pending.length}
	<div class="ledger" data-ledger-message={messageId}>
		{#each groups as group (group.ownerKey)}
			<p class="line" data-owner-key={group.ownerKey}>
				<span class="who">{group.ownerLabel}</span>
				{#each group.lines as line, i (line.key)}
					{#if i > 0}<span class="sep">·</span>{/if}
					<span class="change" title="changed by {line.updatedBy}">
						{line.text}
					</span>
				{/each}
			</p>
		{/each}

		{#if pending.length}
			<StateProposalList proposals={pending} />
		{/if}

		{#if waiting.length}
			<Popover
				open={reviewOpen}
				onOpenChange={(e) => (reviewOpen = e.open)}
				positioning={{ placement: "bottom-start" }}
			>
				<Popover.Trigger class="review">
					<Icons.ClipboardCheck size={11} aria-hidden="true" />
					<span>
						Review
						{waiting.length === 1
							? "1 change"
							: `${waiting.length} changes`}
					</span>
				</Popover.Trigger>
				<Portal>
					<Popover.Positioner class="z-[1000]!">
						<Popover.Content
							class="card bg-surface-100-900 w-[min(92vw,360px)] space-y-2 p-3"
						>
							<header
								class="flex items-center gap-1.5 text-xs font-semibold"
							>
								<Icons.ClipboardCheck
									size={14}
									aria-hidden="true"
								/>
								<span>Waiting for you</span>
							</header>
							<p class="text-surface-600-400 text-[0.68rem]">
								The AI asked for these. Nothing changes until
								you accept one.
							</p>
							<StateProposalList proposals={waiting} showAnchor />
						</Popover.Content>
					</Popover.Positioner>
				</Portal>
			</Popover>
		{/if}
	</div>
{/if}

<style>
	.ledger {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.2rem 0.1rem 0;
		font-size: 0.68rem;
		opacity: 0.85;
	}
	.line {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem;
		margin: 0;
	}
	.who {
		font-weight: 600;
	}
	.sep {
		opacity: 0.5;
	}
	.change {
		font-variant-numeric: tabular-nums;
	}
	:global(.review) {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		align-self: flex-start;
		padding: 0.02rem 0.35rem;
		border-radius: 999px;
		background: color-mix(in oklab, currentColor 12%, transparent);
		font-size: 0.66rem;
	}
	:global(.review:hover) {
		filter: brightness(1.2);
	}
</style>
