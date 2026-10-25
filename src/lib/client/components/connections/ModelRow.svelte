<script lang="ts">
	/**
	 * ONE model, as one row — in a managed runtime's Models tab, the job picker,
	 * or a connection's Models tab.
	 *
	 * ## What it replaces
	 *
	 * The managed views listed models as CARDS: the raw identifier wrapped over
	 * two lines as the title, a `Size: / Modified: / Parameters:` key-value table
	 * under it, then a green filled **Use in Reply**, a gear, an **Edit** and a
	 * red filled **Delete** wrapping onto two rows. About 200px per model in a
	 * 400px column, so two of four models were on screen at once.
	 *
	 * Three separate rules were being broken and all three are fixed here:
	 *
	 * 1. **`preset-filled-*` is a button, not a badge** (STYLE-GUIDE §2.4).
	 *    Green on every row said "healthy" four times about a thing that was
	 *    merely offered; red on every row put the one irreversible action under
	 *    the thumb, on the row, four times over.
	 * 2. **The anatomy is a row's**: 15px name, 12px muted second line, actions
	 *    in a `⋯` menu (STYLE-GUIDE §6.4) — never a `Size:`/`Modified:`
	 *    key-value table.
	 *
	 *    ⚠ **Amended 2026-09-25 (owner): the CONTAINER is a card.** The rule
	 *    this file was written to enforce was never "no card" — it was no
	 *    key-value table and no filled green button beside a filled red one.
	 *    Both still hold and both are still enforced below. What moved is the
	 *    box around them, so a model you HAVE and a model you could DOWNLOAD
	 *    read as one kind of thing (`ModelFinderView`'s cards, same day).
	 *
	 *    ⚠ The cost is real and was the original argument: a card is ~88px
	 *    against a row's 44px, so a 400px dock shows three or four models where
	 *    it showed seven. `panel-card`'s own padding, not a tighter override —
	 *    the ask was to match the download cards and those are `p-4`, and two
	 *    padding utilities on one element resolve by emit order, which is not a
	 *    thing to make a layout depend on.
	 * 3. **Facts go on one line, not in a table.** `Q4_K_M · 7 GB · 32k` reads
	 *    in one pass; a right-aligned two-column table of three rows does not,
	 *    and it cost 60px to say less.
	 *
	 * ## The default is a mark, not a button on every row
	 *
	 * The one row that IS the default wears a gold chip. The others offer **Use**
	 * — quiet, outlined, and only on hover-or-focus at desk width. Four filled
	 * green buttons offering to change a decision you already made is four
	 * invitations to undo it.
	 */
	import * as Icons from "@lucide/svelte"
	import RowMenu, {
		type RowMenuEntries
	} from "$lib/client/components/menus/RowMenu.svelte"
	import {
		formatContext,
		type ModelFacts
	} from "$lib/shared/connections/modelFacts"
	import { formatSize, modelDisplay } from "./modelDisplay"
	import type { Snippet } from "svelte"

	export interface ModelRowAction {
		/** What the caller does with it. */
		id: string
		label: string
		/** A `@lucide/svelte` export name. */
		icon?: string
		/** Renders in the error role and sits under a separator. */
		destructive?: boolean
	}

	interface Props {
		model: {
			id: number
			model: string
			name?: string | null
			facts?: ModelFacts | null
			/** The admin's override, which WINS over the host's claim. */
			contextWindow?: number | null
			missingSince?: string | null
			enabled?: boolean
		}
		/** Capability labels this model is the instance default for. */
		defaultFor?: readonly string[]
		/** Shown in place of Use — a download state, an "on disk". */
		note?: string | null
		/** Offer the quiet Use button. */
		canUse?: boolean
		useLabel?: string
		/**
		 * The dock's short word. "Use" suits a host's model; a local ONNX row's
		 * one action is Download, Cancel, Retry or Make active, and "Use" on a
		 * row that has not been downloaded named the wrong press.
		 */
		useShortLabel?: string
		/**
		 * Why Use can't be pressed, or null. The button stays, disabled, and
		 * says why — a local ONNX row's Make active where the runtime didn't
		 * load, which the server refuses with the same sentence.
		 */
		useDisabledReason?: string | null
		selected?: boolean
		/**
		 * The connection this model lives on, as a small chip on the second
		 * line — the Models view's flat list, where rows from every
		 * connection sit together. Absent inside one connection's own list.
		 */
		chip?: { label: string; title?: string } | null
		actions?: readonly ModelRowAction[]
		/**
		 * Drawn in place of the Use button where `canUse` holds — the Models
		 * view's *Use in…* menu (`UseInMenu`), which names the loadout.
		 */
		useMenu?: Snippet
		onOpen?: () => void
		onUse?: () => void
		onAction?: (id: string) => void
	}
	let {
		model,
		defaultFor = [],
		note = null,
		canUse = false,
		useLabel = "Use",
		useShortLabel = "Use",
		useDisabledReason = null,
		selected = false,
		chip = null,
		actions = [],
		useMenu,
		onOpen,
		onUse,
		onAction
	}: Props = $props()

	let menuOpen = $state(false)

	/** The row's ⋯ (RowMenu, the app's one kebab): a destructive action sits
	 *  under a separator, as it always has. */
	const menuItems = $derived<RowMenuEntries>(
		actions.flatMap((action) => [
			action.destructive && { separator: true as const },
			{
				label: action.label,
				icon: ((Icons as any)[action.icon ?? ""] as any) ?? undefined,
				destructive: action.destructive,
				onSelect: () => onAction?.(action.id)
			}
		])
	)

	const display = $derived(modelDisplay(model))
	const missing = $derived(!!model.missingSince)

	/**
	 * The quiet line: quantisation, size, context.
	 *
	 * ⚠ The admin's `contextWindow` override wins over `facts.contextWindow`,
	 * and that order is why both exist. A person who capped a
	 * window at 8k must see 8k here — showing the host's 200k would be this row
	 * quoting a number the resolver will not use.
	 */
	const factLine = $derived.by(() => {
		const parts: string[] = []
		// ⚠ The parameter count sits HERE and not beside the name. As a badge it
		// ate the width a long name needs — "TheDrummer Cydoni…" at 400px — to
		// say something that belongs with the other numbers anyway.
		if (display.parameters) parts.push(display.parameters)
		if (display.quantization) parts.push(display.quantization)
		const size = formatSize(model.facts?.sizeBytes)
		if (size) parts.push(size)
		const context = formatContext(
			model.contextWindow ?? model.facts?.contextWindow
		)
		if (context) parts.push(`${context} context`)
		return parts.join(" · ")
	})
