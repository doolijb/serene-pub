<script lang="ts">
	import type { EntryRowProps } from "./types"
	import CastAvatar from "../cast/CastAvatar.svelte"

	/**
	 * A cast member as a row of Everything (note 12): their face, name and
	 * summary, with the Cast badge every other kind's chip spells the same
	 * way. Choosing the row opens the Cast board, where a member is edited.
	 */
	let { item, source }: EntryRowProps = $props()

	let kind = $derived(
		(source?.castKind as "character" | "persona" | "background") ??
			"background"
	)
	let summary = $derived(String(source?.summary ?? ""))
</script>

<div class="flex min-w-0 items-start gap-3" data-cast-pool-row={item.id}>
	<CastAvatar
		name={item.name}
		{kind}
		src={source?.avatar as string | undefined}
	/>
	<div class="flex min-w-0 flex-1 flex-col gap-1">
		<div class="flex flex-wrap items-center gap-2 text-sm font-semibold">
			<span class="min-w-[10ch] flex-1 truncate">{item.name}</span>
			<span class="badge preset-tonal-surface shrink-0 text-[11px]">
				Cast
			</span>
		</div>
		{#if summary.trim()}
			<p
				class="text-surface-600-400 line-clamp-2 text-xs leading-relaxed"
			>
				{summary}
			</p>
		{/if}
	</div>
</div>
