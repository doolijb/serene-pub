<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { tick, type Snippet } from "svelte"
	import {
	STROKE_LIMITS,
	type Stroke,
	type StrokeKeywordsWhen,
	type StrokeKind,
	type StrokeMatchMode
} from "@serene-pub/sdk"
	import RowMenu from "$lib/client/components/menus/RowMenu.svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import KeywordChips from "$lib/client/lorebooks/editor/KeywordChips.svelte"
	import { rowDrag } from "$lib/client/lorebooks/editor/rowDrag"
	import {
		blankStroke,
		strokeFindings,
		strokesOfKind,
		strokeWithLabel,
		tokenLabel,
		whenChipText,
		whenSwitched,
		withStrokeAdded,
		withStrokeDroppedAt,
		withStrokeDuplicated,
		withStrokeMoved,
		withStrokeRemoved,
		type RowFinding,
		type WhenChoice
	} from "./strokes"

	/**
	 * 🚧 One card field — Description or Personality — as its **strokes**
	 * (plans/DESIGN-card-strokes-and-dowry-2026-10-11 §A.7): a row per stroke
	 * with a drag handle, an optional label, the text, its **When** chip, the
	 * tokens it costs and a `⋯`, then **Add stroke**.
	 *
	 * `strokes` is the WHOLE card's list, bound: this shows only `kind`'s
	 * strokes and every edit keeps the other kind's where they are. Nothing is
	 * written from here — the strokes are part of the character form's draft
	 * and go with its Save.
	 *
	 * Reorder by dragging the handle, or from the keyboard: focus the handle and
	 * press ↑ / ↓ (also in the `⋯`).
	 */
	interface Props {
		kind: StrokeKind
		/** The whole card's strokes, in order. */
		strokes: Stroke[]
		/** The field's visible name ("Description"). */
		label: string
		/** The server's last count for these `strokes` (same indexes). */
		tokens?: {
			perStroke: number[]
			perKind: { description: number; personality: number }
			model: string | null
		}
		disabled?: boolean
		/** Say every finding, the empty-text ones too (after a Save was tried). */
		revealAll?: boolean
		/** Shown beside the label (the form's "visible in prompts" badge). */
		labelExtra?: Snippet
		/** The header's **Back to one text** — the form asks and does it. */
		onBackToOneText?: () => void
	}

	let {
		kind,
		strokes = $bindable(),
		label,
		tokens,
		disabled = false,
		revealAll = false,
		labelExtra,
		onBackToOneText
	}: Props = $props()

	const uid = $props.id()

	// ── Stable row keys ───────────────────────────────────────────────────
	// A stroke has no id. Rows are keyed by the stroke object itself (the
	// form's $state proxy keeps its identity through a reorder), so focus and
	// a typed draft follow the stroke when it moves.
	const keys = new WeakMap<object, string>()
	let made = 0
	const keyOf = (s: Stroke): string => {
		let k = keys.get(s)
		if (!k) {
			k = `${uid}-s${++made}`
			keys.set(s, k)
		}
		return k
	}

	let mine = $derived(strokesOfKind(strokes, kind))
	let findings = $derived(strokeFindings(strokes))
	/** Rows whose text has been left once — an empty one is said from then on. */
	let touched = $state<Record<string, boolean>>({})
	let canAdd = $derived(strokes.length < STROKE_LIMITS.maxStrokes)
	let listFindings = $derived(findings.get(-1) ?? [])

	const rowFindings = (index: number, key: string): RowFinding[] =>
		(findings.get(index) ?? []).filter(
			(f) => f.field !== "text" || revealAll || touched[key] || strokes[index]?.text !== ""
		)

	let total = $derived(
		tokens ? tokenLabel(tokens.perKind[kind], tokens.model) : null
	)
	const strokeTokens = (index: number): string | null => {
		const n = tokens?.perStroke?.[index]
		return typeof n === "number" ? tokenLabel(n) : null
	}

	// ── Edits ─────────────────────────────────────────────────────────────

	async function focusRow(key: string, part: "handle" | "text") {
		await tick()
		document
			.querySelector<HTMLElement>(`[data-stroke-key="${key}"] [data-stroke-${part}]`)
			?.focus()
	}

	function add() {
		if (!canAdd || disabled) return
		const stroke = blankStroke(kind)
		strokes = withStrokeAdded(strokes, stroke)
		const added = strokesOfKind(strokes, kind).at(-1)?.stroke
		if (added) void focusRow(keyOf(added), "text")
	}

	function move(index: number, by: -1 | 1) {
		const key = keyOf(strokes[index])
		strokes = withStrokeMoved(strokes, index, by)
		void focusRow(key, "handle")
	}

	function remove(index: number) {
		const at = mine.findIndex((k) => k.index === index)
		strokes = withStrokeRemoved(strokes, index)
		const next = strokesOfKind(strokes, kind)
		const neighbour = next[Math.min(at, next.length - 1)]
		if (neighbour) void focusRow(keyOf(neighbour.stroke), "handle")
		else void tick().then(() => document.getElementById(`${uid}-add`)?.focus())
	}

	function duplicate(index: number) {
		strokes = withStrokeDuplicated(strokes, index)
		const copy = strokes[index + 1]
		if (copy) void focusRow(keyOf(copy), "text")
	}

	function setLabel(index: number, value: string) {
		strokes[index] = strokeWithLabel(strokes, index, value)
	}

	function setSlug(index: number, value: string) {
		const next = { ...strokes[index] }
		if (value) next.slug = value
		else delete next.slug
		strokes[index] = next
	}

	function setWhen(index: number, to: WhenChoice) {
		strokes[index].when = whenSwitched(strokes[index].when, to)
	}

	const kw = (s: Stroke): StrokeKeywordsWhen => s.when as StrokeKeywordsWhen

	function handleKeys(e: KeyboardEvent, index: number) {
		if (disabled) return
		if (e.key === "ArrowUp" || e.key === "ArrowDown") {
			e.preventDefault()
			move(index, e.key === "ArrowUp" ? -1 : 1)
		}
	}

	/** The row a press on its handle may pick up; nothing else in a row drags. */
	let armed = $state<string | null>(null)

	const WHEN_CHOICES: Array<{ value: WhenChoice; label: string }> = [
		{ value: "always", label: "Always" },
		{ value: "off", label: "Off" },
		{ value: "keywords", label: "Keywords…" }
	]

	const MATCH_OPTIONS = [
		{ value: "substring", label: "Anywhere" },
		{ value: "word", label: "Whole words" },
		{ value: "regex", label: "Regex" }
	]
