<script lang="ts">
	/**
	 * One MODEL in the index — the same anatomy on every kind of endpoint.
	 *
	 * Two lines and no third:
	 *
	 * - **Line 1** is the name (and the identifier beside it when they differ),
	 *   with ONE action slot at the right.
	 * - **Line 2** is chips, then facts, then tag chips — what this row IS,
	 *   then what it measures, then what it is flagged as.
	 *
	 * One anatomy on purpose. A local ONNX row and a cloud model row carry
	 * different facts, but a person scanning the list is reading the same three
	 * positions down the column, so the differences are in the *contents* of a
	 * slot and never in where the slot is.
	 *
	 * ## One action, decided elsewhere
	 *
	 * `rowAction` (modelManagement) picks it, so what a row offers is a table
	 * with tests rather than a stack of `{#if}`s. The row itself stays the
	 * button that opens the model — every control for a pair lives in its
	 * detail view — and the action sits beside it as its own button so that a
	 * press on Download is never a press on the row.
	 *
	 * ⚠ **Make active is not a write this row performs.** It is the same
	 * capability-default registration as the star everywhere else, raised to
	 * the parent so the costed confirmation ("N stored vectors are re-embedded")
	 * appears. See `rowAction`'s header.
	 *
	 * ## Lamp gold means default
	 *
	 * The ring and the gold chip say "this is the pair a run will reach for".
	 * For embeddings and entities the word is **Active** rather than Default,
	 * because there is one of each app-wide and "the default embedding model"
	 * invites the question of what the non-default ones are doing.
	 */
	import * as Icons from "@lucide/svelte"
	import { capabilityLabel } from "@serene-pub/sdk"
	import { shortDate } from "$lib/client/utils/timeAgo"
	import {
		formatBytes,
		formatMegabytes,
		formatProgress,
		formatTokens,
		type RowAction
	} from "./modelManagement"

	interface Props {
		row: {
			id: number
			name: string
			model: string
			enabled: boolean
			missingSince: string | null
			contextWindow?: number | null
			capabilities?: {
				overrides?: Record<string, unknown>
				probe?: unknown
			}
			satisfiableCapabilities?: string[]
			local?: Sockets.Connections.LocalModelState
		}
		/** Capability ids whose instance default targets this pair. */
		systemCapabilities?: string[]
		/** The one action this row offers, or null. */
		action?: RowAction | null
		/**
		 * The managed process has this file loaded — the chip AND the lamp
		 * ring, because a managed KoboldCPP runs one GGUF at a time and the
		 * chat default follows whichever one that is.
		 */
		loaded?: boolean
		/**
		 * The host is holding this model in memory — the same chip, and NO
		 * ring. An Ollama model being warm says nothing about what a run
		 * reaches for, and lamp gold on this list means exactly that.
		 */
		resident?: boolean
		/** An unfinished KoboldCPP download of this file, in bytes. */
		kcppDownload?: { downloaded: number; total: number } | null
		onOpen: () => void
		onAction?: (action: RowAction) => void
	}
	let {
		row,
		systemCapabilities = [],
		action = null,
		loaded = false,
		resident = false,
		kcppDownload = null,
		onOpen,
		onAction
	}: Props = $props()

	/**
	 * The two capabilities whose default is spoken of as ACTIVE.
	 *
	 * One embedding model and one entity model run app-wide, and switching
	 * either throws stored work away — so the chip says which one is in charge
	 * rather than which one a picker would pre-select.
	 */
	const ACTIVE_CAPABILITIES = new Set(["text->embedding", "text->entities"])

	const hasOwnCapabilityLayer = $derived(
		Object.keys(row.capabilities?.overrides ?? {}).length > 0 ||
			row.capabilities?.probe != null
	)
	const missing = $derived(row.missingSince != null)
	const local = $derived(row.local)
	const starred = $derived(systemCapabilities.length > 0)
	/** Lamp gold: this is the pair something reaches for, or the loaded file. */
	const lit = $derived(starred || loaded)
	/** Either kind of residency wears the same chip. */
	const inMemory = $derived(loaded || resident)

	/** One gold chip per default pointing here. */
	const defaultChips = $derived(
		[...systemCapabilities].sort().map((id) => ({
			id,
			label: ACTIVE_CAPABILITIES.has(id)
				? `Active${local?.loaded ? " · loaded" : ""}`
				: `Default · ${safeLabel(id)}`,
			title: `The instance default for ${safeLabel(id)} is this model`
		}))
	)

	function safeLabel(id: string): string {
		try {
			return capabilityLabel(id as any)
		} catch {
			return id
		}
	}

	/**
	 * The measured facts, in one order everywhere.
	 *
	 * A local row's come off its disk state and the recommended list; everything
	 * else has one worth showing here — how much it can be told at once.
	 */
	const facts = $derived.by(() => {
		const out: string[] = []
		if (local) {
			const size =
				local.state === "on_disk"
					? formatBytes(local.sizeBytes)
					: (formatMegabytes(local.catalog?.sizeMb) ??
						formatBytes(local.sizeBytes))
			if (size) out.push(size)
			if (local.catalog?.labels?.length)
				out.push(local.catalog.labels.join(" · "))
			if (local.catalog?.dimensions)
				out.push(`${local.catalog.dimensions} dims`)
			const tokens = formatTokens(local.catalog?.maxInputTokens)
			if (tokens) out.push(`${tokens} tokens`)
			if (local.catalog?.languages) out.push(local.catalog.languages)
			return out
		}
		const context = formatTokens(row.contextWindow)
		if (context) out.push(`${context} context`)
		return out
	})

	/**
	 * The two tags worth a chip, and no third.
	 *
	 * ⚠ A whitelist, deliberately. A tag this build has no words for is DROPPED
	 * rather than rendered raw — a row sprouting `sts_capable` says nothing to
	 * the person reading it, and the list's vocabulary is not this screen's to
	 * publish.
	 */
	const TAG_CHIP_LABELS: Record<string, string> = {
		"long input": "long input",
		long_input: "long input",
		"long-input": "long input"
	}
	const tagChips = $derived.by(() => {
		const out: string[] = []
		for (const tag of local?.catalog?.tags ?? []) {
			const label = TAG_CHIP_LABELS[tag.trim().toLowerCase()]
			if (label && !out.includes(label)) out.push(label)
		}
		if (local?.catalog?.license?.toLowerCase() === "gemma")
			out.push("Gemma terms")
		return out
	})

	/** The ember bar: a local download, or a managed KoboldCPP one. */
	const progress = $derived.by(() => {
		if (local?.state === "downloading") {
			const text = formatProgress(
				local.downloadedBytes,
				local.totalBytes,
				"MB"
			)
			const percent =
				local.percent ??
				(local.totalBytes
					? ((local.downloadedBytes ?? 0) / local.totalBytes) * 100
					: 0)
			return { percent: clamp(percent), text }
		}
		if (kcppDownload) {
			const text = formatProgress(
				kcppDownload.downloaded,
				kcppDownload.total,
				"GB"
			)
			const percent = kcppDownload.total
				? (kcppDownload.downloaded / kcppDownload.total) * 100
				: 0
			return { percent: clamp(percent), text }
		}
		return null
	})

	const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))

	function press(event: MouseEvent) {
		// The action is a sibling of the row button, not a child — but it is
		// still spelled out, so wrapping this row in a click target later
		// cannot silently turn Download into Open.
		event.stopPropagation()
		if (action) onAction?.(action)
	}
