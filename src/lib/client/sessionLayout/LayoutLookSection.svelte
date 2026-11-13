<script lang="ts">
	/**
	 * The layout's own look — what backs every panel, how opaque, and the space
	 * between them (owner rulings 2026-11-05: R7 backing and opacity, R9 widget
	 * gap). The inspector shows it when no tab is chosen. A change goes out
	 * through `onChange` as one patch; the editor makes it an undoable edit.
	 */
	import type { PanelBacking, PanelGap, PanelLook } from "@serene-pub/sdk"
	import { widgetBoxStyle } from "./panelBacking"

	interface Props {
		/** The layout's look, effective (defaults filled). */
		look: PanelLook
		/** One change to the look; the editor turns it into an undoable edit. */
		onChange: (patch: Partial<PanelLook>) => void
	}

	let { look, onChange }: Props = $props()

	const uid = $props.id()

	const BACKINGS: { value: PanelBacking; label: string }[] = [
		{ value: "card", label: "Card" },
		{ value: "glass", label: "Glass" },
		{ value: "none", label: "None" }
	]
	const GAPS: { value: PanelGap; label: string }[] = [
		{ value: "tight", label: "Tight" },
		{ value: "comfortable", label: "Comfortable" },
		{ value: "spacious", label: "Spacious" }
	]
	const BEHINDS: { value: "background" | "backdrop"; label: string }[] = [
		{ value: "background", label: "Your background" },
		{ value: "backdrop", label: "The session's backdrop" }
	]
	const STYLE_VARS = [
		"--sp-widget-margin",
		"--sp-widget-background",
		"--sp-widget-radius",
		"--sp-widget-border"
	]

	/** The value shown while the slider is dragged; null when it rests. */
	let dragged = $state<number | null>(null)
	let shownOpacity = $derived(dragged ?? look.opacity)
	let behind = $derived(look.behind ?? "background")
	let draggedDim = $state<number | null>(null)
	let shownDim = $derived(draggedDim ?? look.behindDim ?? 0)

	function swatchStyle(backing: PanelBacking): string {
		return widgetBoxStyle({ backing, opacity: look.opacity }, null)
	}
</script>

