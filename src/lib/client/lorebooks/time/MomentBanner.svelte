<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { momentBannerSentence, poolAsOfSentence } from "./moment"

	/**
	 * What an edit made while reading as of a date is saved as.
	 *
	 * It stands over the editor rather than inside it, because the fact is
	 * about the moment being read and not about the row being edited. The
	 * sentence says the whole of it: the write lands on the entry itself, and
	 * an amendment dated at this moment is a shape the book does not hold.
	 */
	interface Props {
		/** The moment being read. The banner is drawn only while there is one. */
		moment: string
		/** The pool at this moment, when the workspace has counted it. */
		pool?: { total: number; notYet: number } | null
		onReturnToNow: () => void
	}

	let { moment, pool = null, onReturnToNow }: Props = $props()
</script>

<div
	class="preset-tonal-warning flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-xs"
	data-lore-moment-banner
>
	<Icons.History size={14} class="shrink-0" aria-hidden="true" />
	<span class="min-w-0 flex-1">
		{momentBannerSentence(moment)}
		{#if pool}
			<span class="block opacity-80" data-lore-moment-pool>
				{poolAsOfSentence(pool.total, pool.notYet)}
			</span>
		{/if}
	</span>
	<button
		type="button"
		class="btn btn-sm preset-tonal-surface shrink-0"
		onclick={onReturnToNow}
	>
		Return to now
	</button>
</div>
