<script lang="ts">
	/**
	 * The confirmation of a move between the seat groups, built into the row
	 * under its "Played by" control: one sentence, **Move** (records the move
	 * until Save) and **Cancel**, then a quiet line while a move is held. Focus
	 * returns to the row's control either way.
	 */
	import { tick } from "svelte"
	import type { PlayedByChoice } from "./editSessionForm"

	interface Props {
		move: NonNullable<PlayedByChoice["move"]>
		onMove: () => void
		onCancel: () => void
	}

	let { move, onMove, onCancel }: Props = $props()

	const act = async (e: MouseEvent, run: () => void) => {
		const wrap = (e.currentTarget as HTMLElement).closest(".basis-full")
		run()
		await tick()
		wrap?.querySelector<HTMLInputElement>('input[role="combobox"]')?.focus()
	}
</script>

{#if move.sentence}
	<div
		class="bg-surface-100-900 rounded-base mt-2 flex flex-wrap items-center gap-2 p-2"
		role="group"
		aria-label="Move {move.name}"
	>
		<p class="min-w-0 basis-full text-sm">{move.sentence}</p>
		<button
			type="button"
			class="btn btn-sm preset-tonal-primary"
			aria-label="Move {move.name}"
			onclick={(e) => act(e, onMove)}
		>
			Move
		</button>
		<button
			type="button"
			class="btn btn-sm preset-tonal-surface"
			aria-label="Cancel moving {move.name}"
			onclick={(e) => act(e, onCancel)}
		>
			Cancel
		</button>
	</div>
{:else if move.drafted}
	<p class="text-surface-600-400 mt-1 text-xs">Moves on Save</p>
{/if}
