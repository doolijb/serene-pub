<script lang="ts">
	/**
	 * 🚧 Said by a review screen that saves into a lorebook, before any work,
	 * when this person's lore write mode is Off (plan A22): the save would be
	 * refused, and here is where the setting lives.
	 */
	import * as Icons from "@lucide/svelte"
	import { LORE_WRITES_OFF_NOTICE } from "$lib/shared/lorebooks/loreWriteMode"
</script>

<div
	class="border-warning-500/40 bg-warning-500/10 flex items-start gap-2 rounded-lg border p-3 text-sm"
	role="note"
>
	<Icons.TriangleAlert size={16} class="text-warning-500 mt-0.5 shrink-0" aria-hidden="true" />
	<span>{LORE_WRITES_OFF_NOTICE}</span>
</div>