</script>

<section class="flex flex-col gap-2" aria-labelledby="{uid}-label" data-stroke-list={kind}>
	<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
		<span id="{uid}-label" class="text-surface-600-400 flex items-center gap-1 text-xs">
			{label}
			{@render labelExtra?.()}
		</span>
		<span class="text-surface-600-400 text-meta" data-stroke-total>
			{mine.length} {mine.length === 1 ? "stroke" : "strokes"}{#if total}&nbsp;· {total}{/if}
		</span>
		{#if onBackToOneText}
			<button
				type="button"
				class="btn btn-sm hover:preset-tonal-surface pointer-coarse:min-h-11 ml-auto px-2 text-xs"
				{disabled}
				onclick={onBackToOneText}
				data-stroke-back
			>
				<Icons.Undo2 size={14} aria-hidden="true" />
				<span>Back to one text</span>
			</button>
		{/if}
	</div>

	{#each listFindings as f (f.message)}
		<p class="text-error-600-400 text-xs" role="alert">{f.message}</p>
	{/each}

	{#if mine.length === 0}
		<p class="text-surface-600-400 text-xs">No {label.toLowerCase()} strokes yet.</p>
	{/if}

	<ol class="flex flex-col gap-2" aria-labelledby="{uid}-label">
		{#each mine as { stroke, index }, pos (keyOf(stroke))}
			{@const key = keyOf(stroke)}
			{@const rowF = rowFindings(index, key)}
			{@const n = pos + 1}
			{@const isOff = stroke.when?.mode === "off"}
			<li
				class="bg-surface-50-950 border-surface-200-800 data-[drop-target=true]:border-primary-500 flex flex-col gap-2 rounded-lg border p-2"
				data-stroke-key={key}
				data-stroke-row={n}
				use:rowDrag={{
					key,
					draggable: armed === key && !disabled,
					canDrop: (from) => mine.some((k) => keyOf(k.stroke) === from),
					onDrop: (from) => {
						const src = mine.find((k) => keyOf(k.stroke) === from)
						if (src) strokes = withStrokeDroppedAt(strokes, src.index, index)
						armed = null
					}
				}}
				ondragend={() => (armed = null)}
			>
				<div class="flex items-start gap-1.5">
					<button
						type="button"
						class="btn-icon btn-icon-sm hover:preset-tonal-surface text-surface-600-400 pointer-coarse:size-11 mt-0.5 size-7 shrink-0 cursor-grab p-0"
						aria-label="Stroke {n} of {mine.length}. Press up or down to move it"
						aria-describedby="{uid}-move-hint"
						{disabled}
						onpointerdown={() => (armed = key)}
						onpointerup={() => (armed = null)}
						onkeydown={(e) => handleKeys(e, index)}
						data-stroke-handle
					>
						<Icons.GripVertical size={16} aria-hidden="true" />
					</button>
					<div class="flex min-w-0 flex-1 flex-col gap-1.5 {isOff ? 'opacity-70' : ''}">
						<input
							class="input preset-filled-surface-200-800 rounded-lg text-sm"
							type="text"
							placeholder="Label (optional) — e.g. Eyes"
							aria-label="Stroke {n} label"
							maxlength={STROKE_LIMITS.maxLabelChars}
							value={stroke.label ?? ""}
							oninput={(e) => setLabel(index, e.currentTarget.value)}
							{disabled}
							data-stroke-label
						/>
						<textarea
							class="input preset-filled-surface-200-800 field-sizing-content min-h-16 rounded-lg text-sm"
							rows="2"
							placeholder="What this stroke says…"
							aria-label="Stroke {n} text"
							aria-invalid={rowF.some((f) => f.field === "text") ? "true" : undefined}
							maxlength={STROKE_LIMITS.maxTextChars}
							value={stroke.text}
							oninput={(e) => (strokes[index].text = e.currentTarget.value)}
							onblur={() => (touched[key] = true)}
							{disabled}
							data-stroke-text
						></textarea>
					</div>
				</div>

				<div class="flex flex-wrap items-center gap-x-2 gap-y-1 pl-8">
					<RowMenu
						label="When stroke {n} is in the prompt"
						triggerLabel="When: {whenChipText(stroke.when)}. Change when stroke {n} is in the prompt"
						triggerClass="chip pointer-coarse:min-h-11 gap-1 text-xs {stroke.when?.mode === 'keywords'
							? 'preset-tonal-primary'
							: 'preset-tonal-surface'}"
						placement="bottom-start"
						width={200}
						{disabled}
						items={WHEN_CHOICES.map((c) => ({
							label: c.label,
							icon: stroke.when?.mode === c.value ? Icons.Check : undefined,
							onSelect: () => setWhen(index, c.value)
						}))}
					>
						{#snippet trigger()}
							<span data-stroke-when>{whenChipText(stroke.when)}</span>
							<Icons.ChevronDown size={12} aria-hidden="true" />
						{/snippet}
					</RowMenu>

					<details class="text-xs" open={rowF.some((f) => f.field === "slug") || undefined}>
						<summary class="text-surface-600-400 cursor-pointer">
							Slug{stroke.slug ? ` · ${stroke.slug}` : ""}
						</summary>
						<div class="mt-1 flex flex-col gap-1">
							<input
								class="input preset-filled-surface-200-800 w-56 max-w-full rounded-lg font-mono text-xs"
								type="text"
								aria-label="Stroke {n} slug"
								placeholder="eyes"
								spellcheck="false"
								autocomplete="off"
								value={stroke.slug ?? ""}
								oninput={(e) => setSlug(index, e.currentTarget.value)}
								{disabled}
								data-stroke-slug
							/>
							<span class="text-surface-600-400">
								How a template names it{stroke.slug ? `: character.strokes.${stroke.slug}` : ""}. It
								follows the label until you change it.
							</span>
						</div>
					</details>

					<span class="text-surface-600-400 ml-auto text-meta" data-stroke-tokens>
						{strokeTokens(index) ?? ""}
					</span>
					<RowMenu
						label="Stroke {n}"
						triggerLabel="Stroke {n} options"
						{disabled}
						items={[
							{
								label: "Move up",
								icon: Icons.ArrowUp,
								disabled: pos === 0,
								onSelect: () => move(index, -1)
							},
							{
								label: "Move down",
								icon: Icons.ArrowDown,
								disabled: pos === mine.length - 1,
								onSelect: () => move(index, 1)
							},
							{
								label: "Duplicate",
								icon: Icons.Copy,
								disabled: !canAdd,
								onSelect: () => duplicate(index)
							},
							{ separator: true },
							{
								label: "Remove",
								icon: Icons.Trash2,
								destructive: true,
								onSelect: () => remove(index)
							}
						]}
					/>
				</div>

				{#if stroke.when?.mode === "keywords"}
					<div
						class="border-surface-200-800 ml-8 flex flex-col gap-2 border-l pl-3"
						data-stroke-keywords
					>
						<KeywordChips
							bind:keys={() => kw(stroke).keys, (v) => (kw(strokes[index]).keys = v)}
							idPrefix="{uid}-{n}-"
							regex={kw(stroke).matchMode === "regex"}
							label="Keywords"
							placeholder="sea"
						/>
						<div class="flex flex-wrap items-center gap-3">
							<Select
								label="Match"
								labelHidden
								class="w-40 text-sm"
								options={MATCH_OPTIONS}
								value={kw(stroke).matchMode ?? "substring"}
								onValueChange={(v) =>
									(kw(strokes[index]).matchMode = (v || "substring") as StrokeMatchMode)}
							/>
							<label class="flex items-center gap-2 text-sm">
								<input
									class="checkbox"
									type="checkbox"
									checked={kw(stroke).caseSensitive === true}
									onchange={(e) => (kw(strokes[index]).caseSensitive = e.currentTarget.checked)}
									{disabled}
								/>
								<span>Case sensitive</span>
							</label>
						</div>
						<p class="text-surface-600-400 text-xs">
							In the prompt when a keyword appears in the recent messages.
						</p>
					</div>
				{/if}

				{#each rowF as f (f.field + f.message)}
					<p class="text-error-600-400 pl-8 text-xs" role="alert" data-stroke-finding={f.field}>
						{f.message}
					</p>
				{/each}
			</li>
		{/each}
	</ol>
	<p id="{uid}-move-hint" class="sr-only">Press up or down arrow to move the stroke.</p>

	<button
		id="{uid}-add"
		type="button"
		class="btn btn-sm preset-tonal-primary self-start"
		disabled={disabled || !canAdd}
		onclick={add}
		data-stroke-add
	>
		<Icons.Plus size={14} aria-hidden="true" />
		<span>Add stroke</span>
	</button>
	{#if !canAdd}
		<p class="text-surface-600-400 text-xs">
			A card holds at most {STROKE_LIMITS.maxStrokes} strokes.
		</p>
	{/if}
</section>
