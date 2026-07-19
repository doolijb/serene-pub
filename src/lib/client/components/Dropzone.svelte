<script lang="ts">
	import * as Icons from "@lucide/svelte"

	interface Props {
		id: string
		accept?: string
		hint?: string
		onchange: (e: Event) => void
	}

	let { id, accept = "image/*", hint = "PNG, JPG or GIF", onchange }: Props = $props()
</script>

<div class="flex w-full items-center justify-center">
	<label
		for={id}
		class="border-surface-300-700 bg-surface-50-950 hover:bg-surface-100-900 flex w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6"
	>
		<div class="flex flex-col items-center justify-center">
			<Icons.Upload class="text-surface-700-300 mb-3 h-8 w-8" />
			<p class="text-surface-700-300 mb-2 text-sm">
				<span class="font-semibold">Click to upload</span> or drag and drop
			</p>
			<p class="text-surface-700-300 text-xs">{hint}</p>
		</div>
		<input {id} type="file" class="hidden" {accept} {onchange} />
	</label>
</div>
