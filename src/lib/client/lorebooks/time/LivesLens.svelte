<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import type { Presence } from "$lib/shared/lorebooks/presence"
	import type { StoryDate } from "$lib/shared/lorebooks/storyDate"
	import type { Line } from "$lib/shared/lorebooks/lineReading"
	import { formatDate } from "../sections/historyDates"
	import { buildAxis, pinMarksOf } from "./livesLens"

	/**
	 * The weave: every placed life, drawn against the story's own line.
	 *
	 * The one drawing this design needed and no existing lens gives. Time draws
	 * what happened; Lives draws who was there for it — and it is the only
	 * place two of one person are visible as two, because a roster can only
	 * say "also here" while a line can show the overlap.
	 *
	 * ⚠ Only PLACED members get a lane. Someone the book has never placed is in
	 * the world at every moment, which is a fact about all of time and nothing
	 * a line can draw; the World bar's roster already lists them. A full-width
	 * bar per undated member would bury the two or three lives that were
	 * actually placed.
	 */
	interface Props {
		members: readonly { id: number; name: string }[]
		presences: readonly Presence[]
		/** Every dated thing the book knows, so a life is placed against events. */
		pins: readonly StoryDate[]
		moment?: StoryDate | null
		/** The line being read, ancestor chain and fork cuts included. */
		line: Line
		onOpenMember: (castId: number) => void
	}

	let { members, presences, pins, moment, line, onOpenMember }: Props =
		$props()

	let axis = $derived(buildAxis(members, presences, pins, { moment, line }))
	let pinMarks = $derived(pinMarksOf(pins, axis))
	const pct = (n: number) => `${n * 100}%`
</script>

<section class="flex min-h-0 flex-1 flex-col gap-3" data-lore-lives>
	{#if !axis.lanes.length}
		<div
			class="text-surface-700-300 flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center"
		>
			<Icons.Footprints size={22} aria-hidden="true" />
			<p class="max-w-md text-sm leading-relaxed">
				Nobody has been placed on the line yet. Say when a cast member
				is in the world — and at what point of their own life — and
				their run appears here.
			</p>
			<p class="text-surface-600-400 max-w-md text-xs leading-relaxed">
				Place the same person twice and you get two runs: a life
				crossing its own story.
			</p>
		</div>
	{:else}
		<!-- The events, so a life has something to be legible against. -->
		<div class="relative h-6 shrink-0">
			<div class="bg-surface-300-700 absolute inset-x-0 top-3 h-px"></div>
			{#each pinMarks as mark (mark.key)}
				<span
					class="bg-warning-500 absolute top-[0.4rem] size-2 -translate-x-1/2 rotate-45"
					style="left: {mark.left}%"
					title={formatDate(mark.date)}
				></span>
			{/each}
			{#if axis.cursor !== null}
				<span
					class="bg-primary-500 absolute -top-1 bottom-0 w-0.5 -translate-x-1/2"
					style="left: {pct(axis.cursor)}"
				></span>
			{/if}
		</div>

		<div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
			{#each axis.lanes as lane (lane.castId)}
				<div class="flex items-center gap-3">
					<button
						class="hover:preset-tonal-surface w-28 shrink-0 truncate rounded-[7px] px-2 py-1 text-left text-xs"
						type="button"
						onclick={() => onOpenMember(lane.castId)}
					>
						{lane.name}
					</button>
					<div
						class="bg-surface-100-900 relative h-8 flex-1 rounded-[8px]"
					>
						{#each lane.runs as run (run.presenceId)}
							<!-- A run is a stretch of world time this version of
							     them stood in. Two that overlap are two people. -->
							<div
								class="absolute inset-y-1 rounded-[6px] {lane.doubled
									? 'preset-tonal-primary'
									: 'preset-tonal-surface'} flex items-center overflow-hidden px-2"
								style="left: {pct(run.from)}; width: {pct(
									Math.max(run.to - run.from, 0.015)
								)}"
								title={run.note ?? `at ${run.personalPosition}`}
							>
								<span class="truncate text-[11px]">
									{run.personalPosition}
								</span>
							</div>
						{/each}
						{#if axis.cursor !== null}
							<span
								class="bg-primary-500/70 absolute inset-y-0 w-0.5 -translate-x-1/2"
								style="left: {pct(axis.cursor)}"
							></span>
						{/if}
					</div>
					{#if lane.doubled}
						<span
							class="chip preset-tonal-primary shrink-0 text-[11px]"
						>
							two of them
						</span>
					{/if}
				</div>
			{/each}
		</div>

		<p class="text-surface-600-400 shrink-0 text-xs leading-relaxed">
			A bar is one version of someone standing in the world. Where two
			bars on a lane overlap, that person is in the story twice at once.
		</p>
	{/if}
</section>