<div class="lls">
	<div class="lls-field">
		<span class="lls-label" id="{uid}-backing">Backing</span>
		<div
			class="lls-swatches"
			role="radiogroup"
			aria-labelledby="{uid}-backing"
		>
			{#each BACKINGS as b (b.value)}
				<label class="lls-swatch" class:on={look.backing === b.value}>
					<input
						type="radio"
						class="lls-radio"
						name="{uid}-backing"
						value={b.value}
						checked={look.backing === b.value}
						onchange={() => onChange({ backing: b.value })}
					/>
					<span
						class="lls-chip"
						style={swatchStyle(b.value)}
						aria-hidden="true"
					></span>
					<span>{b.label}</span>
				</label>
			{/each}
		</div>
		<p class="lls-help">
			What every panel sits on. How a card and glass look comes from your
			theme.
		</p>
	</div>

	<div class="lls-field">
		<div class="lls-row">
			<label class="lls-label" for="{uid}-opacity">Opacity</label>
			<span class="lls-value">{shownOpacity}%</span>
		</div>
		<input
			id="{uid}-opacity"
			class="lls-range"
			type="range"
			min="0"
			max="100"
			step="1"
			value={look.opacity}
			oninput={(e) => (dragged = e.currentTarget.valueAsNumber)}
			onchange={(e) => {
				dragged = null
				onChange({ opacity: e.currentTarget.valueAsNumber })
			}}
		/>
		<p class="lls-help">Lower lets your background show through.</p>
	</div>

	<div class="lls-field">
		<span class="lls-label" id="{uid}-behind">Behind the panels</span>
		<div class="lls-seg" role="group" aria-labelledby="{uid}-behind">
			{#each BEHINDS as b (b.value)}
				<button
					type="button"
					class="lls-seg-btn {behind === b.value
						? 'preset-pressed'
						: 'preset-tonal-surface'}"
					aria-pressed={behind === b.value}
					onclick={() => onChange({ behind: b.value })}
				>
					{b.label}
				</button>
			{/each}
		</div>
		<p class="lls-help">What shows through behind the panels.</p>
	</div>

	{#if behind === "backdrop"}
		<div class="lls-field">
			<div class="lls-row">
				<label class="lls-label" for="{uid}-dim">Dim</label>
				<span class="lls-value">{shownDim}%</span>
			</div>
			<input
				id="{uid}-dim"
				class="lls-range"
				type="range"
				min="0"
				max="100"
				step="1"
				value={look.behindDim ?? 0}
				oninput={(e) => (draggedDim = e.currentTarget.valueAsNumber)}
				onchange={(e) => {
					draggedDim = null
					onChange({ behindDim: e.currentTarget.valueAsNumber })
				}}
			/>
			<p class="lls-help">
				Darkens the picture so the panels over it are easier to read.
			</p>
		</div>
	{/if}

	<div class="lls-field">
		<span class="lls-label" id="{uid}-gap">Widget gap</span>
		<div class="lls-seg" role="group" aria-labelledby="{uid}-gap">
			{#each GAPS as g (g.value)}
				<button
					type="button"
					class="lls-seg-btn {look.gap === g.value
						? 'preset-pressed'
						: 'preset-tonal-surface'}"
					aria-pressed={look.gap === g.value}
					onclick={() => onChange({ gap: g.value })}
				>
					{g.label}
				</button>
			{/each}
		</div>
		<p class="lls-help">The space between panels and around the zones.</p>
	</div>

	<div class="lls-field lls-authors">
		<h3 class="lls-label">For style authors</h3>
		<ul class="lls-vars">
			{#each STYLE_VARS as v (v)}
				<li><code>{v}</code></li>
			{/each}
		</ul>
	</div>
</div>

<style>
	.lls {
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
		font-size: 14px;
	}
	.lls-field {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.lls-label {
		font-size: 14px;
		font-weight: 500;
	}
	.lls-help {
		margin: 0;
		font-size: 12px;
		opacity: 0.72;
	}
	.lls-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
	}
	.lls-value {
		font-variant-numeric: tabular-nums;
		opacity: 0.8;
	}
	.lls-swatches,
	.lls-seg {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.lls-swatch {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-block-size: 32px;
		padding: 0.35rem 0.6rem;
		border-radius: 0.5rem;
		border: 1px solid
			color-mix(in oklab, var(--color-surface-500) 30%, transparent);
		cursor: pointer;
	}
	.lls-swatch.on {
		border-color: var(--color-primary-500);
	}
	.lls-swatch:focus-within {
		outline: 2px solid var(--color-primary-500);
		outline-offset: 2px;
	}
	.lls-radio {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		opacity: 0;
		margin: 0;
	}
	.lls-chip {
		inline-size: 2rem;
		block-size: 1.25rem;
		background: var(--sp-widget-background);
		border: var(--sp-widget-border);
		border-radius: min(var(--sp-widget-radius), 0.4rem);
		/* A hairline under "none", so an empty swatch still reads as a place. */
		outline: 1px dashed
			color-mix(in oklab, var(--color-surface-500) 35%, transparent);
		outline-offset: 1px;
	}
	.lls-seg-btn {
		min-block-size: 32px;
		padding: 0.35rem 0.75rem;
		border-radius: 0.5rem;
		font-size: 14px;
	}
	.lls-seg-btn:focus-visible {
		outline: 2px solid var(--color-primary-500);
		outline-offset: 2px;
	}
	.lls-range {
		inline-size: 100%;
		min-block-size: 32px;
	}
	@media (pointer: coarse) {
		.lls-swatch,
		.lls-seg-btn,
		.lls-range {
			min-block-size: 44px;
		}
	}
	.lls-authors {
		padding-block-start: 0.6rem;
		border-block-start: 1px solid
			color-mix(in oklab, var(--color-surface-500) 25%, transparent);
	}
	.lls-authors .lls-label {
		margin: 0;
		font-size: 12px;
		font-weight: 400;
		opacity: 0.72;
	}
	.lls-vars {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: 12px;
	}
</style>
