<script lang="ts">
	/**
	 * 🚧 The shared **voice picker** (speech build, lane E1). Draws a
	 * `PickerVoice[]` — a model's own voices off its speech facts, or the
	 * pub's voicebank entries — and writes the chosen `key` to `value`.
	 *
	 * Pickers explain why (STYLE-GUIDE §6.6): one lede sentence saying what
	 * the choice decides, one origin line, the chosen value ABOVE the list,
	 * the find row (filter box, facet chips, "N of M"), radio rows with
	 * **In use** / **Use**. Inline (not a dialog): the card's Voice section
	 * and the voicebank editor both embed it.
	 *
	 * Previews play through a plain `Audio`; one at a time, stopped on unmount.
	 */
	import { onDestroy } from "svelte"
	import * as Icons from "@lucide/svelte"
	import PanelFilterInput from "$lib/client/components/panels/PanelFilterInput.svelte"
	import FieldHelp from "$lib/client/components/FieldHelp.svelte"
	import Badge from "$lib/client/components/Badge.svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import {
		filterVoices,
		COMPACT_NONE,
		compactOptions,
		labelLine,
		originLine,
		voiceFacets,
		type PickerVoice,
		type VoiceFilter,
		type VoiceListOrigin
	} from "./voicePicker"

	interface Props {
		voices: PickerVoice[]
		/** The chosen key, or null for "no pick" / the `none` row. */
		value: string | null
		onchange?: (key: string | null) => void
		/** One muted sentence: what the choice decides. */
		lede: string
		origin?: VoiceListOrigin
		/** An explicit "no pick" row (e.g. Pub default). */
		none?: { label: string; consequence: string }
		/** `SpeechFacts.notice`, e.g. "Powered by KittenML". */
		notice?: string
		/** ⏳ The service's shutdown date, when it has announced one. */
		deprecatedOn?: string
		/** A "Type a voice id" row, for lists the service cannot give. */
		allowTyped?: boolean
		/** Absent: no button (there is no synthesis socket yet). */
		tryLine?: {
			label?: string
			onTry: (key: string) => void
			busy?: boolean
			disabledReason?: string
		}
		disabled?: boolean
		readonlyReason?: string
		/** Shown when the list is empty. */
		emptyText?: string
		/**
		 * One closed select instead of the open list: for a row among rows (an
		 * envoy, the narrator). The `none` row's consequence stays as one
		 * muted line. `label` names the select for a screen reader.
		 */
		compact?: boolean
		label?: string
	}

	let {
		voices,
		value = $bindable(null),
		onchange,
		lede,
		origin,
		none,
		notice,
		deprecatedOn,
		allowTyped = false,
		tryLine,
		disabled = false,
		readonlyReason,
		emptyText = "No voices known. An administrator can Refresh the model's voices.",
		compact = false,
		label = "Voice"
	}: Props = $props()

	let query = $state("")
	let filter = $state<VoiceFilter>({})
	let typed = $state("")
	let playingKey = $state<string | null>(null)
	let audio: HTMLAudioElement | null = null

	const locked = $derived(disabled || !!readonlyReason)
	const facets = $derived(voiceFacets(voices))
	const shown = $derived(filterVoices(voices, query, filter))
	const chosen = $derived(
		value == null ? null : (voices.find((v) => v.key === value) ?? null)
	)
	const filtering = $derived(
		!!query.trim() || Object.values(filter).some((x) => !!x)
	)

	function pick(key: string | null) {
		if (locked || key === value) return
		value = key
		onchange?.(key)
	}

	function toggleFacet(key: keyof VoiceFilter, v: string) {
		filter = { ...filter, [key]: filter[key] === v ? undefined : v }
	}

	function stop() {
		if (audio) {
			audio.pause()
			audio = null
		}
		playingKey = null
	}

	function preview(v: PickerVoice) {
		if (!v.previewUrl) return
		if (playingKey === v.key) return stop()
		stop()
		const a = new Audio(v.previewUrl)
		audio = a
		playingKey = v.key
		a.addEventListener("ended", () => {
			if (audio === a) stop()
		})
		a.addEventListener("error", () => {
			if (audio === a) stop()
		})
		a.play().catch(() => {
			if (audio === a) stop()
		})
	}

	onDestroy(stop)

	const tryDisabled = $derived(
		!tryLine || tryLine.busy || !!tryLine.disabledReason || value == null
	)
