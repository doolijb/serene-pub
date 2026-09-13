<script lang="ts">
	/**
	 * The Stats widget: one card per cast member, one row per slot they carry.
	 *
	 * Values come from the session's one resolved read (`sessionState`), so this
	 * panel never resolves anything itself — which layer a number came from is a
	 * question for the cast member's page, not for the playing surface. What it
	 * does own is the drawing: a bounded integer is a bar, an enum a chip, text a
	 * line, a boolean a toggle, and a derived slot is greyed because there is
	 * nothing to write.
	 *
	 * A genre that declares no slots gets an empty state that says so rather than
	 * a card of blanks — a newcomer in a chat session never sees a bar.
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

	let membersMode = $derived((settings.members as string) ?? "scene")
	let density = $derived((settings.density as "compact" | "full") ?? "full")
	let slotsMode = $derived((settings.slots as string) ?? "all")

	const names = (raw: unknown): string[] =>
		Array.isArray(raw)
			? raw.map((n) => String(n).trim().toLowerCase()).filter(Boolean)
			: []

	let pickedMembers = $derived(names(settings.pickMembers))
	let pickedSlots = $derived(names(settings.pickSlots))

	let members = $derived(
		store.cast.filter((owner) => {
			if (membersMode === "all") return true
			if (membersMode === "pick")
				return (
					pickedMembers.includes(owner.label.toLowerCase()) ||
					pickedMembers.includes(owner.key)
				)
			// Scene: whoever has state in play. A member nobody has given a
			// value to has nothing to show, and an empty card is not a stat.
			return store.hasAnyValue(owner.key)
		})
	)

	const shownSlots = (ownerKey: string) =>
		store
			.slotsFor(ownerKey)
			.filter(
				(slot) =>
					slotsMode !== "pick" ||
					pickedSlots.includes(slot.key) ||
					pickedSlots.includes(slot.label.toLowerCase())
			)

	let declaresAny = $derived(store.slots.size > 0)
</script>

<div
	class="flex h-full flex-col gap-2 overflow-auto p-2"
	data-state-widget="stats"
>
	{#if store.error}
		<p class="text-error-700-300 text-xs" role="alert">{store.error}</p>
	{/if}

	{#if !declaresAny}
		<div class="empty">
			<Icons.HeartPulse size={20} aria-hidden="true" />
			<span>
				Nothing in this session declares stats. A genre, an extension or
				an administrator adds them, and they show up here.
			</span>
		</div>
	{:else if !members.length}
		<div class="empty">
			<Icons.HeartPulse size={20} aria-hidden="true" />
			<span>
				{membersMode === "pick"
					? "No cast member matches the names in this widget's settings."
					: "No one in the cast has a stat in play yet. Set one on a cast member's page, or let the story change one."}
			</span>
		</div>
	{:else}
		{#each members as owner (owner.key)}
			{@const slots = shownSlots(owner.key)}
			<section class="card-stat" data-owner-key={owner.key}>
				<header class="card-stat-head">
					<Icons.UserRound size={13} aria-hidden="true" />
					<span class="truncate font-semibold">{owner.label}</span>
				</header>
				{#if !slots.length}
					<p class="text-surface-500 text-xs">
						No stats to show for this member.
					</p>
				{:else}
					<div
						class="card-stat-body"
						class:compact={density === "compact"}
					>
						{#each slots as slot (slot.slotId)}
							<SlotControl
								{slot}
								{density}
								config={store.configOf(owner.key, slot.slotId)}
								value={store.valueOf(owner.key, slot.slotId)}
								onset={(next) =>
									store.set(
										{ kind: "session_cast", id: owner.id },
										slot.slotId,
										next
									)}
							/>
						{/each}
					</div>
				{/if}
			</section>
		{/each}
	{/if}
</div>

<style>
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		height: 100%;
		padding: 0.75rem;
		text-align: center;
		font-size: 0.72rem;
		opacity: 0.7;
	}
	.card-stat {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding: 0.45rem 0.55rem;
		border-radius: 0.5rem;
		background: color-mix(in oklab, currentColor 6%, transparent);
	}
	.card-stat-head {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.76rem;
		min-width: 0;
	}
	.card-stat-body {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	/* Compact packs the rows across the card instead of down it; the card's own
	   width decides how many fit, so a narrow column still reads as a list. */
	.card-stat-body.compact {
		flex-direction: row;
		flex-wrap: wrap;
		gap: 0.15rem 0.7rem;
	}
	.card-stat-body.compact > :global(.slot) {
		flex: 1 1 9rem;
	}
</style>
