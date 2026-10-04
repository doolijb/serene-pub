<script lang="ts">
	/**
	 * The action legend (owner request 2026-09-28): a "?" beside the
	 * composer's chips that opens a list of every action this session offers
	 * right now — its icon, name, what it does, its slash command and whether
	 * it takes what you typed — with a greyed action's reason beside it.
	 *
	 * A popover at desk width, a sheet on a phone (STYLE-GUIDE §6.6, §5.3).
	 * Both are Skeleton's, portalled: a labelled dialog, Escape closes it and
	 * focus returns to the "?". The rows are `legendSections` — the page's
	 * own verdict, so the legend never disagrees with the button.
	 */
	import { Dialog, Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { desktop } from "$lib/client/utils/breakpoint.svelte"
	import { type LegendSection } from "./actionLegend"
	import { collectsNote } from "./collects"

	interface Props {
		sections: LegendSection[]
		open?: boolean
		/** The trigger's look: the chips row's, or a plain row in a panel. */
		variant?: "chip" | "row"
		/** Popover at desk width, sheet below it; a test may pin one. */
		presentation?: "auto" | "popover" | "sheet"
	}

	let {
		sections,
		open = $bindable(false),
		variant = "chip",
		presentation = "auto"
	}: Props = $props()

	const asPopover = $derived(
		presentation === "auto" ? desktop.matches : presentation === "popover"
	)

	const TITLE = "What these do"
	const TRIGGER = "What do these do?"

	/** `book-open-text` → `BookOpenText`, resolved against the lucide set. */
	function iconOf(name?: string) {
		const pascal = (name ?? "")
			.split("-")
			.map((p) => p.charAt(0).toUpperCase() + p.slice(1))
			.join("")
		return (Icons as Record<string, unknown>)[pascal] ?? Icons.Play
	}

	const triggerClass = $derived(
		variant === "chip"
			? // Last in the composer's one Actions row (note 30), after More.
				"btn btn-sm preset-tonal-surface order-last px-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
			: "btn btn-sm preset-tonal-surface self-start"
	)
</script>

{#snippet triggerBody()}
	<Icons.CircleHelp size={16} class="shrink-0" aria-hidden="true" />
	{#if variant === "row"}
		<span>{TRIGGER}</span>
	{/if}
{/snippet}

{#snippet body()}
	{#if !sections.length}
		<p class="text-surface-600-400 text-sm">Nothing to press in this session yet.</p>
	{/if}
	{#each sections as section (section.venue)}
		<section class="space-y-2" aria-labelledby="legend-h-{section.venue}">
			<h3 id="legend-h-{section.venue}" class="text-surface-600-400 text-xs font-medium">
				{section.title}
			</h3>
			<ul class="space-y-3" data-legend-venue={section.venue}>
				{#each section.entries as entry (entry.identity)}
					{@const Icon = iconOf(entry.icon) as typeof Icons.Play}
					{@const asks = collectsNote(entry.collects)}
					<li class="flex gap-3" data-legend-action={entry.identity}>
						<span
							class="bg-surface-200-800 grid size-8 shrink-0 place-items-center rounded-lg"
							class:opacity-60={entry.disabled}
						>
							<Icon size={16} aria-hidden="true" />
						</span>
						<div class="min-w-0 flex-1 space-y-0.5">
							<p class="flex flex-wrap items-baseline gap-x-2 text-sm">
								<span class="font-medium" data-legend-name>{entry.name}</span>
								{#if entry.slash}
									<code class="text-surface-600-400 font-mono text-xs" data-legend-slash
										>/{entry.slash}</code
									>
								{/if}
							</p>
							{#if entry.description}
								<p class="text-surface-700-300 text-sm" data-legend-description>
									{entry.description}
								</p>
							{/if}
							{#if asks}
								<p class="text-surface-600-400 flex items-center gap-1 text-xs" data-legend-collects>
									<Icons.TextCursorInput size={12} aria-hidden="true" />
									{asks}
								</p>
							{/if}
							{#if entry.disabled && entry.reason}
								<p
									class="text-surface-600-400 flex items-center gap-1 text-xs"
									data-legend-reason
								>
									<Icons.CircleSlash size={12} aria-hidden="true" />
									Not now: {entry.reason}
								</p>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		</section>
	{/each}
{/snippet}

{#if asPopover}
	<Popover
		{open}
		onOpenChange={(e) => (open = e.open)}
		positioning={{ placement: "top-end" }}
	>
		<Popover.Trigger class={triggerClass} aria-label={TRIGGER} title={TRIGGER}>
			{@render triggerBody()}
		</Popover.Trigger>
		<Portal>
			<Popover.Positioner class="z-[1000]!">
				<Popover.Content
					class="card bg-surface-50-950 border-surface-200-800 flex max-h-[min(70vh,36rem)] w-[min(90vw,26rem)] flex-col gap-4 overflow-y-auto border p-4 shadow-xl"
				>
					<Popover.Title class="text-base font-semibold">{TITLE}</Popover.Title>
					{@render body()}
				</Popover.Content>
			</Popover.Positioner>
		</Portal>
	</Popover>
{:else}
	<Dialog {open} onOpenChange={(e) => (open = e.open)}>
		<Dialog.Trigger class={triggerClass} aria-label={TRIGGER} title={TRIGGER}>
			{@render triggerBody()}
		</Dialog.Trigger>
		<Portal>
			<Dialog.Backdrop class="bg-surface-50-950/50 fixed inset-0 z-50" />
			<Dialog.Positioner class="fixed inset-0 z-50 flex items-end justify-center">
				<Dialog.Content
					class="card bg-surface-100-900 flex max-h-[85vh] w-full flex-col gap-4 overflow-y-auto rounded-b-none p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl"
				>
					<header class="flex items-center justify-between gap-2">
						<Dialog.Title class="text-base font-semibold">{TITLE}</Dialog.Title>
						<Dialog.CloseTrigger
							class="btn-icon hover:preset-tonal pointer-coarse:min-h-11 pointer-coarse:min-w-11"
							aria-label="Close"
						>
							<Icons.X size={18} aria-hidden="true" />
						</Dialog.CloseTrigger>
					</header>
					{@render body()}
				</Dialog.Content>
			</Dialog.Positioner>
		</Portal>
	</Dialog>
{/if}