</script>

{#if compact}
	<div class="flex min-w-0 flex-col gap-1" data-testid="voice-picker-compact">
		{#if voices.length === 0 && !none}
			<p class="text-xs text-surface-600-400">{emptyText}</p>
		{:else}
			<Select
				{label}
				labelHidden
				options={compactOptions(voices, value, none)}
				value={value ?? (none ? COMPACT_NONE : undefined)}
				disabled={locked}
				onValueChange={(v) => pick(v === COMPACT_NONE || v === "" ? null : v)}
			/>
			{#if value == null && none?.consequence}
				<FieldHelp>{none.consequence}</FieldHelp>
			{:else if readonlyReason}
				<FieldHelp>{readonlyReason}</FieldHelp>
			{:else}
				<FieldHelp>{lede}</FieldHelp>
			{/if}
		{/if}
	</div>
{:else}
<div class="flex flex-col gap-2">
	<p class="text-xs text-surface-600-400">{lede}</p>
	{#if originLine(origin)}
		<p class="text-xs text-surface-600-400">{originLine(origin)}</p>
	{/if}
	{#if notice || deprecatedOn}
		<div class="flex flex-wrap items-center gap-2 text-xs">
			{#if notice}<span class="text-surface-600-400">{notice}</span>{/if}
			{#if deprecatedOn}
				<Badge size="md" title="The service has announced a shutdown date.">Shuts down {deprecatedOn}</Badge>
			{/if}
		</div>
	{/if}
	{#if readonlyReason}
		<p class="text-xs text-surface-600-400">{readonlyReason}</p>
	{/if}

	<!-- The chosen value, above the list. -->
	<div
		class="rounded-lg border border-surface-300-700 bg-surface-50-950 px-3 py-2"
		aria-live="polite"
	>
		<div class="text-xs text-surface-600-400">Chosen</div>
		{#if chosen}
			<div class="text-sm font-medium">{chosen.name}</div>
			{#if labelLine(chosen)}
				<div class="text-xs text-surface-600-400">{labelLine(chosen)}</div>
			{/if}
		{:else if value != null}
			<div class="text-sm font-medium">{value}</div>
			<div class="text-xs text-surface-600-400">
				Not in the list above; kept as typed.
			</div>
		{:else if none}
			<div class="text-sm font-medium">{none.label}</div>
			<div class="text-xs text-surface-600-400">{none.consequence}</div>
		{:else}
			<div class="text-sm text-surface-600-400">Nothing chosen yet.</div>
		{/if}
	</div>

	{#if voices.length === 0 && !none && !allowTyped}
		<p class="rounded-lg border border-dashed border-surface-300-700 p-3 text-sm text-surface-600-400">
			{emptyText}
		</p>
	{:else}
		{#if voices.length > 6 || facets.length}
			<div class="flex flex-col gap-2">
				<PanelFilterInput
					bind:value={query}
					placeholder="voices"
					count={voices.length}
					singular="voice"
					aria-label="Filter voices"
				/>
				{#if facets.length}
					<div class="flex flex-col gap-1">
						{#each facets as facet (facet.key)}
							<div
								class="flex flex-wrap items-center gap-1"
								role="group"
								aria-label={facet.label}
							>
								<span class="w-16 text-xs text-surface-600-400">{facet.label}</span>
								{#each facet.values as fv (fv.value)}
									<button
										type="button"
										class="btn btn-sm {filter[facet.key] === fv.value
											? 'preset-pressed'
											: 'preset-tonal-surface'}"
										aria-pressed={filter[facet.key] === fv.value}
										onclick={() => toggleFacet(facet.key, fv.value)}
									>
										{fv.value} <span class="opacity-70">{fv.count}</span>
									</button>
								{/each}
							</div>
						{/each}
					</div>
				{/if}
				<div class="text-xs text-surface-600-400" aria-live="polite">
					{shown.length} of {voices.length}
					{#if filtering}
						·
						<button
							type="button"
							class="underline"
							onclick={() => {
								query = ""
								filter = {}
							}}>Clear filters</button
						>
					{/if}
				</div>
			</div>
		{/if}

		<div
			class="flex max-h-72 flex-col gap-1 overflow-y-auto"
			role="radiogroup"
			aria-label="Voices"
		>
			{#if none}
				<div class="shrink-0">
					<button
						type="button"
						role="radio"
						aria-checked={value == null}
						disabled={locked}
						class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left {value ==
						null
							? 'sidebar-row-active'
							: 'hover:bg-surface-200-800'}"
						onclick={() => pick(null)}
					>
						<span class="min-w-0 flex-1">
							<span class="block text-sm font-medium">{none.label}</span>
							<span class="block text-xs text-surface-600-400">{none.consequence}</span>
						</span>
						{#if value == null}
							<Badge size="md">In use</Badge>
						{:else}
							<span class="chip preset-tonal-surface text-xs">Use</span>
						{/if}
					</button>
				</div>
			{/if}
			{#each shown as v (v.key)}
				{@const on = v.key === value}
				<div class="flex shrink-0 items-center gap-1">
					<button
						type="button"
						role="radio"
						aria-checked={on}
						disabled={locked}
						class="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2 text-left {on
							? 'sidebar-row-active'
							: 'hover:bg-surface-200-800'}"
						onclick={() => pick(v.key)}
					>
						<span class="min-w-0 flex-1">
							<span class="block truncate text-sm font-medium">{v.name}</span>
							{#if labelLine(v)}
								<span class="block truncate text-xs text-surface-600-400"
									>{labelLine(v)}</span
								>
							{/if}
							{#if v.note}
								<span class="block text-xs text-surface-600-400">{v.note}</span>
							{/if}
							{#if v.kind === "clone"}
								<span class="block text-xs text-surface-600-400"
									>Held by the service (read-only)</span
								>
							{/if}
						</span>
						{#if on}
							<Badge size="md">In use</Badge>
						{:else}
							<span class="chip preset-tonal-surface text-xs">Use</span>
						{/if}
					</button>
					{#if v.previewUrl}
						<button
							type="button"
							class="btn-icon btn-icon-sm preset-tonal-surface shrink-0"
							aria-label="{playingKey === v.key ? 'Stop' : 'Preview'} {v.name}"
							title={playingKey === v.key ? "Stop" : "Preview"}
							onclick={() => preview(v)}
						>
							{#if playingKey === v.key}<Icons.Square size={14} />{:else}<Icons.Play
									size={14}
								/>{/if}
						</button>
					{/if}
				</div>
			{:else}
				<p class="px-3 py-2 text-sm text-surface-600-400">
					{voices.length ? "No voice matches this filter." : emptyText}
				</p>
			{/each}
		</div>

		{#if allowTyped && !locked}
			<form
				class="flex items-center gap-2"
				onsubmit={(e) => {
					e.preventDefault()
					const t = typed.trim()
					if (t) {
						pick(t)
						typed = ""
					}
				}}
			>
				<input
					class="input flex-1 text-sm"
					bind:value={typed}
					placeholder="Type a voice id"
					aria-label="Type a voice id"
				/>
				<button
					type="submit"
					class="btn btn-sm preset-tonal-surface"
					disabled={!typed.trim()}>Use</button
				>
			</form>
		{/if}
	{/if}

	{#if tryLine}
		<div class="flex flex-wrap items-center gap-2">
			<button
				type="button"
				class="btn btn-sm preset-tonal-surface"
				disabled={tryDisabled}
				onclick={() => value != null && tryLine.onTry(value)}
			>
				{#if tryLine.busy}<Icons.Loader size={14} class="animate-spin" />{:else}<Icons.Volume2
						size={14}
					/>{/if}
				{tryLine.label ?? "Try with this line"}
			</button>
			{#if tryLine.disabledReason}
				<span class="text-xs text-surface-600-400">{tryLine.disabledReason}</span>
			{:else if value == null}
				<span class="text-xs text-surface-600-400">Pick a voice to try it.</span>
			{/if}
		</div>
	{/if}
</div>
{/if}
