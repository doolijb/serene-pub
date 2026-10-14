<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import type { Snippet } from "svelte"
	import { compileStrokes, type Stroke, type StrokeKind } from "@serene-pub/sdk"
	import StrokeList from "./StrokeList.svelte"
	import SplitStrokesDialog from "./SplitStrokesDialog.svelte"
	import { hasKind, withKindStarted, withSplitApplied } from "./strokes"
	import { STROKES_ENABLED } from "$lib/shared/characters/strokesFlag"

	/**
	 * 🚧 A card field that may be painted in strokes (DESIGN-card-strokes
	 * §A.7): the field's own textarea while it is one text, with **Split into
	 * strokes…** under it; its `StrokeList` once it has strokes, with the
	 * read-only *What the model reads when nothing has fired* fold.
	 *
	 * One field at a time: splitting Description leaves Personality a textarea
	 * until it is split too or a stroke is added to it.
	 *
	 * Strokes paused (`STROKES_ENABLED` off): the textarea alone — no Split,
	 * no Add stroke, no list even when the card has strokes (the textarea then
	 * holds the stored compiled prose, and a save of it clears the strokes).
	 */
	interface Props {
		kind: StrokeKind
		label: string
		strokes: Stroke[]
		/** The field's text — what the textarea edits while it has no strokes. */
		prose: string
		tokens?: {
			perStroke: number[]
			perKind: { description: number; personality: number }
			model: string | null
		}
		revealAll?: boolean
		labelExtra?: Snippet
		/** The field as one text: the form's own textarea (with its label). */
		textarea: Snippet
		onBackToOneText: () => void
	}

	let {
		kind,
		label,
		strokes = $bindable(),
		prose,
		tokens,
		revealAll = false,
		labelExtra,
		textarea,
		onBackToOneText
	}: Props = $props()

	let splitOpen = $state(false)
	let painted = $derived(hasKind(strokes, kind))
	let cardHasStrokes = $derived(strokes.length > 0)
	let fallback = $derived(painted ? compileStrokes(strokes, kind, { firedOnly: true }) : null)
</script>

{#if !STROKES_ENABLED}
	{@render textarea()}
{:else if painted}
	<div class="flex flex-col gap-2">
		<StrokeList
			{kind}
			{label}
			bind:strokes
			{tokens}
			{revealAll}
			{labelExtra}
			{onBackToOneText}
		/>
		<details class="text-xs" data-stroke-compiled>
			<summary class="text-surface-600-400 cursor-pointer">
				What the model reads when nothing has fired
			</summary>
			{#if fallback}
				<p
					class="bg-surface-100-900 border-surface-200-800 text-surface-800-200 mt-1.5 rounded-lg border p-2 text-sm whitespace-pre-wrap"
				>
					{fallback}
				</p>
			{:else}
				<p class="text-surface-600-400 mt-1.5">
					Nothing — every stroke here is off or waits for a keyword.
				</p>
			{/if}
		</details>
	</div>
{:else}
	<div class="flex flex-col">
		{@render textarea()}
		<div class="mt-1.5 flex flex-wrap items-center gap-2">
			<button
				type="button"
				class="btn btn-sm hover:preset-tonal-surface pointer-coarse:min-h-11 px-2 text-xs"
				disabled={!prose.trim()}
				title={prose.trim()
					? `Break the ${label.toLowerCase()} into pieces you can show always, never, or only when a keyword comes up.`
					: "Write something to split first"}
				onclick={() => (splitOpen = true)}
				data-stroke-split={kind}
			>
				<Icons.Scissors size={14} aria-hidden="true" />
				<span>Split into strokes…</span>
			</button>
			{#if cardHasStrokes}
				<button
					type="button"
					class="btn btn-sm hover:preset-tonal-surface pointer-coarse:min-h-11 px-2 text-xs"
					onclick={() => (strokes = withKindStarted(strokes, kind, prose))}
					data-stroke-start={kind}
				>
					<Icons.Plus size={14} aria-hidden="true" />
					<span>Add stroke</span>
				</button>
			{/if}
		</div>
	</div>
	<SplitStrokesDialog
		bind:open={splitOpen}
		{kind}
		{label}
		text={prose}
		onSplit={(split) => (strokes = withSplitApplied(strokes, kind, split))}
	/>
{/if}
