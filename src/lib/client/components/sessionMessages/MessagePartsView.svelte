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
	import MessageBlocksView from "./MessageBlocksView.svelte"

	interface Props {
		messageId: number
		parts: SelectMessagePart[]
		activeRevisions: Record<string, number>
		/** An image in the message was clicked — its address. */
		onOpenImage?: (src: string) => void
		/** Declared block actions (20 §6) — fn + payload up to the page; a form's `blockId` rides along (U5d). */
		onAction?: (
			fn: string,
			payload?: Record<string, unknown>,
			action?: string,
			blockId?: string
		) => void
		/** The message body, so a form's question is not shown twice. */
		bodyText?: string
		/** The viewer's verdict on a form's addressee (U5d review, W7) — see `MessageBlocksView`. */
		canAnswer?: (addressee: string | undefined) => boolean
		/** Whether the channel has moved past a form (U5f) — see `MessageBlocksView`. */
		isStale?: (block: { head?: unknown; answered?: unknown }) => boolean
	}

	let {
		messageId,
		parts,
		activeRevisions,
		onOpenImage,
		onAction,
		bodyText,
		canAnswer,
		isStale
	}: Props = $props()

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
				<sp-icon name="brain-circuit" size="16"></sp-icon>
			{:else if icon === "notebook"}
				<sp-icon name="notebook-pen" size="16"></sp-icon>
			{:else if icon === "wrench"}
				<sp-icon name="wrench" size="16"></sp-icon>
			{:else}
				<sp-icon name="puzzle" size="16"></sp-icon>
			{/if}
			<span>{title}</span>
			<sp-icon name="chevron-down" size="16" class={`transition-transform ${expanded[part.id] ? "rotate-180" : ""}`}></sp-icon>
		</button>
		<!-- grid 0fr -> 1fr transitions to/from auto height in pure CSS; the
		     overflow-hidden wrapper keeps collapsed content from spilling, and
		     the skin's `visibility` keeps the 0fr track's focusables out of the
		     tab order (`.sp-part-body`, conversation.css). -->
		<div
			id="part-{messageId}-{part.id}"
			class="sp-part-body grid transition-[grid-template-rows] duration-200 ease-out"
			data-expanded={expanded[part.id] ? "" : undefined}
		>
			<div class="overflow-hidden">
				<div
					class="rendered-session-message-content pb-2 text-sm opacity-80"
				>
					<sp-message-body text={body}></sp-message-body>
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
			<div class="rendered-session-message-content">
				<sp-message-body
					text={part.content ?? ""}
					onopen-image={(e: CustomEvent<{ src: string }>) => onOpenImage?.(e.detail.src)}
				></sp-message-body>
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
				onclick={() => onOpenImage?.(`/session-assets/${(part.data as any).assetId}`)}
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
				<sp-icon name="paperclip" size="14"></sp-icon>
				{(part.data as any)?.name ?? "attachment"}
			</a>
		{:else if Array.isArray((part.data as any)?.blocks)}
			<!-- A block tree (20 §6): plugin content as data, core's renderer,
			     whatever the part's namespace — the convention, not a registry. -->
			<MessageBlocksView
				blocks={(part.data as any).blocks}
				{onAction}
				{bodyText}
				{canAnswer}
				{isStale}
			/>
		{:else}
			{@render collapsible(part, part.type, "puzzle", unknownBody(part))}
		{/if}
	{/each}
{/each}
