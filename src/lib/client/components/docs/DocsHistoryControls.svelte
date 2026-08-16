<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
</script>

<div class="flex items-center gap-2">
	<button
		type="button"
		class="btn btn-sm preset-filled-surface-400-600"
		onclick={() => history.back()}
		aria-label="Back"
		title="Back"
	>
		<Icons.ChevronLeft size={16} />
	</button>
	<button
		type="button"
		class="btn btn-sm preset-filled-surface-400-600"
		onclick={() => history.forward()}
		aria-label="Forward"
		title="Forward"
	>
		<Icons.ChevronRight size={16} />
	</button>
	<button
		type="button"
		class="btn btn-sm preset-filled-surface-400-600"
		onclick={() => goto("/docs")}
		aria-label="Back to documentation index"
		title="Documentation index"
	>
		<Icons.BookOpen size={16} />
		<span class="hidden sm:inline">Index</span>
	</button>
</div>
