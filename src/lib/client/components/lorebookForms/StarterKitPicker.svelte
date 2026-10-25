<script lang="ts">
	/**
	 * 🚧 The starter lorebooks on this pub, one card each (PLAN-lorebook-kinds §B):
	 * its name, _Rules: ‹name›_, its one line, what it holds, and where it
	 * comes from (the pub, a plugin, or the admin who made it). A radio group,
	 * the way `BookRulesPicker` draws the Rules.
	 *
	 * The caller lists the kits (`starterKits:list`, with interest declared —
	 * the family is gated) because it decides whether to offer kits at all:
	 * with none listed, neither New lorebook nor the start form draws the
	 * choice. Each decides what a pick sends.
	 */
	import * as Icons from "@lucide/svelte"
	import {
		kitHoldsLine,
		kitSourceLine
	} from "$lib/client/lorebooks/starterKitCards"

	type Card = Sockets.StarterKits.Card

	interface Props {
		/** The card id chosen (`primer:…` or `book:…`); "" for none. Bindable. */
		value?: string
		/** The id of the element that names the group (its heading). */
		labelledby: string
		/** Every kit, as `starterKits:list` gave them; null while on its way. */
		kits: Card[] | null
		/** A pick, after `value` moved. */
		onpick?: (card: Card) => void
	}

	let { value = $bindable(""), labelledby, kits, onpick }: Props = $props()

	function choose(card: Card) {
		if (card.id === value) return
		value = card.id
		onpick?.(card)
	}
</script>

{#if !kits}
	<p class="text-surface-600-400 flex items-center gap-2 text-sm">
		<Icons.Loader2 size={14} class="animate-spin" aria-hidden="true" />
		Loading the starter lorebooks…
	</p>
{:else}
	<ul
		class="flex flex-col gap-1"
		role="radiogroup"
		aria-labelledby={labelledby}
		data-starter-kits
	>
		{#each kits as kit (kit.id)}
			{@const selected = value === kit.id}
			<li>
				<button
					type="button"
					role="radio"
					aria-checked={selected}
					data-starter-kit={kit.id}
					class="hover:bg-surface-200-800 flex min-h-11 w-full min-w-0 items-start gap-2.5 rounded-base px-2 py-1.5 text-left {selected
						? 'sidebar-row-active'
						: ''}"
					onclick={() => choose(kit)}
				>
					<Icons.Package
						size={18}
						class="text-surface-600-400 mt-0.5 shrink-0"
						aria-hidden="true"
					/>
					<span class="min-w-0 flex-1">
						<span class="block truncate text-lead font-medium">
							{kit.name}
						</span>
						<span class="text-surface-700-300 block text-xs">
							Rules: {kit.rulesName}
						</span>
						{#if kit.description}
							<span
								class="text-surface-600-400 line-clamp-2 block text-xs"
							>
								{kit.description}
							</span>
						{/if}
						<span class="text-surface-600-400 block text-xs">
							{kitHoldsLine(kit.counts)} · {kitSourceLine(kit)}
						</span>
					</span>
					{#if selected}
						<Icons.Check
							size={16}
							class="text-primary-500 mt-0.5 shrink-0"
							aria-hidden="true"
						/>
					{/if}
				</button>
			</li>
		{/each}
	</ul>
{/if}
