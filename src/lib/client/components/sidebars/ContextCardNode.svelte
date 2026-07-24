<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import CardListDnd from "./CardListDnd.svelte"
	// Self-import — Svelte components don't implicitly see their own name in
	// scope for recursion, so this is required for <ContextCardNode> to be
	// usable inside its own template below.
	import ContextCardNode from "./ContextCardNode.svelte"
	import {
		type Card,
		type BlockCard,
		type InsertableKind,
		INSERTABLE_CARD_OPTIONS,
		updateBlockTag,
		updateVariableCard,
		updateTextCard,
		addElseBranch,
		removeElseBranch,
		findOrphanedBlockParamNames
	} from "$lib/shared/utils/contextConfigCards"
	import { makeCardListActions } from "$lib/shared/utils/contextCardListActions"

	interface Props {
		card: Card
		template: string
		onTemplateChange: (template: string) => void
		onRemove: () => void
		onMoveUp: () => void
		onMoveDown: () => void
		canMoveUp: boolean
		canMoveDown: boolean
		onInsertAbove: (spec: InsertableKind) => void
		showDragHandle: boolean
		collapsedIds: Set<string>
		onToggleCollapsed: (id: string) => void
	}
	let {
		card,
		template,
		onTemplateChange,
		onRemove,
		onMoveUp,
		onMoveDown,
		canMoveUp,
		canMoveDown,
		onInsertAbove,
		showDragHandle,
		collapsedIds,
		onToggleCollapsed
	}: Props = $props()

	let isCollapsed = $derived(card.kind === "block" && collapsedIds.has(card.id))

	const ROLE_ICONS: Record<string, any> = {
		systemBlock: Icons.ScrollText,
		userBlock: Icons.User,
		assistantBlock: Icons.Bot
	}
	const ROLE_LABELS: Record<string, string> = {
		systemBlock: "System Message",
		userBlock: "User Message",
		assistantBlock: "Assistant Message"
	}
	const HELPER_DESCRIPTIONS: Record<string, string> = {
		if: "Shows its contents only when the condition is true.",
		unless: "Shows its contents only when the condition is false.",
		each: "Repeats its contents once per item in the list.",
		with: "Changes the current scope to a nested value for its contents.",
		systemBlock: "Wraps its contents as a system-role block.",
		userBlock: "Wraps its contents as a user-role block.",
		assistantBlock: "Wraps its contents as an assistant-role block."
	}

	function describeBlock(c: BlockCard): string {
		return (
			HELPER_DESCRIPTIONS[c.helperName] ||
			`A block controlled by the "${c.helperName}" helper.`
		)
	}

	let tagError: string | undefined = $state(undefined)
	let expressionError: string | undefined = $state(undefined)
	let expanded = $state(false)

	function commitBlockTag(newHelperName: string, newTagSource: string) {
		if (card.kind !== "block") return
		if (newHelperName === card.helperName && newTagSource === card.tagSource)
			return
		const orphaned = findOrphanedBlockParamNames(
			card.tagSource,
			newTagSource,
			card.children
		)
		if (orphaned.length > 0) {
			const names = orphaned.join(", ")
			const plural = orphaned.length > 1
			const proceed = confirm(
				`${names} ${plural ? "are" : "is"} still used by ${plural ? "cards" : "a card"} below — this change will break ${plural ? "them" : "it"}. Continue anyway?`
			)
			if (!proceed) return
		}
		const { template: next, error } = updateBlockTag(
			template,
			card,
			newHelperName,
			newTagSource
		)
		if (error) {
			tagError = error
			return
		}
		tagError = undefined
		onTemplateChange(next)
	}

	function commitVariable(newExpression: string, newEscaped: boolean) {
		if (card.kind !== "variable") return
		if (
			newExpression === card.expressionSource &&
			newEscaped === card.escaped
		)
			return
		const { template: next, error } = updateVariableCard(
			template,
			card,
			newExpression,
			newEscaped
		)
		if (error) {
			expressionError = error
			return
		}
		expressionError = undefined
		onTemplateChange(next)
	}

	function commitText(newContent: string) {
		if (card.kind !== "text") return
		if (newContent === card.content) return
		onTemplateChange(updateTextCard(template, card, newContent))
	}

	function handleAddElse() {
		if (card.kind !== "block") return
		onTemplateChange(addElseBranch(template, card))
	}
	function handleRemoveElse() {
		if (card.kind !== "block") return
		onTemplateChange(removeElseBranch(template, card))
	}

	// Actions for THIS card's own children/elseChildren — this card acts as
	// "the parent" for its own nested list, same role ContextSidebar plays
	// for the root list.
	let childActions = $derived(
		card.kind === "block"
			? makeCardListActions({
					template,
					siblings: card.children,
					parentBodyStart: card.bodyStart,
					parentBodyEnd: card.bodyEnd,
					onTemplateChange
				})
			: null
	)
	let elseActions = $derived(
		card.kind === "block" && card.hasElse
			? makeCardListActions({
					template,
					siblings: card.elseChildren ?? [],
					parentBodyStart: card.elseBodyStart!,
					parentBodyEnd: card.elseBodyEnd!,
					onTemplateChange
				})
			: null
	)
