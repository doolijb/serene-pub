<script lang="ts">
	interface Props {
		text?: string
	}

	let { text = "Generating" }: Props = $props()
</script>

<div class="flex items-center gap-2">
	<div class="text-surface-600-400 animate-pulse text-sm">{text}...</div>
	<div class="bg-primary-500 h-2 w-2 animate-bounce rounded-full"></div>
</div>
