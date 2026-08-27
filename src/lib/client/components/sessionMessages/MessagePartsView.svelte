<script lang="ts">
	/**
	 * The parts-native message body (20 §2, phase 2 of §13).
	 *
	 * Renders a message's typed parts: steps ascending (they accumulate — a
	 * stepped activity's phases stand side by side), each step showing only
	 * its active revision (`activeRevisions`, the swipe cursor), parts in
	 * their own ordinal order.
	 *
	 * Types: markdown is the body; thinking and sections are collapsibles —
	 * the generalization that retires the two hardcoded blocks in
	 * SessionMessage. An unknown namespaced type (its plugin is gone, or not
	 * yet installed) renders as a collapsed labeled section rather than
	 * breaking: uninstalling strands nothing.
	 */
	import * as Icons from "@lucide/svelte"
	import MessageBlocksView from "./MessageBlocksView.svelte"
	import { renderMarkdownWithQuotedText } from "$lib/client/utils/markdownToHTML"

	interface Props {
		messageId: number
		parts: SelectMessagePart[]
		activeRevisions: Record<string, number>
		onContentClick?: (e: MouseEvent) => void
		/** Declared block actions (20 §6) — fn + payload up to the page. */
		onAction?: (fn: string, payload?: Record<string, unknown>) => void
	}

	let { messageId, parts, activeRevisions, onContentClick, onAction }: Props =
		$props()

	/** Expanded state per collapsible, keyed by part id. Default collapsed. */
	let expanded = $state<Record<number, boolean>>({})

	const steps = $derived(
		[...new Set(parts.map((p) => p.step))].sort((a, b) => a - b)
	)

	function visibleParts(step: number): SelectMessagePart[] {
		const active = activeRevisions[String(step)] ?? 0
		return parts
			.filter((p) => p.step === step && p.revision === active)
			.sort((a, b) => a.ordinal - b.ordinal)
	}

	function sectionTitle(part: SelectMessagePart): string {
		const t = (part.data as any)?.title
		if (typeof t === "string" && t) return t
		return "Section"
	}

	/** The graceful floor: what an unknown type shows when unfolded. */
	function unknownBody(part: SelectMessagePart): string {
		if (part.content) return part.content
		try {
			return "```json\n" + JSON.stringify(part.data ?? {}, null, 2) + "\n```"
		} catch {
			return ""
		}
	}
</script>

{#snippet collapsible(
	part: SelectMessagePart,
	title: string,
	icon: "brain" | "notebook" | "puzzle" | "wrench",
	body: string
)}
	<div class="mx-2 mt-2">
		<button
			class="flex w-full items-center gap-2 py-2 text-sm opacity-70 transition-opacity hover:opacity-100"
			onclick={() => (expanded[part.id] = !expanded[part.id])}
			title={expanded[part.id] ? `Collapse ${title}` : `Expand ${title}`}
			aria-expanded={!!expanded[part.id]}
			aria-controls="part-{messageId}-{part.id}"
		>
			{#if icon === "brain"}
				<Icons.BrainCircuit size={16} aria-hidden="true" />
			{:else if icon === "notebook"}
				<Icons.NotebookPen size={16} aria-hidden="true" />
			{:else if icon === "wrench"}
				<Icons.Wrench size={16} aria-hidden="true" />
			{:else}
				<Icons.Puzzle size={16} aria-hidden="true" />
			{/if}
			<span>{title}</span>
			<Icons.ChevronDown
				size={16}
				aria-hidden="true"
				class={`transition-transform ${expanded[part.id] ? "rotate-180" : ""}`}
			/>
		</button>
		<!-- grid 0fr -> 1fr transitions to/from auto height in pure CSS; the
		     overflow-hidden wrapper keeps collapsed content from spilling, and
		     `inert` keeps the 0fr track's focusables out of the tab order.
		     (Same construction as the blocks this component retires.) -->
		<div
			id="part-{messageId}-{part.id}"
			class="grid transition-[grid-template-rows] duration-200 ease-out"
			style:grid-template-rows={expanded[part.id] ? "1fr" : "0fr"}
			inert={!expanded[part.id]}
		>
			<div class="overflow-hidden">
				<div
					class="rendered-session-message-content pb-2 text-sm opacity-80"
				>
					{@html renderMarkdownWithQuotedText(body)}
				</div>
			</div>
		</div>
	</div>
{/snippet}

{#each steps as step, i (step)}
	{#if i > 0}
		<!-- Steps accumulate (20 §1): a stepped activity's phases render
		     stacked, separated so the progression reads as chapters. -->
		<hr class="hr mx-2 my-1 opacity-40" />
	{/if}
	{#each visibleParts(step) as part (part.id)}
		{#if part.type === "core:markdown"}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="rendered-session-message-content"
				onclick={onContentClick}
			>
				{@html renderMarkdownWithQuotedText(part.content ?? "")}
			</div>
		{:else if part.type === "core:thinking"}
			{@render collapsible(part, "Thinking", "brain", part.content ?? "")}
		{:else if part.type === "core:tool-call"}
			{@render collapsible(
				part,
				(part.data as any)?.tool
					? `Tool: ${(part.data as any).tool}`
					: "Tool call",
				"wrench",
				part.content ?? unknownBody(part)
			)}
		{:else if part.type === "core:tool-result"}
			{@render collapsible(
				part,
				"Tool result",
				"wrench",
				part.content ?? unknownBody(part)
			)}
		{:else if part.type === "core:section"}
			{@render collapsible(
				part,
				sectionTitle(part),
				"notebook",
				part.content ?? ""
			)}
		{:else if part.type === "core:image" && (part.data as any)?.assetId}
			<!-- A button, not a bare <img> with a click handler: the lightbox
			     open is an action, and this keeps it keyboard-reachable. -->
			<button
				type="button"
				class="mt-2 block w-fit cursor-pointer border-0 bg-transparent p-0"
				onclick={onContentClick}
				aria-label="Open image attachment"
			>
				<img
					class="max-h-96 max-w-full rounded"
					src="/session-assets/{(part.data as any).assetId}"
					alt={(part.data as any)?.alt ?? "attachment"}
				/>
			</button>
		{:else if part.type === "core:file" && (part.data as any)?.assetId}
			<a
				class="preset-tonal-surface mt-2 flex w-fit items-center gap-2 rounded p-2 text-sm"
				href="/session-assets/{(part.data as any).assetId}"
				download={(part.data as any)?.name ?? true}
			>
				<Icons.Paperclip size={14} aria-hidden="true" />
				{(part.data as any)?.name ?? "attachment"}
			</a>
		{:else if Array.isArray((part.data as any)?.blocks)}
			<!-- A block tree (20 §6): plugin content as data, core's renderer,
			     whatever the part's namespace — the convention, not a registry. -->
			<MessageBlocksView blocks={(part.data as any).blocks} {onAction} />
		{:else}
			{@render collapsible(part, part.type, "puzzle", unknownBody(part))}
		{/if}
	{/each}
{/each}
