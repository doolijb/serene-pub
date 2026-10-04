<script lang="ts">
	/**
	 * "Variables available here" — the template's typed scope as a tree
	 * (typed templates P7).
	 *
	 * The same schema the completion list reads (`scopeTreeNodes`), laid out
	 * whole so an author can browse what a step supplies rather than guess a
	 * prefix. Choosing a row inserts its path at the editor's caret.
	 *
	 * A WAI-ARIA tree: one tab stop (roving `tabindex`), arrows move, Right
	 * opens or steps in, Left closes or steps out, Home/End jump, Enter or
	 * Space inserts. Branches start closed so a large scope reads as its roots;
	 * a variable shelf starts open, and only opens and closes.
	 */
	import { SvelteSet } from "svelte/reactivity"
	import * as Icons from "@lucide/svelte"
	import {
		shapeWord,
		type ShelvedNode
	} from "$lib/shared/utils/templateVariableShelves"

	interface Props {
		nodes: ShelvedNode[]
		/** Insert this node's path at the caret. */
		oninsert: (node: ShelvedNode) => void
		/** False for a read-only template: browse, but nothing to insert into. */
		insertable?: boolean
		/** Rows shown open whatever the reader chose — a filter's matches. */
		reveal?: ReadonlySet<string>
		label?: string
	}

	let {
		nodes,
		oninsert,
		insertable = true,
		reveal,
		label = "Variables available here"
	}: Props = $props()

	const expanded = new SvelteSet<string>()
	/** Shelves the reader closed; every other shelf is open. */
	const closedShelves = new SvelteSet<string>()

	const isOpen = (node: ShelvedNode) =>
		reveal?.has(node.id) ||
		(node.shelf ? !closedShelves.has(node.id) : expanded.has(node.id))
	let focusedId = $state<string | null>(null)
	let treeEl = $state<HTMLUListElement | null>(null)

	interface Row {
		node: ShelvedNode
		level: number
		parentId: string | null
		setSize: number
		posInSet: number
	}

	/** The rows a reader can see, in order — what the arrows walk. */
	const visible = $derived.by(() => {
		const out: Row[] = []
		const walk = (
			list: ShelvedNode[],
			level: number,
			parentId: string | null
		) =>
			list.forEach((node, i) => {
				out.push({
					node,
					level,
					parentId,
					setSize: list.length,
					posInSet: i + 1
				})
				if (node.children && isOpen(node))
					walk(node.children, level + 1, node.id)
			})
		walk(nodes, 1, null)
		return out
	})

	const current = $derived(
		visible.find((r) => r.node.id === focusedId) ?? visible[0]
	)

	function focusRow(id: string) {
		focusedId = id
		queueMicrotask(() =>
			treeEl
				?.querySelector<HTMLElement>(
					`[data-tree-id="${CSS.escape(id)}"]`
				)
				?.focus()
		)
	}

	function setOpen(node: ShelvedNode, open: boolean) {
		if (!node.children) return
		if (node.shelf) {
			if (open) closedShelves.delete(node.id)
			else closedShelves.add(node.id)
		} else if (open) expanded.add(node.id)
		else expanded.delete(node.id)
	}

	function toggle(node: ShelvedNode) {
		setOpen(node, !isOpen(node))
	}

	/** Choosing a row: a shelf opens or closes, anything else inserts. */
	function choose(node: ShelvedNode) {
		if (insertable && !node.shelf) oninsert(node)
		else toggle(node)
	}

	/** Focus the first row — where ↓ from the filter lands. */
	export function focusFirst() {
		if (visible[0]) focusRow(visible[0].node.id)
	}

	function onKeydown(e: KeyboardEvent, row: Row) {
		const i = visible.indexOf(row)
		const node = row.node
		switch (e.key) {
			case "ArrowDown":
				e.preventDefault()
				if (visible[i + 1]) focusRow(visible[i + 1]!.node.id)
				break
			case "ArrowUp":
				e.preventDefault()
				if (visible[i - 1]) focusRow(visible[i - 1]!.node.id)
				break
			case "ArrowRight":
				e.preventDefault()
				if (!node.children) break
				if (!isOpen(node)) setOpen(node, true)
				else focusRow(node.children[0]!.id)
				break
			case "ArrowLeft":
				e.preventDefault()
				if (node.children && isOpen(node)) setOpen(node, false)
				else if (row.parentId) focusRow(row.parentId)
				break
			case "Home":
				e.preventDefault()
				if (visible[0]) focusRow(visible[0].node.id)
				break
			case "End":
				e.preventDefault()
				if (visible.length)
					focusRow(visible[visible.length - 1]!.node.id)
				break
			case "Enter":
			case " ":
				e.preventDefault()
				choose(node)
				break
		}
	}