</script>

<div
	class="flex items-start gap-1 rounded-lg transition-colors {lit
		? 'preset-filled-surface-200-800 ring-primary-500/70 ring-2'
		: ''} {missing ? 'border-warning-500/40 border border-dashed' : ''}"
	role="listitem"
>
	<button
		type="button"
		class="group hover:preset-tonal-primary focus-visible:ring-primary-500 flex min-w-0 flex-1 flex-col gap-1 rounded-lg px-2.5 py-2 text-left focus-visible:ring-2 focus-visible:outline-none"
		onclick={onOpen}
		aria-label={`Open model ${row.name}`}
		title={row.model !== row.name ? row.model : undefined}
	>
		<span class="flex w-full items-center gap-2">
			<span
				class="min-w-0 flex-1 truncate text-sm {row.enabled && !missing
					? ''
					: 'opacity-60'}"
			>
				{row.name}
				{#if row.model !== row.name && !row.local?.catalog}
					<span class="text-muted text-xs">· {row.model}</span>
				{/if}
			</span>
			{#if hasOwnCapabilityLayer}
				<span
					class="text-primary-500 shrink-0 text-[10px]"
					title="This model has its own capability settings, layered over the connection's."
					aria-label="Has its own capability settings"
				>
					●
				</span>
			{/if}
			<Icons.ChevronRight
				size={14}
				class="text-muted shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
				aria-hidden="true"
			/>
		</span>

		{#if defaultChips.length || inMemory || missing || !row.enabled}
			<span class="flex flex-wrap items-center gap-1">
				{#each defaultChips as chip (chip.id)}
					<span
						class="preset-filled-primary-500 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
						title={chip.title}
					>
						<Icons.Star size={9} aria-hidden="true" />
						{chip.label}
					</span>
				{/each}
				{#if inMemory}
					<span
						class="preset-filled-success-500 rounded px-1.5 py-0.5 text-[10px] font-medium"
						title={loaded
							? "This file is the one the managed process has loaded."
							: "The host is holding this model in memory."}
					>
						Loaded
					</span>
				{/if}
				{#if missing}
					<span
						class="preset-tonal-warning inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
						title={`The host has not listed this model since ${shortDate(row.missingSince)}. Nothing can use it until it comes back.`}
					>
						<Icons.TriangleAlert size={10} aria-hidden="true" />
						Not listed
					</span>
				{/if}
				{#if !row.enabled}
					<span
						class="preset-tonal-surface rounded px-1.5 py-0.5 text-[10px] font-medium"
						title="Switched off — not offered in pickers"
					>
						Off
					</span>
				{/if}
			</span>
		{/if}

		{#if facts.length}
			<span
				class="text-muted flex min-w-0 flex-wrap items-center gap-x-1 text-[11px]"
			>
				{#each facts as fact, i (i)}
					{#if i > 0}<span aria-hidden="true">·</span>{/if}
					<span class="max-w-[13rem] truncate" title={fact}>
						{fact}
					</span>
				{/each}
			</span>
		{/if}

		{#if tagChips.length}
			<span class="flex flex-wrap gap-1">
				{#each tagChips as tag (tag)}
					<span
						class="border-surface-300-700 text-muted rounded-full border px-1.5 py-px text-[10px]"
					>
						{tag}
					</span>
				{/each}
			</span>
		{/if}

		{#if progress}
			<span class="block w-full">
				<!-- Decoration: the row is a button, and the line beneath
				     already says "0.4 of 1.2 GB" out loud. A progressbar role
				     nested in a button is a second announcement of the same
				     number. -->
				<span
					class="bg-surface-50-950 block h-1.5 w-full overflow-hidden rounded-full"
					aria-hidden="true"
				>
					<span
						class="bg-warning-500 block h-full rounded-full transition-[width]"
						style={`width:${progress.percent}%`}
					></span>
				</span>
				{#if progress.text}
					<span class="text-muted mt-0.5 block text-[11px]">
						{progress.text}
					</span>
				{/if}
			</span>
		{/if}

		{#if local?.state === "error"}
			<span
				class="text-warning-500 flex items-start gap-1 text-[11px]"
				title={local.error ?? undefined}
			>
				<Icons.TriangleAlert
					size={11}
					class="mt-px shrink-0"
					aria-hidden="true"
				/>
				<span class="min-w-0">
					{local.error ?? "The download failed."}
				</span>
			</span>
		{/if}
	</button>

	{#if action}
		<button
			type="button"
			class="btn btn-sm preset-filled-surface-400-600 mt-1.5 mr-1.5 shrink-0 text-[11px]"
			onclick={press}
		>
			{action.label}
		</button>
	{/if}
</div>
