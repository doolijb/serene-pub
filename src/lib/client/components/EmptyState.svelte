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

<div
	class="flex flex-col items-center gap-2 px-4 py-12 text-center"
	role="status"
>
	<Icon size={32} class="text-surface-600-400" />
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
