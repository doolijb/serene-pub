<script lang="ts" module>
	export type DrawerTab = "item" | "in" | "out" | "settings" | "run" | "notices"
</script>

<script lang="ts">
	/**
	 * The drawer: everything about the selected node or clause, in tabs along
	 * the bottom of the canvas so the line keeps the width. A card says only
	 * its key; this is where the type id, the ports, the settings and the last
	 * run live (PLAN-pipeline-canvas-and-genre-authoring §3).
	 *
	 * **Settings** mounts the same step editor the Configure tab does, with the
	 * page's draft and save row behind it: the canvas names addresses, a
	 * configuration fills them, one save (plan §0, the config ruling).
	 *
	 * In a draft (§4.4) the drawer is also the editor: an actions row for the
	 * selection, the catalogue when adding, In ports with pickers, and the
	 * Notices tab. Every edit is a pure function handed up through `onEdit`.
	 */
	import * as Icons from "@lucide/svelte"
	import type { Finding, SpecDocument } from "@serene-pub/sdk"
	import PanelTabStrip, { type PanelTab } from "$lib/client/components/panels/PanelTabStrip.svelte"
	import PipelineConfigOptions from "$lib/client/components/pipelines/PipelineConfigOptions.svelte"
	import { CLAUSE_LABEL, CLAUSE_MEANING, KIND_MEANING, KIND_STRIPE } from "../flow/context"
	import { portsOf, type LineModel, type NodeRun } from "./lineModel"
	import { STATUS_LABEL, predicateSentence } from "./canvasTokens"
	import { SPEC_NAME, type CatalogueEntry, type CompositeEntry } from "./draft.svelte"
	import {
		addBranch,
		addClause,
		extractComposite,
		insertComposite,
		insertNode,
		moveNode,
		nextKey,
		removeBranch,
		removeClause,
		removeNode,
		renameBranch,
		renameKey,
		setLiteral,
		setSlotRef,
		upstreamOf,
		wire
	} from "./edits"

	interface Props {
		doc: SpecDocument
		model: LineModel
		selected: string | null
		/** The step this node is configured by, or null when it declares nothing. */
		stepKeyOf: (key: string) => string | null
		/** The selected node's last run, when the receipt overlay is on and it ran. */
		run: NodeRun | null
		/** Whether a receipt is loaded at all (else the tab says so). */
		hasReceipt: boolean
		/** Bindable. */
		tab?: DrawerTab
		/** Bindable. */
		collapsed?: boolean
		/** For Settings — the page's draft and configuration. */
		slug: string
		editsConfigId?: number
		readOnlyName?: string | null
		pending: Record<string, unknown>
		pendingClears: string[]
		onDraftSet: (option: Sockets.Pipelines.Option, value: unknown) => void
		onDraftClear: (option: Sockets.Pipelines.Option) => void
		onLoaded: (detail: Sockets.Pipelines.NamespaceDetail) => void
		/** The editor (P2): a draft is open. */
		editing?: boolean
		busy?: boolean
		catalogue?: CatalogueEntry[] | null
		composites?: CompositeEntry[]
		/** The owner segment every composite saved from this spec lives under. */
		ownerSlug?: string
		findings?: Finding[]
		onEdit?: (fn: (doc: SpecDocument) => SpecDocument) => Promise<boolean>
		onSelect?: (key: string) => void
		onSaveComposite?: (slug: string, label: string, document: CompositeEntry["document"]) => Promise<boolean>
	}

	let {
		doc,
		model,
		selected,
		stepKeyOf,
		run,
		hasReceipt,
		tab = $bindable("item"),
		collapsed = $bindable(false),
		slug,
		editsConfigId,
		readOnlyName = null,
		pending,
		pendingClears,
		onDraftSet,
		onDraftClear,
		onLoaded,
		editing = false,
		busy = false,
		catalogue = null,
		composites = [],
		ownerSlug = "",
		findings = [],
		onEdit = async () => false,
		onSelect = () => {},
		onSaveComposite = async () => false
	}: Props = $props()

	const node = $derived(selected ? (model.nodes.get(selected) ?? null) : null)
	const clause = $derived(selected ? (model.clauses.get(selected) ?? null) : null)
	const ports = $derived(selected ? portsOf(doc, selected) : { in: [], out: [] })
	const stepKey = $derived(selected ? stepKeyOf(selected) : null)
	const members = $derived.by(() => {
		if (!clause) return []
		const id = clause.id
		return [...model.pathOf.entries()]
			.filter(([k, path]) => path.includes(id) && model.nodes.has(k))
			.map(([k]) => model.nodes.get(k)!)
	})
	const errorCount = $derived(findings.filter((f) => f.severity === "error").length)

	const tabs: PanelTab[] = $derived([
		{ value: "item", label: clause ? "Clause" : "Node", icon: clause ? Icons.Box : Icons.Hash },
		{ value: "in", label: "In ports", icon: Icons.ArrowDownToLine, count: ports.in.length || undefined },
		{ value: "out", label: "Out ports", icon: Icons.ArrowUpFromLine, count: ports.out.length || undefined },
		{ value: "settings", label: "Settings", icon: Icons.SlidersHorizontal },
		{ value: "run", label: "Last run", icon: Icons.History, count: run?.iterations && run.iterations > 1 ? run.iterations : undefined },
		...(editing
			? [{ value: "notices", label: "Notices", icon: Icons.ShieldAlert, count: findings.length || undefined, hasError: errorCount > 0 }]
			: [])
	])

	const ROW = "border-surface-200-800 flex items-baseline justify-between gap-3 border-b py-1 text-sm last:border-b-0"
	const KEY = "text-surface-600-400 shrink-0"
	const VAL = "min-w-0 truncate text-right font-mono text-xs"
	const ACT = "btn btn-sm preset-tonal-surface"

	const literalPreview = (v: unknown) => {
		const s = typeof v === "string" ? v : JSON.stringify(v)
		return s.length > 60 ? `${s.slice(0, 57)}…` : s
	}

	/* ── editing state ────────────────────────────────────────────── */
	let adding = $state<{ after: string | null; container: { clauseId: string; chain: string } | null } | null>(null)
	let search = $state("")
	let kindFilter = $state<string>("all")
	let renaming = $state(false)
	let renameValue = $state("")
	let confirmingRemove = $state(false)
	let addingBranch = $state(false)
	let branchName = $state("")
	let branchOtherwise = $state(false)
	let addingClause = $state(false)
	let clauseKind = $state<"gather" | "each" | "junction" | "loop">("gather")
	let clauseId = $state("")
	let inBranch = $state("")
	let literalEditing = $state<string | null>(null)
	let literalValue = $state("")
	let removeHint = $state<string | null>(null)
	let savingComposite = $state(false)
	let compositeTo = $state("")
	let compositeName = $state("")
	let compositeLabel = $state("")

	$effect(() => {
		// A new selection clears every transient editor state.
		void selected
		renaming = false
		confirmingRemove = false
		addingBranch = false
		addingClause = false
		literalEditing = null
		removeHint = null
		savingComposite = false
	})

	/** The selection's later siblings in its container: where "Save as step" may end. */
	const laterSiblings = $derived.by(() => {
		if (!selected) return []
		const container = containerOf(selected)
		const list = container
			? (findClause(model.rows, container.clauseId)?.branches.find((b) => b.name === container.chain)?.rows ?? [])
			: model.rows
		const i = list.findIndex((r) => r.key === selected)
		return i < 0 ? [] : list.slice(i).map((r) => r.key)
	})
	const compositeOk = $derived(SPEC_NAME.test(compositeName) && compositeLabel.trim().length > 0 && !!ownerSlug && ownerSlug !== "core")
	async function doSaveComposite() {
		if (!selected || !compositeOk) return
		const document = extractComposite(doc, { from: selected, to: compositeTo || selected })
		const ok = await onSaveComposite(`${ownerSlug}:composite/${compositeName}`, compositeLabel.trim(), document)
		if (ok) {
			savingComposite = false
			compositeName = ""
			compositeLabel = ""
		}
	}
	async function insertFromLibrary(entry: CompositeEntry) {
		if (!adding) return
		const where = adding
		const base = camel(entry.slug.split("/").pop() ?? "step")
		let key = ""
		let first = ""
		const ok = await onEdit((d) => {
			key = nextKey(d, where.container ? `${where.container.clauseId}.${where.container.chain}.${base}` : base)
			const next = insertComposite(d, { after: where.after, container: where.container, key: key.split(".").pop()!, composite: entry.document as any, fragmentId: entry.slug })
			// The composite has no card of its own: land on its first member.
			const members = [...next.nodes, ...next.clauses.map((c) => ({ key: c.id, position: c.position }))]
				.filter((m) => m.key.startsWith(`${key}.`))
				.sort((a, b) => a.position - b.position)
			first = members[0]?.key ?? ""
			return next
		})
		if (ok) {
			adding = null
			search = ""
			if (first) onSelect(first)
			tab = "item"
		}
	}

	const containerOf = (key: string): { clauseId: string; chain: string } | null => {
		const n = model.nodes.get(key)
		if (n) return n.clauseId ? { clauseId: n.clauseId, chain: n.clauseChain ?? "" } : null
		const c = model.clauses.get(key)
		if (c) return c.clauseId ? { clauseId: c.clauseId, chain: c.clauseChain ?? "" } : null
		return null
	}
	const shortName = (key: string) => key.split(".").pop() ?? key
	const camel = (s: string) => s.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())

	/** The last member of a clause branch, for "add in branch" placement. */
	const lastIn = (id: string, chain: string): string | null => {
		const row = model.rows.length ? findClause(model.rows, id) : null
		const branch = row?.branches.find((b) => b.name === chain)
		return branch?.rows.at(-1)?.key ?? null
	}
	function findClause(rows: LineModel["rows"], id: string): Extract<LineModel["rows"][number], { kind: "clause" }> | null {
		for (const r of rows) {
			if (r.kind !== "clause") continue
			if (r.key === id) return r
			for (const b of r.branches) {
				const found = findClause(b.rows, id)
				if (found) return found
			}
		}
		return null
	}

	const filtered = $derived.by(() => {
		if (!catalogue) return []
		const q = search.trim().toLowerCase()
		return catalogue
			.filter((e) => e.kind !== "inlet" && e.kind !== "entry")
			.filter((e) => kindFilter === "all" || e.kind === kindFilter)
			.filter((e) => !q || e.id.toLowerCase().includes(q) || String(nameOf(e)).toLowerCase().includes(q))
			.slice(0, 60)
	})
	const nameOf = (e: CatalogueEntry) => {
		const n = e.i18n?.name
		if (typeof n === "string") return n
		if (n && typeof n === "object" && "en" in (n as object)) return String((n as { en: unknown }).en)
		// No display name: the definition's own name, as words.
		const tail = e.id.split("/").pop() ?? e.id
		return tail.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase())
	}

	async function insert(entry: CatalogueEntry) {
		if (!adding) return
		const where = adding
		const base = camel(entry.id.split("/").pop() ?? entry.id)
		let key = ""
		const ok = await onEdit((d) => {
			const qualified = where.container ? `${where.container.clauseId}.${where.container.chain}.${base}` : base
			key = nextKey(d, qualified)
			return insertNode(d, {
				after: where.after,
				container: where.container,
				key,
				definitionId: entry.id,
				definitionVersion: entry.version,
				kind: entry.kind,
				config: {}
			})
		})
		if (ok) {
			adding = null
			search = ""
			onSelect(key)
			tab = "in"
		}
	}

	function startAddAfter() {
		search = ""
		kindFilter = "all"
		if (!selected) {
			adding = { after: null, container: null }
			return
		}
		adding = { after: selected, container: containerOf(selected) }
	}
	function startAddInBranch() {
		search = ""
		kindFilter = "all"
		if (!clause) return
		const chain = inBranch || clause.chains[0]
		if (!chain) return
		adding = { after: lastIn(clause.id, chain), container: { clauseId: clause.id, chain } }
	}
	async function doRemove() {
		if (!selected) return
		const key = selected
		const ok = await onEdit((d) => (model.clauses.has(key) ? removeClause(d, key).doc : removeNode(d, key).doc))
		if (ok) confirmingRemove = false
	}
	function startRemove() {
		if (!selected) return
		const key = selected
		const result = model.clauses.has(key) ? removeClause(doc, key) : removeNode(doc, key)
		removeHint = result.severed.length
			? `${result.severed.length} ${result.severed.length === 1 ? "port loses" : "ports lose"} a source: ${result.severed.map((s) => `${s.key}.${s.path}`).join(", ")}`
			: "Nothing else reads it."
		confirmingRemove = true
	}
	async function doRename() {
		if (!selected || !renameValue.trim()) return
		const from = selected
		const parent = from.includes(".") ? from.slice(0, from.lastIndexOf(".") + 1) : ""
		const to = parent + renameValue.trim()
		const ok = await onEdit((d) => renameKey(d, from, to))
		if (ok) {
			renaming = false
			onSelect(to)
		}
	}
	async function doMove(dir: "up" | "down") {
		if (!selected) return
		const key = selected
		await onEdit((d) => moveNode(d, key, dir))
	}
	async function doAddBranch() {
		if (!clause || !branchName.trim()) return
		const id = clause.id
		const name = branchName.trim()
		const predicate = clause.kind === "junction" ? (branchOtherwise ? { default: true } : { truthy: true, path: name }) : undefined
		const ok = await onEdit((d) => addBranch(d, id, name, predicate as any))
		if (ok) {
			addingBranch = false
			branchName = ""
			branchOtherwise = false
		}
	}
	async function doRemoveBranch(name: string) {
		if (!clause) return
		const id = clause.id
		await onEdit((d) => removeBranch(d, id, name).doc)
	}
	async function doRenameBranch(from: string) {
		if (!clause) return
		const id = clause.id
		const to = window.prompt?.(`Rename branch ${from} to:`, from)
		if (!to || to === from) return
		await onEdit((d) => renameBranch(d, id, from, to))
	}
	async function doAddClause() {
		if (!clauseId.trim()) return
		const after = selected
		const container = selected ? containerOf(selected) : null
		const id = (container ? `${container.clauseId}.${container.chain}.` : "") + clauseId.trim()
		const kind = clauseKind
		const ok = await onEdit((d) =>
			addClause(d, {
				after,
				container,
				id,
				kind,
				mode: kind === "loop" ? "sequential" : "parallel",
				max: kind === "each" || kind === "loop" ? 4 : undefined,
				chains: kind === "each" || kind === "loop" ? ["item"] : ["a"],
				branches: kind === "junction" ? { a: { default: true } } : undefined
			} as any)
		)
		if (ok) {
			addingClause = false
			clauseId = ""
			onSelect(id)
		}
	}

	/* ── In ports as an editor ────────────────────────────────────── */
	const entryOf = (definitionId: string, version?: number): CatalogueEntry | undefined =>
		catalogue?.find((e) => e.id === definitionId && (version == null || e.version === version)) ??
		catalogue?.find((e) => e.id === definitionId)
	const CLAUSE_OUT = ["main", "values", "branches", "ok"]
	const outPortsOf = (key: string): string[] => {
		const n = model.nodes.get(key)
		if (n) {
			const e = entryOf(n.definitionId, n.definitionVersion)
			const declared = e ? Object.keys(e.ports?.out ?? {}) : []
			return declared.length ? declared : ["main"]
		}
		if (model.clauses.has(key)) return CLAUSE_OUT
		return ["main"]
	}
	/** Every `key.port` the selected node could read. */
	const sources = $derived.by(() => {
		if (!editing || !selected) return []
		const out: string[] = []
		for (const k of upstreamOf(doc, selected)) for (const p of outPortsOf(k)) out.push(`${k}.${p}`)
		return out
	})
	/** The rows of the In ports editor: declared in ports first, then whatever else the config holds. */
	const inRows = $derived.by(() => {
		// An implicit spine edge is the compiler's, not a choice: it shows as nothing chosen.
		const current = new Map(ports.in.filter((p) => !p.implicit).map((p) => [p.port, p]))
		const declared = node ? Object.keys(entryOf(node.definitionId, node.definitionVersion)?.ports?.in ?? {}) : []
		const names = [...declared]
		// A port the config names is a row too; an implicit spine edge alone is not a port of this step.
		for (const p of ports.in) if (!p.implicit && !names.includes(p.port)) names.push(p.port)
		return names.map((port) => ({ port, current: current.get(port) ?? null }))
	})
	const sourceValue = (p: { from: string; source: string } | null) => {
		if (!p) return ""
		if (p.source === "edge") return p.from
		if (p.source === "slot") return "slot"
		return "literal"
	}
	async function pickSource(port: string, value: string) {
		if (!selected) return
		const key = selected
		if (value === "") await onEdit((d) => wire(d, key, port, null))
		else if (value === "slot") await onEdit((d) => setSlotRef(d, key, port, { __ref: "slot", slot: port } as any))
		else if (value === "literal") {
			literalEditing = port
			literalValue = ""
		} else {
			const i = value.lastIndexOf(".")
			const source = { node: value.slice(0, i), port: value.slice(i + 1) }
			await onEdit((d) => wire(d, key, port, source))
		}
	}
	async function commitLiteral(port: string) {
		if (!selected) return
		const key = selected
		let value: unknown = literalValue
		try {
			value = JSON.parse(literalValue)
		} catch {
			/* a plain string */
		}
		const ok = await onEdit((d) => setLiteral(d, key, port, value))
		if (ok) literalEditing = null
	}
