<script lang="ts">
	/**
	 * The World State widget: the session's world slots, editable.
	 *
	 * The same values a template reads as `state.world.*` and the conditions
	 * vocabulary reads for layout rules — so what is edited here is what the
	 * model is told and what a rule fires on, which is why it is worth one
	 * strip above the messages rather than a page somewhere else.
	 *
	 * A world slot belongs to the session's own owner, so an edit is a
	 * session-layer deviation: the world's own answer is untouched, and clearing
	 * one goes back to inheriting it.
	 */
	import * as Icons from "@lucide/svelte"
	import { useWidgetContext } from "$lib/shared/widgets/context"
	import {
		openSessionState,
		sessionState
	} from "$lib/client/state/sessionState.svelte"
	import SlotControl from "./state/SlotControl.svelte"

	interface Props {
		sessionId: number | null
		session?: unknown
		channels: string[]
	}
	let { sessionId }: Props = $props()

	const store = sessionState()
	$effect(() => openSessionState(sessionId))
	const widget = useWidgetContext()
	let settings = $derived(
		(widget?.current?.settings?.v1 ?? {}) as Record<string, unknown>
	)

	let layout = $derived((settings.layout as string) ?? "strip")
	let slotsMode = $derived((settings.slots as string) ?? "all")
	let picked = $derived(
		Array.isArray(settings.pickSlots)
			? (settings.pickSlots as unknown[])
					.map((n) => String(n).trim().toLowerCase())
					.filter(Boolean)
			: []
	)

	let world = $derived(store.world)
	let slots = $derived(
		store
			.slotsFor("world")
			.filter(
				(slot) =>
					slotsMode !== "pick" ||
					picked.includes(slot.key) ||
					picked.includes(slot.label.toLowerCase())
			)
	)
</script>

<div
	class="world {layout === 'strip' ? 'world-strip' : 'world-list'}"
	data-state-widget="world-state"
	data-owner-key="world"
>
	{#if store.error}
		<p class="text-error-700-300 text-xs" role="alert">{store.error}</p>
	{/if}

	{#if !slots.length || !world}
		<div class="empty">
			<Icons.CloudSun size={16} aria-hidden="true" />
			<span>
				{store.slots.size
					? "This session's world declares no stats to show here."
					: "Nothing in this session declares world stats. A genre or an extension adds them."}
			</span>
		</div>
	{:else}
		{#each slots as slot (slot.slotId)}
			<SlotControl
				{slot}
				density={layout === "strip" ? "compact" : "full"}
				config={store.configOf("world", slot.slotId)}
				value={store.valueOf("world", slot.slotId)}
				onset={(next) =>
					store.set(
						{ kind: "session", id: world.id },
						slot.slotId,
						next
					)}
			/>
		{/each}
	{/if}
</div>

<style>
	.world {
		display: flex;
		gap: 0.35rem 0.9rem;
		padding: 0.35rem 0.5rem;
		min-width: 0;
	}
	/* A strip reads across the top of the messages and wraps rather than
	   scrolls, so no world stat is hidden behind an edge nobody drags. */
	.world-strip {
		flex-flow: row wrap;
		align-items: center;
	}
	.world-strip > :global(.slot) {
		flex: 0 1 auto;
	}
	.world-list {
		flex-direction: column;
		overflow: auto;
	}
	.empty {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.7rem;
		opacity: 0.7;
	}
</style>
