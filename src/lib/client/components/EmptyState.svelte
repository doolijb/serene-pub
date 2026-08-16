<script lang="ts">
	interface Props {
		icon: any
		message: string
		ctaLabel?: string
		onCta?: () => void
	}

	let { icon: Icon, message, ctaLabel, onCta }: Props = $props()
</script>

<div
	class="flex flex-col items-center gap-2 px-4 py-12 text-center"
	role="status"
>
	<Icon size={32} class="text-surface-400" />
	<p class="text-muted text-sm">{message}</p>
	{#if ctaLabel && onCta}
		<button
			type="button"
			class="btn btn-sm preset-filled-primary-500 mt-2"
			onclick={onCta}
		>
			{ctaLabel}
		</button>
	{/if}
</div>
