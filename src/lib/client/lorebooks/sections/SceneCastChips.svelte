<script lang="ts">
	import { getLorePoolCtx } from "./poolContext"

	/**
	 * A scene's cast, as chips.
	 *
	 * On the row and not only in the detail: the cast is the input the graph
	 * build's relationship extraction runs on, so a place read as a person or
	 * a duplicated identity has to be visible before a build consumes it.
	 * Renders nothing when the scene has no cast, so a caller can drop it in
	 * unconditionally.
	 */
	interface Props {
		scene: {
			participantCharacters?: number[] | null
			mentionedCharacters?: number[] | null
		}
	}

	let { scene }: Props = $props()

	const pool = getLorePoolCtx()

	let present = $derived(scene.participantCharacters ?? [])
	let mentioned = $derived(scene.mentionedCharacters ?? [])
</script>

{#if present.length > 0 || mentioned.length > 0}
	<div class="space-y-1">
		{#if present.length > 0}
			<div class="flex flex-wrap items-center gap-1">
				<span
					class="text-surface-600-400 shrink-0 text-xs font-semibold"
				>
					Present:
				</span>
				{#each present as id (id)}
					<span class="chip preset-tonal-primary py-0 text-[11px]">
						{pool.bindingName(id)}
					</span>
				{/each}
			</div>
		{/if}
		{#if mentioned.length > 0}
			<div class="flex flex-wrap items-center gap-1">
				<span
					class="text-surface-600-400 shrink-0 text-xs font-semibold"
				>
					Mentioned:
				</span>
				{#each mentioned as id (id)}
					<span class="chip preset-tonal-surface py-0 text-[11px]">
						{pool.bindingName(id)}
					</span>
				{/each}
			</div>
		{/if}
	</div>
{/if}
