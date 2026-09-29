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
	 * Space inserts. Branches start closed so a large scope reads as its roots.
	 */
	import { SvelteSet } from "svelte/reactivity"
	import * as Icons from "@lucide/svelte"
	import type { ScopeTreeNode } from "$lib/shared/utils/templateAssist"

	interface Props {
		nodes: ScopeTreeNode[]
		/** Insert this node's path at the caret. */
		oninsert: (node: ScopeTreeNode) => void
		/** False for a read-only template: browse, but nothing to insert into. */
		insertable?: boolean
		label?: string
	}

	let {
		nodes,
		oninsert,
		insertable = true,
		label = "Variables available here"
	}: Props = $props()

	const expanded = new SvelteSet<string>()
	let focusedId = $state<string | null>(null)
	let treeEl = $state<HTMLUListElement | null>(null)

	interface Row {
		node: ScopeTreeNode
		level: number
		parentId: string | null
		setSize: number
		posInSet: number
	}

	/** The rows a reader can see, in order — what the arrows walk. */
	const visible = $derived.by(() => {
		const out: Row[] = []
		const walk = (list: ScopeTreeNode[], level: number, parentId: string | null) =>
			list.forEach((node, i) => {
				out.push({ node, level, parentId, setSize: list.length, posInSet: i + 1 })
				if (node.children && expanded.has(node.id))
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
				?.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(id)}"]`)
				?.focus()
		)
	}

	function toggle(node: ScopeTreeNode) {
		if (!node.children) return
		if (expanded.has(node.id)) expanded.delete(node.id)
		else expanded.add(node.id)
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
				if (!expanded.has(node.id)) expanded.add(node.id)
				else focusRow(node.children[0]!.id)
				break
			case "ArrowLeft":
				e.preventDefault()
				if (node.children && expanded.has(node.id)) expanded.delete(node.id)
				else if (row.parentId) focusRow(row.parentId)
				break
			case "Home":
				e.preventDefault()
				if (visible[0]) focusRow(visible[0].node.id)
				break
			case "End":
				e.preventDefault()
				if (visible.length) focusRow(visible[visible.length - 1]!.node.id)
				break
			case "Enter":
			case " ":
				e.preventDefault()
				if (insertable) oninsert(node)
				else toggle(node)
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
		{@const open = expanded.has(node.id)}
		<li
			role="treeitem"
			aria-level={row.level}
			aria-setsize={row.setSize}
			aria-posinset={row.posInSet}
			aria-expanded={node.children ? open : undefined}
			aria-selected={current?.node.id === node.id}
			tabindex={current?.node.id === node.id ? 0 : -1}
			data-tree-id={node.id}
			title={insertable ? `Insert ${node.path}` : node.path}
			class="{insertable
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
				else if (insertable) oninsert(node)
				else toggle(node)
			}}
			onkeydown={(e) => onKeydown(e, row)}
			onfocus={() => (focusedId = node.id)}
		>
			<!-- The chevron opens and closes for a pointer; the keyboard uses
			     Left/Right on the row itself, so it is not a second tab stop. -->
			<span
				class="text-surface-600-400 pointer-coarse:size-8 mt-px inline-flex size-4 shrink-0 cursor-pointer items-center justify-center"
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
			<span class="flex min-w-0 flex-1 flex-col">
				<span class="flex flex-wrap items-baseline gap-x-1.5">
					<span class="font-mono break-all">{node.label}</span>
					{#if node.type}
						<span class="text-surface-600-400">{node.type}</span>
					{/if}
					{#if node.optional}
						<span class="text-surface-600-400">(optional)</span>
					{/if}
				</span>
				{#if node.description}
					<span class="text-surface-600-400">
						{node.description}
					</span>
				{/if}
				{#if node.declarer}
					<span class="text-surface-600-400">
						From {node.declarer}
					</span>
				{/if}
				{#if node.insideEach && row.posInSet === 1}
					<span class="text-surface-600-400">
						Inside <code class="font-mono"
							>{node.insideEach.startsWith("#")
								? `{{${node.insideEach}}}`
								: `{% ${node.insideEach} %}`}</code
						>
					</span>
				{/if}
			</span>
		</li>
	{/each}
</ul>
