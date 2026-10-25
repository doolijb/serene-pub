<script lang="ts">
	interface Props {
		icon: any
		message: string
		ctaLabel?: string
		onCta?: () => void
		/** A second way in, drawn tonal beside the one filled primary. */
		secondaryLabel?: string
		onSecondary?: () => void
	}

	let {
		icon: Icon,
		message,
		ctaLabel,
		onCta,
		secondaryLabel,
		onSecondary
	}: Props = $props()
</script>

<!-- A dashed card (STYLE-GUIDE §6.7, 2026-10-11): the view has a shape
     before it has data, instead of a sentence floating in 400 by 800. The
     edge is the ground's own border stop, never a signal colour — a dashed
     primary edge is the drop target's. -->
<div
	class="border-surface-200-800 flex flex-col items-center gap-3 rounded-container border border-dashed px-4 py-12 text-center"
	role="status"
>
	<Icon size={40} class="text-surface-600-400" aria-hidden="true" />
	<p class="text-surface-600-400 text-sm">{message}</p>
	{#if (ctaLabel && onCta) || (secondaryLabel && onSecondary)}
		<div class="mt-2 flex flex-wrap items-center justify-center gap-2">
			{#if ctaLabel && onCta}
				<button
					type="button"
					class="btn btn-sm preset-filled-primary-500"
					onclick={onCta}
				>
					{ctaLabel}
				</button>
			{/if}
			{#if secondaryLabel && onSecondary}
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					onclick={onSecondary}
				>
					{secondaryLabel}
				</button>
			{/if}
		</div>
	{/if}
</div>
