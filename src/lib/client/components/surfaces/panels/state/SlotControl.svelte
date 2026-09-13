<script lang="ts">
	/**
	 * One attribute slot, drawn as what it is and edited in place.
	 *
	 * The slot's TYPE decides the control, and the configuration in force
	 * decides its bounds: a bounded integer is a bar, an enum is a chip over a
	 * closed set, text is a line, a boolean is a toggle. A derived slot is
	 * computed on every read and has no value to set, so it is shown and never
	 * offered.
	 *
	 * Every edit here is the USER's, which is the one writer with authority: it
	 * applies immediately (`state:set`) rather than waiting at the review gate,
	 * because the gate exists for the writer who has none. Nothing is applied
	 * optimistically — the write answers with the whole resolved state, so what
	 * is drawn a beat later is the resolver's answer and not this component's
	 * guess.
	 */
	import * as Icons from "@lucide/svelte"
	import {
		barView,
		clampToBounds,
		formatSlotValue
	} from "$lib/shared/state/barMath"

	interface Props {
		slot: Sockets.State.SlotDescriptor
		/** The configuration in force for this owner: bounds, enum options. */
		config: Record<string, unknown>
		value: unknown
		/** Compact drops the label into the control's own line. */
		density?: "compact" | "full"
		/** `null` clears this layer, so the read inherits again. */
		onset: (value: number | string | boolean | null) => void
	}

	let { slot, config, value, density = "full", onset }: Props = $props()

	let editing = $state(false)
	let draft = $state("")

	let bar = $derived(barView(value, config as { min?: number; max?: number }))
	let options = $derived(
		Array.isArray((config as { of?: unknown }).of)
			? ((config as { of: string[] }).of ?? [])
			: []
	)
	let readOnly = $derived(slot.type === "derived")
	let shown = $derived(value === undefined ? "" : formatSlotValue(value))

	function open() {
		if (readOnly) return
		draft = value === undefined || value === null ? "" : String(value)
		editing = true
	}

	function commitNumber() {
		editing = false
		const n = Number(draft)
		if (draft.trim() === "") return onset(null)
		if (!Number.isFinite(n)) return
		onset(clampToBounds(Math.trunc(n), config as { min?: number }))
	}

	function commitText() {
		editing = false
		onset(draft.trim() === "" ? null : draft)
	}

	function onkeydown(e: KeyboardEvent, commit: () => void) {
		if (e.key === "Enter") {
			e.preventDefault()
			commit()
		} else if (e.key === "Escape") {
			e.preventDefault()
			editing = false
		}
	}
</script>

<div
	class="slot {density === 'compact' ? 'slot-compact' : ''}"
	data-slot-id={slot.slotId}
	data-slot-type={slot.type}
>
	<span class="slot-label" title={slot.description ?? slot.label}>
		{slot.label}
		{#if readOnly}
			<Icons.Sigma size={10} aria-hidden="true" />
		{/if}
	</span>

	<div class="slot-control">
		{#if slot.type === "boolean" && !readOnly}
			<button
				class="chip {value === true ? 'chip-on' : ''}"
				aria-pressed={value === true}
				onclick={() => onset(value === true ? false : true)}
			>
				{value === undefined ? "not set" : formatSlotValue(value)}
			</button>
		{:else if editing && slot.type === "enum"}
			<select
				class="select slot-field"
				aria-label="{slot.label} value"
				value={value == null ? "" : String(value)}
				onchange={(e) => {
					editing = false
					const next = e.currentTarget.value
					onset(next === "" ? null : next)
				}}
				onblur={() => (editing = false)}
			>
				<option value="">not set</option>
				{#each options as option (option)}
					<option value={option}>{option}</option>
				{/each}
			</select>
		{:else if editing && slot.type === "integer"}
			<input
				class="input slot-field"
				type="number"
				aria-label="{slot.label} value"
				min={(config as { min?: number }).min}
				max={(config as { max?: number }).max}
				step="1"
				bind:value={draft}
				onblur={commitNumber}
				onkeydown={(e) => onkeydown(e, commitNumber)}
			/>
		{:else if editing}
			<input
				class="input slot-field"
				type="text"
				aria-label="{slot.label} value"
				maxlength={(config as { maxLength?: number }).maxLength}
				bind:value={draft}
				onblur={commitText}
				onkeydown={(e) => onkeydown(e, commitText)}
			/>
		{:else if bar}
			<button
				class="bar"
				disabled={readOnly}
				aria-label="{slot.label} {bar.label}, edit"
				onclick={open}
			>
				<span class="bar-track">
					<span class="bar-fill" style:width="{bar.percent}%"></span>
				</span>
				<span class="bar-label">{bar.label}</span>
			</button>
		{:else if slot.type === "enum"}
			<button
				class="chip {value == null ? 'chip-empty' : ''}"
				disabled={readOnly}
				aria-label="{slot.label}, edit"
				onclick={open}
			>
				{shown || "not set"}
			</button>
		{:else}
			<button
				class="line {value === undefined ? 'chip-empty' : ''}"
				disabled={readOnly}
				aria-label="{slot.label}, edit"
				onclick={open}
			>
				{shown || "not set"}
			</button>
		{/if}
	</div>
</div>

<style>
	.slot {
		display: grid;
		grid-template-columns: minmax(4.5rem, 7rem) minmax(0, 1fr);
		align-items: center;
		gap: 0.4rem;
		font-size: 0.74rem;
	}
	.slot-compact {
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.3rem;
		font-size: 0.68rem;
	}
	.slot-label {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		opacity: 0.7;
	}
	.slot-control {
		min-width: 0;
	}
	.slot-field {
		width: 100%;
		font-size: inherit;
		padding-block: 0.1rem;
	}
	/* A bar is a button so it is reachable by keyboard and says what it holds;
	   the fill is decoration over the label, never instead of it. */
	.bar {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		width: 100%;
		text-align: left;
	}
	.bar-track {
		position: relative;
		flex: 1;
		min-width: 2rem;
		height: 0.55rem;
		border-radius: 999px;
		background: color-mix(in oklab, currentColor 16%, transparent);
		overflow: hidden;
	}
	.bar-fill {
		position: absolute;
		inset-block: 0;
		inset-inline-start: 0;
		border-radius: 999px;
		background: color-mix(in oklab, currentColor 62%, transparent);
	}
	.bar-label {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.chip,
	.line {
		display: inline-flex;
		align-items: center;
		max-width: 100%;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: color-mix(in oklab, currentColor 12%, transparent);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.line {
		border-radius: 0.3rem;
		background: transparent;
		padding-inline: 0.1rem;
	}
	.chip-on {
		background: color-mix(in oklab, currentColor 30%, transparent);
	}
	/* Absent is not zero: an unset slot reads as unset, never as a value. */
	.chip-empty {
		opacity: 0.45;
		font-style: italic;
	}
	.bar:hover:not(:disabled),
	.chip:hover:not(:disabled),
	.line:hover:not(:disabled) {
		filter: brightness(1.15);
	}
	/* A derived slot is computed on every read; there is nothing to write. */
	button:disabled {
		opacity: 0.55;
		cursor: default;
	}
</style>
