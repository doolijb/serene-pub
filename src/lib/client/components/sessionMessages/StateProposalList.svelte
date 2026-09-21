<script lang="ts">
	/**
	 * Held changes, with the two buttons that decide them.
	 *
	 * The model is the one writer with no authority: what it produces is a
	 * pending line, not a change. So nothing here applies anything — Accept runs
	 * the same write a script's would have run, Reject leaves the world as it
	 * was, and until one of them is pressed the stat says what it said.
	 *
	 * The same list under a message and in the Review panel, because "everything
	 * waiting" and "what this turn asked for" are the same rows read at two
	 * scopes, and two components would be two ways to describe one payload.
	 *
	 * A **superseded** row (plans/29 R-15 *Staleness and order*; U5f) is an
	 * accept that applied nothing: the slot moved since the proposal was
	 * made. It stays under its message, collapsed, naming what moved, with
	 * no buttons — the ledger's word on why the model's ask never landed.
	 */
	import * as Icons from "@lucide/svelte"
	import { describeProposal } from "$lib/shared/state/ledgerLines"
	import { sessionState } from "$lib/client/state/sessionState.svelte"
	import { t } from "$lib/client/i18n/state.svelte"

	interface Props {
		proposals: Sockets.State.ProposalRow[]
		/** Shown in the Review panel, where a row is not under its message. */
		showAnchor?: boolean
	}
	let { proposals, showAnchor = false }: Props = $props()

	const store = sessionState()

	const describe = (row: Sockets.State.ProposalRow) =>
		describeProposal(row, {
			ownerLabel: (owner) => store.ownerLabelFor(owner),
			slotLabel: (slotId) => store.slotLabelFor(slotId),
			itemName: (entryId) => store.itemNameFor(entryId)
		})

	/** What a superseded row names as moved: the slot's label, or the item. */
	const movedName = (row: Sockets.State.ProposalRow): string => {
		const payload = row.payload ?? {}
		if (row.kind === "value" && typeof payload.slotId === "string")
			return store.slotLabelFor(payload.slotId) ?? payload.slotId
		if (typeof payload.entryId === "number")
			return store.itemNameFor(payload.entryId) ?? t("an item")
		return t("a value")
	}
</script>

{#each proposals as row (row.id)}
	{#if row.status === "superseded"}
		<div
			class="pending superseded"
			data-proposal-id={row.id}
			data-superseded="true"
		>
			<Icons.History size={11} aria-hidden="true" />
			<span class="pending-text">
				{describe(row)}
				<span class="who">
					· {t("Superseded — {slot} changed since this was proposed").replace(
						"{slot}",
						movedName(row)
					)}
				</span>
			</span>
		</div>
	{:else}
		<div class="pending" data-proposal-id={row.id}>
			<Icons.Sparkles size={11} aria-hidden="true" />
			<span class="pending-text">
				{describe(row)}
				{#if showAnchor && row.messageId != null}
					<span class="anchor">on message {row.messageId}</span>
				{/if}
			</span>
			<span class="who" title="Proposed by {row.proposedBy || 'a run'}">
				proposed
			</span>
			<button
				class="decide accept"
				onclick={() => store.decide(row.id, true)}
			>
				Accept
			</button>
			<button
				class="decide reject"
				onclick={() => store.decide(row.id, false)}
			>
				Reject
			</button>
		</div>
	{/if}
{/each}

<style>
	.pending {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.68rem;
	}
	.pending-text {
		min-width: 0;
		flex: 1 1 8rem;
	}
	.anchor,
	.who {
		opacity: 0.55;
	}
	.superseded {
		opacity: 0.7;
	}
	.decide {
		padding: 0.02rem 0.4rem;
		border-radius: 999px;
		background: color-mix(in oklab, currentColor 14%, transparent);
	}
	.decide:hover {
		filter: brightness(1.2);
	}
	.accept {
		font-weight: 600;
	}
	.reject {
		opacity: 0.75;
	}
</style>