</script>

{#snippet addCardMenu(
	onPick: (spec: InsertableKind) => void,
	ariaLabel: string,
	visibleLabel?: string
)}
	<Popover positioning={{ placement: "bottom" }}>
		<Popover.Trigger
			class="btn btn-sm preset-outlined-primary-500 self-start"
			aria-label={ariaLabel}
			title={ariaLabel}
		>
			<Icons.Plus size={14} />
			{#if visibleLabel}{visibleLabel}{/if}
		</Popover.Trigger>
		<Portal>
			<Popover.Positioner class="z-[1000]!">
				<Popover.Content
					class="card preset-tonal-surface flex max-w-[16rem] flex-col gap-1 p-2"
				>
					{#each INSERTABLE_CARD_OPTIONS as option}
						<button
							type="button"
							class="btn btn-sm preset-filled-surface-400-600 w-full justify-start"
							onclick={() => onPick(option.spec)}
							title={option.description}
						>
							<Icons.Plus size={14} />
							{option.label}
						</button>
					{/each}
				</Popover.Content>
			</Popover.Positioner>
		</Portal>
	</Popover>
{/snippet}

<div
	class="preset-outlined-surface-400-600 bg-surface-100-800 hover:bg-surface-200-800 flex flex-col gap-2 rounded-xl p-3 shadow-sm transition-colors"
	data-dnd-handle
>
	<div class="flex items-start gap-2">
		{#if showDragHandle}
			<span
				class="text-surface-400 hover:text-primary-500 mt-0.5 cursor-grab"
				data-dnd-handle
				title="Drag to reorder"
			>
				<Icons.GripVertical size={18} />
			</span>
		{/if}
		<div class="min-w-0 flex-1">
			{#if card.kind === "block"}
				{@const RoleIcon = ROLE_ICONS[card.helperName] ?? Icons.Layers}
				<div class="flex flex-wrap items-center gap-1">
					<RoleIcon size={14} class="text-surface-400 shrink-0" />
					<span class="font-semibold break-words select-none">
						{ROLE_LABELS[card.helperName] ?? card.helperName}
					</span>
					<Popover positioning={{ placement: "top" }}>
						<Popover.Trigger
							class="btn-ghost rounded p-0.5"
							aria-label="About this block"
						>
							<Icons.Info size={14} />
						</Popover.Trigger>
						<Portal>
							<Popover.Positioner class="z-[1000]!">
								<Popover.Content
									class="card preset-tonal-surface max-w-xs p-2 text-sm"
								>
									{describeBlock(card)}
								</Popover.Content>
							</Popover.Positioner>
						</Portal>
					</Popover>
				</div>
				<div class="mt-1 flex flex-wrap items-center gap-1">
					<input
						type="text"
						class="input w-20 shrink-0 py-0.5 text-xs"
						value={card.helperName}
						placeholder="helper"
						title={card.helperName}
						aria-label="Helper name"
						onblur={(e) =>
							commitBlockTag(e.currentTarget.value.trim() || card.helperName, card.tagSource)}
					/>
					<input
						type="text"
						class="input min-w-0 flex-1 py-0.5 font-mono text-xs"
						value={card.tagSource}
						placeholder="condition / params"
						title={card.tagSource}
						aria-label="Tag condition or parameters"
						onblur={(e) =>
							commitBlockTag(card.helperName, e.currentTarget.value.trim())}
					/>
				</div>
				{#if tagError}
					<p class="text-error-500 mt-1 text-xs">{tagError}</p>
				{/if}
			{:else if card.kind === "variable"}
				<div class="flex flex-wrap items-center gap-1">
					<Icons.Braces size={14} class="text-surface-400 shrink-0" />
					<span class="font-semibold select-none">Variable</span>
					<Popover positioning={{ placement: "top" }}>
						<Popover.Trigger
							class="btn-ghost rounded p-0.5"
							aria-label="About variables"
						>
							<Icons.Info size={14} />
						</Popover.Trigger>
						<Portal>
							<Popover.Positioner class="z-[1000]!">
								<Popover.Content
									class="card preset-tonal-surface max-w-xs p-2 text-sm"
								>
									Outputs a single value. Unescaped ({"{{{"}...{"}}}"})
									renders raw text/HTML; escaped ({"{{"}...{"}}"}) HTML-encodes
									it first.
								</Popover.Content>
							</Popover.Positioner>
						</Portal>
					</Popover>
				</div>
				<div class="mt-1 flex flex-wrap items-center gap-1">
					<input
						type="text"
						class="input min-w-0 flex-1 py-0.5 font-mono text-xs"
						value={card.expressionSource}
						title={card.expressionSource}
						aria-label="Variable expression"
						onblur={(e) =>
							commitVariable(e.currentTarget.value.trim(), card.escaped)}
					/>
					<label class="flex items-center gap-1 text-xs whitespace-nowrap">
						<input
							type="checkbox"
							checked={card.escaped}
							onchange={(e) =>
								commitVariable(
									card.expressionSource,
									e.currentTarget.checked
								)}
						/>
						Escape
					</label>
				</div>
				{#if expressionError}
					<p class="text-error-500 mt-1 text-xs">{expressionError}</p>
				{/if}
			{:else}
				<div class="flex items-center gap-1">
					<Icons.Type size={14} class="text-surface-400 shrink-0" />
					<span class="font-semibold select-none">Text</span>
				</div>
			{/if}
		</div>
		<div class="flex shrink-0 items-center gap-0.5">
			{#if card.kind === "block"}
				<button
					class="btn-ghost rounded p-0.5"
					onclick={() => onToggleCollapsed(card.id)}
					title={isCollapsed ? "Expand" : "Collapse"}
					aria-label={isCollapsed ? "Expand" : "Collapse"}
				>
					{#if isCollapsed}
						<Icons.ChevronRight size={16} />
					{:else}
						<Icons.ChevronDown size={16} />
					{/if}
				</button>
			{/if}
			{@render addCardMenu(onInsertAbove, "Insert card above")}
			<button
				class="btn-ghost rounded p-0.5 disabled:opacity-30"
				onclick={onMoveUp}
				disabled={!canMoveUp}
				title="Move up"
				aria-label="Move up"
			>
				<Icons.ChevronUp size={16} />
			</button>
			<button
				class="btn-ghost rounded p-0.5 disabled:opacity-30"
				onclick={onMoveDown}
				disabled={!canMoveDown}
				title="Move down"
				aria-label="Move down"
			>
				<Icons.ChevronDown size={16} />
			</button>
			{#if card.kind === "text"}
				<button
					class="btn-ghost rounded p-0.5"
					onclick={() => (expanded = !expanded)}
					title="Edit text"
					aria-label="Edit text"
				>
					<Icons.Pencil size={14} />
				</button>
			{/if}
			<button
				class="btn-ghost text-error-500 rounded p-0.5"
				onclick={onRemove}
				title="Remove"
				aria-label="Remove"
			>
				<Icons.X size={16} />
			</button>
		</div>
	</div>

	{#if card.kind === "text"}
		{#if expanded}
			<textarea
				class="input w-full text-sm"
				rows="3"
				value={card.content}
				onblur={(e) => commitText(e.currentTarget.value)}
			></textarea>
		{:else}
			<p class="text-surface-700-300 truncate text-xs">
				{card.content}
			</p>
		{/if}
	{/if}

	{#if card.kind === "block" && !isCollapsed}
		<div class="border-surface-300-700 ml-2 flex flex-col gap-2 border-l-2 pl-3">
			{#if card.children.length === 0}
				<p class="text-surface-700-300 text-xs">No cards yet.</p>
			{/if}
			<CardListDnd
				cards={card.children}
				onReorder={(ids) => childActions?.reorder(ids)}
			>
				{#snippet row(child, i)}
					<ContextCardNode
						card={child}
						{template}
						{onTemplateChange}
						onRemove={() => childActions?.remove(i)}
						onMoveUp={() => childActions?.moveUp(i)}
						onMoveDown={() => childActions?.moveDown(i)}
						canMoveUp={i > 0}
						canMoveDown={i < card.children.length - 1}
						onInsertAbove={(spec) => childActions?.insertAt(i, spec)}
						showDragHandle={card.children.length > 1}
						{collapsedIds}
						{onToggleCollapsed}
					/>
				{/snippet}
			</CardListDnd>
			{@render addCardMenu(
				(spec) => childActions?.insertAt(card.children.length, spec),
				"Add Card",
				"Add Card"
			)}

			{#if card.hasElse}
				<div class="border-surface-300-700 mt-2 flex flex-col gap-2 border-t pt-2">
					<div class="flex items-center gap-2">
						<span class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase">
							Else
						</span>
						<button
							class="btn-ghost text-error-500 rounded p-0.5"
							onclick={handleRemoveElse}
							title="Remove Else"
							aria-label="Remove Else branch"
						>
							<Icons.X size={14} />
						</button>
					</div>
					{#if (card.elseChildren ?? []).length === 0}
						<p class="text-surface-700-300 text-xs">No cards yet.</p>
					{/if}
					<CardListDnd
						cards={card.elseChildren ?? []}
						onReorder={(ids) => elseActions?.reorder(ids)}
					>
						{#snippet row(child, i)}
							<ContextCardNode
								card={child}
								{template}
								{onTemplateChange}
								onRemove={() => elseActions?.remove(i)}
								onMoveUp={() => elseActions?.moveUp(i)}
								onMoveDown={() => elseActions?.moveDown(i)}
								canMoveUp={i > 0}
								canMoveDown={i < (card.elseChildren?.length ?? 0) - 1}
								onInsertAbove={(spec) => elseActions?.insertAt(i, spec)}
								showDragHandle={(card.elseChildren?.length ?? 0) > 1}
								{collapsedIds}
								{onToggleCollapsed}
							/>
						{/snippet}
					</CardListDnd>
					{@render addCardMenu(
						(spec) =>
							elseActions?.insertAt(card.elseChildren?.length ?? 0, spec),
						"Add Card",
						"Add Card"
					)}
				</div>
			{:else}
				<button
					type="button"
					class="btn btn-sm preset-outlined-secondary-500 mt-1 self-start"
					onclick={handleAddElse}
				>
					<Icons.Plus size={14} />
					Add Else
				</button>
			{/if}
		</div>
	{/if}
</div>