</script>

<div
	class="panel-card group flex items-center gap-2 {selected
		? 'ring-primary-500 ring-offset-surface-50 dark:ring-offset-surface-950 ring-2 ring-offset-2'
		: ''}"
>
	<button
		type="button"
		class="focus-visible:ring-primary-500 flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left focus-visible:ring-2 focus-visible:outline-none {missing
			? 'opacity-55'
			: ''}"
		aria-current={selected ? "true" : undefined}
		title={display.identifier}
		onclick={() => onOpen?.()}
		disabled={!onOpen}
	>
		<span class="min-w-0 flex-1">
			<span class="flex min-w-0 items-center gap-1.5">
				<span class="min-w-0 truncate text-lead font-medium">
					{display.name}
				</span>
				{#each defaultFor as capability (capability)}
					<span
						class="preset-tonal-primary text-primary-ink flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-meta font-bold"
					>
						<Icons.Star
							size={9}
							fill="currentColor"
							aria-hidden="true"
						/>
						{capability}
					</span>
				{/each}
				{#if missing}
					<span
						class="border-surface-200-800 text-surface-600-400 shrink-0 rounded border px-1.5 py-0.5 text-meta font-medium"
					>
						No longer listed
					</span>
				{/if}
			</span>
			{#if chip}
				<span class="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs">
					<span
						class="bg-surface-200-800 text-surface-700-300 max-w-[50%] shrink-0 truncate rounded px-1.5 py-0.5 text-meta font-medium"
						title={chip.title ?? chip.label}
					>
						{chip.label}
					</span>
					{#if factLine || note}
						<span class="text-surface-600-400 min-w-0 truncate">
							{note ?? factLine}
						</span>
					{/if}
				</span>
			{:else if factLine || note}
				<span
					class="text-surface-600-400 mt-0.5 block truncate text-xs"
				>
					{note ?? factLine}
				</span>
			{/if}
		</span>
	</button>

	{#if canUse && !missing && useMenu}
		{@render useMenu()}
	{:else if canUse && !missing}
		<!-- Outlined, not filled, and it appears on hover or focus at desk
		     width so a settled list is a settled list. -->
		<button
			type="button"
			class="btn btn-sm preset-tonal-surface mr-0.5 shrink-0 text-meta font-semibold opacity-100 disabled:cursor-not-allowed @min-[900px]/view:opacity-0 @min-[900px]/view:group-focus-within:opacity-100 @min-[900px]/view:group-hover:opacity-100"
			onclick={() => onUse?.()}
			disabled={!!useDisabledReason}
			aria-label={useDisabledReason
				? `${useLabel} — ${useDisabledReason}`
				: useLabel}
			title={useDisabledReason ?? useLabel}
		>
			<!-- "Use" in the dock, the whole verb where there is room: the long
			     label took the width the model's name needed. -->
			<span class="@lg/view:hidden">{useShortLabel}</span>
			<span class="hidden @lg/view:inline">{useLabel}</span>
		</button>
	{/if}

	{#if actions.length}
		<span class="mr-1 inline-flex">
			<RowMenu
				label={display.name}
				triggerLabel="More actions for {display.name}"
				width={220}
				bind:open={menuOpen}
				items={menuItems}
			/>
		</span>
	{/if}
</div>