</script>

<ul
	bind:this={treeEl}
	role="tree"
	aria-label={label}
	class="flex flex-col text-xs"
>
	{#each visible as row (row.node.id)}
		{@const node = row.node}
		{@const open = isOpen(node)}
		<li
			role="treeitem"
			aria-level={row.level}
			aria-setsize={row.setSize}
			aria-posinset={row.posInSet}
			aria-expanded={node.children ? open : undefined}
			aria-selected={current?.node.id === node.id}
			tabindex={current?.node.id === node.id ? 0 : -1}
			data-tree-id={node.id}
			title={node.shelf
				? undefined
				: insertable
					? `Insert ${node.path}`
					: node.path}
			class="{insertable || node.shelf
				? 'cursor-pointer'
				: 'cursor-default'} hover:bg-surface-200-800 focus-visible:outline-primary-500 flex items-start gap-1 rounded py-1 pr-1 focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
			style="padding-left: {(row.level - 1) * 0.75 + 0.25}rem"
			onclick={(e) => {
				focusedId = node.id
				// The chevron opens and closes; the rest of the row inserts.
				if (
					node.children &&
					(e.target as Element | null)?.closest("[data-tree-chevron]")
				)
					toggle(node)
				else choose(node)
			}}
			onkeydown={(e) => onKeydown(e, row)}
			onfocus={() => (focusedId = node.id)}
		>
			<!-- The chevron opens and closes for a pointer; the keyboard uses
			     Left/Right on the row itself, so it is not a second tab stop. -->
			<span
				class="text-surface-600-400 mt-px inline-flex size-4 shrink-0 cursor-pointer items-center justify-center pointer-coarse:size-8"
				aria-hidden="true"
				data-tree-chevron
			>
				{#if node.children}
					<Icons.ChevronRight
						size={12}
						class="transition-transform {open ? 'rotate-90' : ''}"
					/>
				{/if}
			</span>
			{#if node.shelf}
				<span class="min-w-0 flex-1 font-medium">
					{node.label}
					<span class="text-surface-600-400 font-normal">
						{node.children?.length ?? 0}
					</span>
				</span>
			{:else}
				<span class="flex min-w-0 flex-1 flex-col">
					<span class="flex flex-wrap items-baseline gap-x-1.5">
						<span class="font-mono break-all">{node.label}</span>
						{#if node.type}
							<span class="text-surface-600-400">
								{shapeWord(node.type)}
							</span>
						{/if}
						{#if node.optional}
							<span class="text-surface-600-400">(optional)</span>
						{/if}
						{#if node.used}
							<span
								class="preset-tonal-primary inline-flex items-center gap-0.5 rounded px-1"
							>
								<Icons.Check size={10} aria-hidden="true" />
								Used
							</span>
						{/if}
					</span>
					{#if node.description}
						<span class="text-surface-600-400">
							{node.description}
						</span>
					{/if}
					{#if node.writes}
						<code class="font-mono break-all">{node.writes}</code>
					{/if}
					{#if node.example}
						<span class="text-surface-600-400 break-words">
							For example: <span class="font-mono">
								{node.example}
							</span>
						</span>
					{/if}
					{#if node.declarer}
						<span class="text-surface-600-400">
							From {node.declarer}
						</span>
					{/if}
					{#if node.insideEach && row.posInSet === 1}
						<span class="text-surface-600-400">
							Inside <code class="font-mono">
								{node.insideEach.startsWith("#")
									? `{{${node.insideEach}}}`
									: `{% ${node.insideEach} %}`}
							</code>
						</span>
					{/if}
				</span>
			{/if}
		</li>
	{/each}
</ul>
