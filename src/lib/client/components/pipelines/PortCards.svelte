<script lang="ts">
	import Badge from "$lib/client/components/Badge.svelte"
	/**
	 * The builder inspector's two cards for the selected step or agent (owner
	 * ruling 2026-10-12): **Receives** — what it takes from other steps — and
	 * **Carries out** — what it hands on, with the step's effect as a chip.
	 * Side by side when the inspector has room, stacked when it does not.
	 * The caller passes `null` for an older server's payload: no cards.
	 */
	import type { PortCardLine, PortCards } from "./settingsGroups"

	interface Props {
		cards: PortCards | null
	}

	let { cards }: Props = $props()

	const LEGEND = "text-surface-600-400 text-xs font-medium"
</script>

{#snippet lines(items: PortCardLine[], empty: string)}
	{#if items.length}
		<ul class="flex flex-col gap-1 text-sm">
			{#each items as line (line.key)}
				<li title={line.shape} data-port-line>
					{line.label}{#if line.from}{" "}<span class="text-surface-600-400"
							>from {line.from}</span
						>{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-surface-600-400 text-sm" data-port-empty>{empty}</p>
	{/if}
{/snippet}

{#if cards}
	<div class="@container/ports mb-3">
		<div class="grid grid-cols-1 gap-3 @min-[30rem]/ports:grid-cols-2">
			<section aria-label="Receives" class="panel-card flex flex-col gap-2">
				<h3 class={LEGEND}>Receives</h3>
				{@render lines(
					cards.receives,
					"Nothing from other steps: it reads the session and the event."
				)}
			</section>
			<section aria-label="Carries out" class="panel-card flex flex-col gap-2">
				<div class="flex flex-wrap items-baseline gap-2">
					<h3 class={LEGEND}>Carries out</h3>
					{#if cards.effect}
						<Badge size="md" data-effect-chip>
							{cards.effect}
						</Badge>
					{/if}
				</div>
				{@render lines(
					cards.carriesOut,
					"Nothing it writes: its result feeds the next step."
				)}
			</section>
		</div>
	</div>
{/if}
