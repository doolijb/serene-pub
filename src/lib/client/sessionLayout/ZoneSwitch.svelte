<script lang="ts">
	/**
	 * The zone switch (PLAN D11): a segmented control that picks which zone —
	 * Left, Middle or Right — is drawn while the sides do not fit. One tab stop;
	 * the arrow keys move focus and select.
	 */
	import {
		ZONE_LABELS,
		rovingStep,
		sessionZones,
		type ZoneId
	} from "./sessionZones.svelte"

	let {
		zones = sessionZones,
		class: klass = ""
	}: { zones?: typeof sessionZones; class?: string } = $props()

	let group = $state<HTMLElement | null>(null)

	const stop = $derived(
		Math.max(
			0,
			zones.available.findIndex((z) => z === zones.shown)
		)
	)

	function onKey(e: KeyboardEvent, index: number) {
		const next = rovingStep(e.key, index, zones.available.length)
		if (next === null) return
		e.preventDefault()
		zones.show(zones.available[next])
		group?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus()
	}
</script>

{#if zones.switchOn}
	<div
		role="group"
		aria-label="Zone shown"
		bind:this={group}
		class="bg-surface-100-900 rounded-container flex p-0.5 {klass}"
	>
		{#each zones.available as zone, i (zone)}
			<button
				type="button"
				class="btn rounded-container min-h-11 min-w-11 px-3 {zone ===
				zones.shown
					? 'preset-pressed'
					: ''}"
				aria-pressed={zone === zones.shown}
				tabindex={i === stop ? 0 : -1}
				onclick={() => zones.show(zone as ZoneId)}
				onkeydown={(e) => onKey(e, i)}
			>
				{ZONE_LABELS[zone]}
			</button>
		{/each}
	</div>
{/if}