</script>

<section
	class="bg-surface-50-950 border-surface-200-800 flex shrink-0 flex-col border-t"
	style="height: {collapsed ? 'auto' : editing ? '18rem' : '15.5rem'}"
	aria-label="Selected step"
>
	<div class="flex items-center gap-2 px-3">
		<button
			type="button"
			class="hover:bg-surface-200-800 flex size-7 shrink-0 items-center justify-center rounded"
			aria-label={collapsed ? "Open the drawer" : "Collapse the drawer"}
			aria-expanded={!collapsed}
			onclick={() => (collapsed = !collapsed)}
		>
			{#if collapsed}<Icons.PanelBottomOpen size={16} />{:else}<Icons.PanelBottomClose size={16} />{/if}
		</button>
		{#if selected}
			{#if renaming}
				<input class="input h-7 w-56 font-mono text-chip" aria-label="New key" bind:value={renameValue} onkeydown={(e) => (e.key === "Enter" ? doRename() : e.key === "Escape" ? (renaming = false) : null)} />
				<button type="button" class="btn btn-sm preset-filled-primary-500" disabled={busy || !renameValue.trim()} onclick={doRename}>Rename</button>
				<button type="button" class={ACT} onclick={() => (renaming = false)}>Cancel</button>
			{:else}
				<span class="truncate font-mono text-sm">{selected}</span>
				<span class="text-surface-600-400 shrink-0 font-mono text-meta">
					{#if node}{node.kind}{:else if clause}{CLAUSE_LABEL[clause.kind] ?? clause.kind} · {clause.chains.length} {clause.chains.length === 1 ? (clause.kind === "junction" ? "branch" : "chain") : clause.kind === "junction" ? "branches" : "chains"}{/if}
				</span>
			{/if}
		{:else}
			<span class="text-surface-600-400 text-sm">{editing && model.rows.length === 0 ? "Add the first step." : "Pick a card on the line."}</span>
		{/if}
		<div class="min-w-0 flex-1">
			{#if selected && !adding}
				<PanelTabStrip
					{tabs}
					bind:value={tab}
					ariaLabel="About the selected step"
					panelIdPrefix="canvas-drawer"
					class="[&_[role=tab]>svg]:hidden @min-[700px]/content:[&_[role=tab]>svg]:block"
				/>
			{/if}
		</div>
	</div>

	{#if editing && !collapsed && !adding}
		<!-- ── the actions row ─────────────────────────────────── -->
		<div class="border-surface-200-800 flex flex-wrap items-center gap-1.5 border-t px-3 py-1.5" aria-label="Edit the selection">
			{#if confirmingRemove}
				<span class="text-sm">Remove <span class="font-mono">{selected}</span>? <span class="text-surface-600-400">{removeHint}</span></span>
				<button type="button" class="btn btn-sm preset-filled-error-500" disabled={busy} onclick={doRemove}>Remove</button>
				<button type="button" class={ACT} onclick={() => (confirmingRemove = false)}>Cancel</button>
			{:else if addingBranch && clause}
				<input class="input h-7 w-40 font-mono text-xs" placeholder={clause.kind === "junction" ? "branch name" : "chain name"} aria-label="Branch name" bind:value={branchName} onkeydown={(e) => e.key === "Enter" && doAddBranch()} />
				{#if clause.kind === "junction"}
					<label class="flex items-center gap-1 text-xs"><input type="checkbox" class="checkbox" bind:checked={branchOtherwise} /> otherwise</label>
				{/if}
				<button type="button" class="btn btn-sm preset-filled-primary-500" disabled={busy || !branchName.trim()} onclick={doAddBranch}>Add</button>
				<button type="button" class={ACT} onclick={() => (addingBranch = false)}>Cancel</button>
			{:else if addingClause}
				<select class="select h-7 w-32 text-xs" aria-label="Clause kind" bind:value={clauseKind}>
					<option value="gather">gather</option><option value="each">each</option><option value="junction">junction</option><option value="loop">loop</option>
				</select>
				<input class="input h-7 w-40 font-mono text-xs" placeholder="clause id" aria-label="Clause id" bind:value={clauseId} onkeydown={(e) => e.key === "Enter" && doAddClause()} />
				<button type="button" class="btn btn-sm preset-filled-primary-500" disabled={busy || !clauseId.trim()} onclick={doAddClause}>Add clause {selected ? "after" : "first"}</button>
				<button type="button" class={ACT} onclick={() => (addingClause = false)}>Cancel</button>
			{:else}
				<button type="button" class={ACT} disabled={busy} onclick={startAddAfter}><Icons.Plus size={14} /> {selected ? "Add after…" : "Add first step…"}</button>
				<button type="button" class={ACT} disabled={busy} onclick={() => (addingClause = true)}><Icons.Box size={14} /> {selected ? "Add clause after…" : "Add a clause…"}</button>
				{#if clause}
					<span class="text-surface-600-400 text-xs">in</span>
					<select class="select h-7 w-32 text-xs" aria-label="Which branch" bind:value={inBranch}>
						{#each clause.chains as c (c)}<option value={c}>{c}</option>{/each}
					</select>
					<button type="button" class={ACT} disabled={busy} onclick={startAddInBranch}><Icons.CornerDownRight size={14} /> Add node in branch…</button>
					<button type="button" class={ACT} disabled={busy} onclick={() => (addingBranch = true)}><Icons.GitBranch size={14} /> Add {clause.kind === "junction" ? "branch" : "chain"}…</button>
				{/if}
				{#if selected}
					<button type="button" class={ACT} disabled={busy} title="Move up" aria-label="Move up" onclick={() => doMove("up")}><Icons.ArrowUp size={14} /></button>
					<button type="button" class={ACT} disabled={busy} title="Move down" aria-label="Move down" onclick={() => doMove("down")}><Icons.ArrowDown size={14} /></button>
					<button type="button" class={ACT} disabled={busy} onclick={() => { renameValue = shortName(selected ?? ""); renaming = true }}><Icons.PencilLine size={14} /> Rename…</button>
					<button type="button" class="btn btn-sm preset-tonal-surface text-error-600-400" disabled={busy} onclick={startRemove}><Icons.Trash2 size={14} /> Remove…</button>
					<button type="button" class={ACT} disabled={busy || !ownerSlug || ownerSlug === "core"} title={ownerSlug && ownerSlug !== "core" ? "Save these steps to the library as one composite step" : "Copy this pipeline under your own slug first"} onclick={() => { compositeTo = selected ?? ""; savingComposite = true }}><Icons.Layers size={14} /> Save as step…</button>
				{/if}
			{/if}
		</div>
		{#if savingComposite && selected}
			<div class="border-surface-200-800 flex flex-wrap items-center gap-1.5 border-t px-3 py-1.5 text-sm" aria-label="Save as a composite step">
				<span>From <span class="font-mono">{shortName(selected)}</span> to</span>
				<select class="select h-7 w-40 text-xs" aria-label="Last step of the composite" value={compositeTo} onchange={(e) => (compositeTo = (e.currentTarget as HTMLSelectElement).value)}>
					{#each laterSiblings as k (k)}<option value={k}>{shortName(k)}</option>{/each}
				</select>
				<input class="input h-7 w-36 font-mono text-xs" placeholder="name" aria-label="Composite name" bind:value={compositeName} />
				<input class="input h-7 w-44 text-xs" placeholder="Label" aria-label="Composite label" bind:value={compositeLabel} onkeydown={(e) => e.key === "Enter" && doSaveComposite()} />
				<span class="text-surface-600-400 font-mono text-meta">{ownerSlug}:composite/{compositeName || "…"}</span>
				<button type="button" class="btn btn-sm preset-filled-primary-500" disabled={busy || !compositeOk} onclick={doSaveComposite}>Save</button>
				<button type="button" class={ACT} onclick={() => (savingComposite = false)}>Cancel</button>
			</div>
		{/if}
	{/if}

	{#if !collapsed && adding}
		<!-- ── the catalogue ───────────────────────────────────── -->
		<div class="border-surface-200-800 flex items-center gap-2 border-t px-3 py-1.5">
			<span class="text-sm">Add a step {adding.after ? `after ${adding.after}` : adding.container ? `in ${adding.container.clauseId} › ${adding.container.chain}` : "first"}</span>
			<input class="input h-7 w-64 text-chip" placeholder="Search the catalogue…" aria-label="Search the catalogue" bind:value={search} />
			<div class="flex gap-1" role="group" aria-label="Kind">
				{#each ["all", "query", "task", "oracle", "outlet", "composite"] as k (k)}
					<button type="button" class="chip {kindFilter === k ? 'preset-tonal-primary' : 'preset-tonal-surface'} text-meta" aria-pressed={kindFilter === k} onclick={() => (kindFilter = k)}>{k}</button>
				{/each}
			</div>
			<div class="flex-1"></div>
			<button type="button" class={ACT} onclick={() => (adding = null)}>Cancel</button>
		</div>
		<div class="min-h-0 flex-1 overflow-y-auto px-3 py-2">
			{#if !catalogue}
				<p class="text-surface-600-400 text-sm italic">Reading the catalogue…</p>
			{:else if kindFilter === "composite"}
				{@const q = search.trim().toLowerCase()}
				{@const mine = composites.filter((c) => !q || c.slug.includes(q) || c.label.toLowerCase().includes(q))}
				{#if mine.length === 0}
					<p class="text-surface-600-400 text-sm">No composite steps saved yet. Select a run of steps and use <strong>Save as step…</strong>.</p>
				{:else}
					<div class="grid gap-1.5 @min-[700px]/content:grid-cols-2 @min-[1100px]/content:grid-cols-3">
						{#each mine as c (c.slug)}
							<button type="button" class="bg-surface-100-900 border-surface-200-800 hover:border-primary-500/60 flex h-11 items-center gap-2 rounded-md border px-2 text-left" disabled={busy} onclick={() => insertFromLibrary(c)}>
								<span aria-hidden="true" class="bg-tertiary-500 h-6 w-[3px] shrink-0"></span>
								<span class="min-w-0 flex-1">
									<span class="block truncate text-chip">{c.label}</span>
									<span class="text-surface-600-400 block truncate font-mono text-meta">{c.slug} · {c.nodeCount} {c.nodeCount === 1 ? "step" : "steps"}{c.reads.length ? ` · reads ${c.reads.length}` : ""}</span>
								</span>
							</button>
						{/each}
					</div>
				{/if}
			{:else if filtered.length === 0}
				<p class="text-surface-600-400 text-sm">Nothing matches.</p>
			{:else}
				<div class="grid gap-1.5 @min-[700px]/content:grid-cols-2 @min-[1100px]/content:grid-cols-3">
					{#each filtered as e (e.id + "@" + e.version)}
						<button type="button" class="bg-surface-100-900 border-surface-200-800 hover:border-primary-500/60 flex h-11 items-center gap-2 rounded-md border px-2 text-left" disabled={busy} onclick={() => insert(e)}>
							<span aria-hidden="true" class="h-6 w-[3px] shrink-0 {KIND_STRIPE[e.kind] ?? 'bg-surface-400-600'}"></span>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-chip">{nameOf(e)}</span>
								<span class="text-surface-600-400 block truncate font-mono text-meta">{e.id}@{e.version}{e.owner ? ` · ${e.owner}` : ""}</span>
							</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{:else if !collapsed && selected}
		<div
			id="canvas-drawer-{tab}"
			role="tabpanel"
			aria-labelledby="canvas-drawer-{tab}-tab"
			class="min-h-0 flex-1 overflow-y-auto px-4 py-2"
		>
			{#if tab === "item"}
				{#if node}
					<div class="@min-[700px]/content:grid-cols-2 grid gap-x-6">
						<div>
							<div class={ROW}><span class={KEY}>type</span><span class={VAL}>{node.definitionId}@{node.definitionVersion}</span></div>
							<div class={ROW}><span class={KEY}>kind</span><span class="min-w-0 text-right text-sm"><span class="mr-1.5 inline-block h-2.5 w-[3px] align-middle {KIND_STRIPE[node.kind]}"></span>{node.kind} · {KIND_MEANING[node.kind] ?? ""}</span></div>
							{#if node.clauseId}
								<div class={ROW}><span class={KEY}>inside</span><span class={VAL}>{node.clauseId} › {node.clauseChain}</span></div>
							{/if}
							<div class={ROW}><span class={KEY}>position</span><span class={VAL}>{node.position}</span></div>
						</div>
						<div>
							{#if node.expose?.label}
								<div class={ROW}><span class={KEY}>label</span><span class="min-w-0 truncate text-right text-sm">{typeof node.expose.label === "string" ? node.expose.label : JSON.stringify(node.expose.label)}</span></div>
							{/if}
							{#if node.expose?.status}
								<div class={ROW}><span class={KEY}>status while running</span><span class="min-w-0 truncate text-right text-sm">{typeof node.expose.status === "string" ? node.expose.status : JSON.stringify(node.expose.status)}</span></div>
							{/if}
							{#if node.expose?.purpose}
								<p class="text-surface-600-400 py-1 text-sm">{typeof node.expose.purpose === "string" ? node.expose.purpose : JSON.stringify(node.expose.purpose)}</p>
							{/if}
							<div class={ROW}><span class={KEY}>configured by</span><span class={VAL}>{stepKey ? "a step · see Settings" : "nothing · declares no settings"}</span></div>
						</div>
					</div>
				{:else if clause}
					<div class="@min-[700px]/content:grid-cols-2 grid gap-x-6">
						<div>
							<div class={ROW}><span class={KEY}>rule</span><span class="min-w-0 text-right text-sm">{CLAUSE_LABEL[clause.kind] ?? clause.kind} · {CLAUSE_MEANING[clause.kind] ?? ""}</span></div>
							<div class={ROW}><span class={KEY}>mode</span><span class={VAL}>{clause.mode}</span></div>
							{#if clause.max != null}
								<div class={ROW}><span class={KEY}>ceiling</span><span class={VAL}>{clause.max}</span></div>
							{/if}
							<div class={ROW}><span class={KEY}>nodes inside</span><span class={VAL}>{members.length}</span></div>
							{#if clause.clauseId}
								<div class={ROW}><span class={KEY}>inside</span><span class={VAL}>{clause.clauseId} › {clause.clauseChain}</span></div>
							{/if}
						</div>
						<div>
							{#each clause.chains as name (name)}
								<div class={ROW}>
									<span class={KEY}>{name}</span>
									<span class="flex min-w-0 items-center gap-2 text-right text-sm">
										<span class="truncate">{#if clause.branches?.[name]}{predicateSentence(clause.branches[name])}{:else}{clause.kind === "each" || clause.kind === "loop" ? "the body" : "a chain"}{/if}</span>
										{#if editing}
											<button type="button" class="text-surface-600-400 hover:text-surface-950-50" title="Rename {name}" aria-label="Rename {name}" onclick={() => doRenameBranch(name)}><Icons.PencilLine size={12} /></button>
											<button type="button" class="text-surface-600-400 hover:text-error-600-400" title="Remove {name}" aria-label="Remove {name}" disabled={clause.chains.length <= 1} onclick={() => doRemoveBranch(name)}><Icons.X size={12} /></button>
										{/if}
									</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			{:else if tab === "in"}
				{#if editing && node}
					{#if inRows.length === 0}
						<p class="text-surface-600-400 text-sm">This step declares no in ports.</p>
					{:else}
						<div class="@min-[700px]/content:grid-cols-2 grid gap-x-6">
							{#each inRows as r (r.port)}
								<div class={ROW}>
									<span class={KEY}>{r.port}</span>
									<span class="flex min-w-0 items-center gap-1">
										{#if literalEditing === r.port}
											<input class="input h-7 w-44 font-mono text-xs" aria-label="Literal for {r.port}" placeholder="text, or JSON" bind:value={literalValue} onkeydown={(e) => (e.key === "Enter" ? commitLiteral(r.port) : e.key === "Escape" ? (literalEditing = null) : null)} />
											<button type="button" class="btn btn-sm preset-filled-primary-500" disabled={busy} onclick={() => commitLiteral(r.port)}>Set</button>
										{:else}
											<select class="select h-7 max-w-56 text-xs" aria-label="Source for {r.port}" disabled={busy} value={sourceValue(r.current)} onchange={(e) => pickSource(r.port, (e.currentTarget as HTMLSelectElement).value)}>
												<option value="">— nothing —</option>
												<option value="slot">a slot (the configuration fills it)</option>
												<option value="literal">a literal…</option>
												{#each sources as s (s)}<option value={s}>{s}</option>{/each}
												{#if r.current?.source === "edge" && !sources.includes(r.current.from)}<option value={r.current.from}>{r.current.from}</option>{/if}
											</select>
											{#if !r.current && ports.in.some((p) => p.port === r.port && p.implicit)}
												<span class="text-surface-500 text-meta">the step before, unless wired</span>
											{/if}
											{#if r.current?.source === "literal"}
												<button type="button" class="text-surface-600-400 font-mono text-meta hover:underline" title="Edit the literal" onclick={() => { literalEditing = r.port; literalValue = typeof r.current?.literal === "string" ? r.current.literal : JSON.stringify(r.current?.literal) }}>{literalPreview(r.current.literal)}</button>
											{/if}
										{/if}
									</span>
								</div>
							{/each}
						</div>
					{/if}
				{:else if ports.in.length === 0}
					<p class="text-surface-600-400 text-sm">Receives nothing — it starts the run.</p>
				{:else}
					<div class="@min-[700px]/content:grid-cols-2 grid gap-x-6">
						{#each ports.in as p (p.port + p.from)}
							<div class={ROW}>
								<span class={KEY}>{p.port}</span>
								<span class={VAL} class:opacity-60={p.implicit || p.source === "literal"}>
									{#if p.source === "literal"}{literalPreview(p.literal)}{:else}{p.from}{/if}
								</span>
							</div>
						{/each}
					</div>
				{/if}
			{:else if tab === "out"}
				{#if ports.out.length === 0}
					<p class="text-surface-600-400 text-sm">Nothing downstream reads this {clause ? "clause" : "node"}.</p>
				{:else}
					<div class="@min-[700px]/content:grid-cols-2 grid gap-x-6">
						{#each ports.out as o (o.port)}
							<div class={ROW}>
								<span class={KEY}>{o.port}</span>
								<span class={VAL}>→ {o.to.join(" · ")}</span>
							</div>
						{/each}
					</div>
				{/if}
			{:else if tab === "settings"}
				{#if editing}
					<p class="text-surface-600-400 text-sm">Settings belong to a configuration of the published version. Publish the draft, then fill its values here or on Configure.</p>
				{:else if stepKey}
					{#if readOnlyName}
						<p class="text-surface-600-400 mb-2 flex items-center gap-1.5 text-xs">
							<Icons.Lock size={12} class="shrink-0" />
							<span><strong>{readOnlyName}</strong> is shipped — Save will ask where your changes land.</span>
						</p>
					{/if}
					<PipelineConfigOptions
						{slug}
						{stepKey}
						mode="builder"
						{editsConfigId}
						{pending}
						{pendingClears}
						{onDraftSet}
						{onDraftClear}
						{onLoaded}
					/>
				{:else}
					<p class="text-surface-600-400 text-sm">This {clause ? "clause" : "node"} declares nothing to configure.</p>
				{/if}
			{:else if tab === "run"}
				{#if !hasReceipt}
					<p class="text-surface-600-400 text-sm">Turn on <strong>Last run</strong> above to read a receipt here.</p>
				{:else if !run}
					<p class="text-surface-600-400 text-sm">The run never reached this {clause ? "clause" : "node"}.</p>
				{:else}
					<div class="@min-[700px]/content:grid-cols-2 grid gap-x-6">
						<div>
							<div class={ROW}><span class={KEY}>result</span><span class={VAL}>{STATUS_LABEL[run.status]}</span></div>
							<div class={ROW}><span class={KEY}>time</span><span class={VAL}>{run.elapsedMs} ms</span></div>
							{#if run.tokens}
								<div class={ROW}><span class={KEY}>tokens</span><span class={VAL}>{run.tokens.toLocaleString()}</span></div>
							{/if}
							{#if run.iterations > 1}
								<div class={ROW}><span class={KEY}>iterations</span><span class={VAL}>{run.iterations}</span></div>
							{/if}
						</div>
						<div>
							{#each run.rows as r (r.seq)}
								<div class={ROW}>
									<span class={KEY}>{r.iteration == null ? `seq ${r.seq}` : `pass ${r.iteration}`}</span>
									<span class={VAL}>{r.result}{r.dry ? " · dry" : ""}{r.reason ? ` · ${r.reason}` : ""} · {r.elapsedMs} ms</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			{:else if tab === "notices"}
				{#if findings.length === 0}
					<p class="text-success-600-400 text-sm">The draft validates. Publishing is open.</p>
				{:else}
					<ul class="flex flex-col gap-1">
						{#each findings as f, i (i)}
							<li class="border-surface-200-800 flex items-start gap-2 border-b py-1.5 text-sm last:border-b-0">
								<i class="mt-1.5 block size-2 shrink-0 rounded-full {f.severity === 'error' ? 'bg-error-500' : 'bg-warning-500'}"></i>
								<div class="min-w-0 flex-1">
									<div class="flex flex-wrap items-baseline gap-2">
										<span class="text-surface-600-400 font-mono text-meta">{f.law}</span>
										{#if f.nodeKey}
											<button type="button" class="font-mono text-xs hover:underline" onclick={() => onSelect(f.nodeKey!)}>{f.nodeKey}</button>
										{/if}
									</div>
									<div>{f.message}</div>
									{#if f.fix}<div class="text-surface-600-400 text-xs">Fix: {f.fix}</div>{/if}
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			{/if}
		</div>
	{:else if !collapsed && editing && !selected && model.rows.length === 0}
		<div class="px-4 py-3 text-sm">
			<p class="text-surface-600-400">An empty pipeline. The first step is the inlet the run enters by; the catalogue lists the rest.</p>
		</div>
	{/if}
</section>
