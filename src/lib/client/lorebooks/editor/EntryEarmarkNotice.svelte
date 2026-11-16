<script lang="ts">
	import * as Icons from "@lucide/svelte"

	interface Props {
		/** The server's sentence. */
		notice: string
		/** An ask is on its way. */
		checking: boolean
		onCheck: () => void
	}

	let { notice, checking, onCheck }: Props = $props()
</script>

<div
	class="text-surface-700-300 flex flex-wrap items-center gap-2 text-xs"
	role="status"
	data-entry-earmark-notice
>
	<Icons.Clock size={14} class="shrink-0" aria-hidden="true" />
	<span class="min-w-0 flex-1">{notice}</span>
	<button
		class="btn btn-sm preset-tonal shrink-0"
		type="button"
		onclick={onCheck}
		disabled={checking}
	>
		Check again
	</button>
</div>
