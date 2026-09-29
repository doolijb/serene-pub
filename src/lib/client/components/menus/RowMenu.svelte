<script lang="ts" module>
	import type { Component, Snippet } from "svelte"

	/** One action in a `RowMenu`. */
	export interface RowMenuItem {
		label: string
		/** A lucide icon component, drawn at 16px before the label. */
		icon?: Component<any>
		onSelect?: () => void
		/** Delete, Remove, Detach: error ink and an error-tinted hover. */
		destructive?: boolean
		disabled?: boolean
		/** A navigation item: rendered as a link instead of an action. */
		href?: string
		/** Tooltip for the row, eg. why it is disabled. */
		title?: string
	}

	/** A rule between groups of items. */
	export interface RowMenuSeparator {
		separator: true
	}

	export type RowMenuEntry = RowMenuItem | RowMenuSeparator

	/**
	 * What a caller may pass: falsy entries are dropped, so a conditional item
	 * is written inline (`canDelete && { label: "Delete", … }`).
	 */
	export type RowMenuEntries = Array<RowMenuEntry | false | null | undefined>
</script>

<script lang="ts">
	/**
	 * The app's one action menu (STYLE-GUIDE §6.6): a `⋯` trigger (or the
	 * caller's own) opening a bordered `bg-surface-50-950` panel of 36px
	 * `role="menuitem"` rows. Built on Skeleton's `Menu`, which owns the
	 * menu roles, the roving highlight, arrows/Home/End/typeahead, Escape and
	 * the focus return to the trigger.
	 *
	 * Items are data, not markup, so every menu in the app draws the same row.
	 */
	import { Menu, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"

	type Placement =
		| "bottom-end"
		| "bottom-start"
		| "top-end"
		| "top-start"
		| "left"
		| "right"
		| "bottom"
		| "top"

	interface Props {
		items: RowMenuEntries
		/** The menu's accessible name, and the default trigger's ("… options"). */
		label: string
		/** Replaces the trigger's CONTENT (it stays a Skeleton trigger button). */
		trigger?: Snippet<[{ open: boolean }]>
		/** Replaces the default trigger's classes. */
		triggerClass?: string
		/** Accessible name for the trigger; defaults to "<label> options". */
		triggerLabel?: string
		/** Tooltip on the trigger. */
		triggerTitle?: string
		/** Horizontal `⋯` instead of the vertical one. */
		horizontal?: boolean
		placement?: Placement
		/** Panel width in px (capped at 90vw). */
		width?: number
		disabled?: boolean
		open?: boolean
		/** Called as the menu opens or closes, eg. to fetch what it shows. */
		onOpenChange?: (open: boolean) => void
		/**
		 * Facts about the thing, above the items (a file's size and origin).
		 * Not a title: the trigger already names the menu.
		 */
		header?: Snippet
	}

	let {
		items,
		label,
		trigger,
		triggerClass,
		triggerLabel,
		triggerTitle,
		horizontal = false,
		placement = "bottom-end",
		width = 240,
		disabled = false,
		open = $bindable(false),
		onOpenChange,
		header
	}: Props = $props()

	const entries = $derived(
		items.filter((e): e is RowMenuEntry => !!e)
	)

	/** Separators at either end or doubled up say nothing; drop them. */
	const shown = $derived.by(() => {
		const out: Array<{ entry: RowMenuEntry; key: string }> = []
		entries.forEach((entry, i) => {
			const isSep = "separator" in entry
			if (isSep) {
				const prev = out[out.length - 1]
				if (!prev || "separator" in prev.entry) return
			}
			out.push({ entry, key: String(i) })
		})
		while (out.length && "separator" in out[out.length - 1].entry) out.pop()
		return out
	})

	function select(value: string) {
		const entry = entries[Number(value)]
		if (!entry || "separator" in entry || entry.disabled) return
		entry.onSelect?.()
	}

	const rowClass =
		"flex h-9 w-full cursor-pointer items-center gap-2 rounded-[8px] px-2.5 text-left text-[13px] outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
	const neutralRow =
		"hover:bg-surface-200-800 data-[highlighted]:bg-surface-200-800"
	const destructiveRow =
		"text-error-600-400 hover:bg-error-500/10 data-[highlighted]:bg-error-500/10"
</script>

<!-- The wrapper keeps a click on the trigger from reaching a clickable row
     behind it; the panel is portaled, so its own clicks never bubble here. -->
<span
	role="none"
	class="inline-flex shrink-0"
	onclick={(e) => e.stopPropagation()}
>
	<Menu
		{open}
		onOpenChange={(e) => {
			open = e.open
			onOpenChange?.(e.open)
		}}
		onSelect={(e) => select(e.value)}
		positioning={{ placement }}
		aria-label={label}
	>
		<Menu.Trigger
			class={triggerClass ??
				`btn btn-sm hover:bg-surface-200-800 shrink-0 p-2 ${open ? "bg-surface-200-800" : ""}`}
			aria-label={triggerLabel ?? `${label} options`}
			title={triggerTitle}
			{disabled}
		>
			{#if trigger}
				{@render trigger({ open })}
			{:else if horizontal}
				<Icons.Ellipsis size={16} aria-hidden="true" />
			{:else}
				<Icons.EllipsisVertical size={16} aria-hidden="true" />
			{/if}
		</Menu.Trigger>
		<Portal>
			<Menu.Positioner class="z-[1000]!">
				<Menu.Content
					class="bg-surface-50-950 border-surface-200-800 flex flex-col rounded-[12px] border p-1 shadow-xl outline-none"
					style="width: min(90vw, {width}px)"
				>
					{#if header}
						<div
							role="presentation"
							class="border-surface-200-800 mb-1 border-b px-2.5 pt-1.5 pb-2"
						>
							{@render header()}
						</div>
					{/if}
					{#each shown as { entry, key } (key)}
						{#if "separator" in entry}
							<Menu.Separator
								class="border-surface-200-800 my-1 border-t"
							/>
						{:else if entry.href && !entry.disabled}
							<Menu.Item value={key} valueText={entry.label}>
								{#snippet element(attributes)}
									<a
										{...attributes as Record<string, unknown>}
										href={entry.href}
										title={entry.title}
										class="{rowClass} {entry.destructive
											? destructiveRow
											: neutralRow}"
									>
										{#if entry.icon}
											<entry.icon
												size={16}
												class="shrink-0"
												aria-hidden="true"
											/>
										{/if}
										<span class="min-w-0 truncate">
											{entry.label}
										</span>
									</a>
								{/snippet}
							</Menu.Item>
						{:else}
							<Menu.Item
								value={key}
								valueText={entry.label}
								disabled={entry.disabled}
								title={entry.title}
								class="{rowClass} {entry.destructive
									? destructiveRow
									: neutralRow}"
							>
								{#if entry.icon}
									<entry.icon
										size={16}
										class="shrink-0"
										aria-hidden="true"
									/>
								{/if}
								<span class="min-w-0 truncate">
									{entry.label}
								</span>
							</Menu.Item>
						{/if}
					{/each}
				</Menu.Content>
			</Menu.Positioner>
		</Portal>
	</Menu>
</span>
