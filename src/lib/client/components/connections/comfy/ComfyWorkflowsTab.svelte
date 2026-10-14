<script lang="ts">
	/**
	 * 🚧 The **Workflows tab** of a ComfyUI connection's view
	 * (DESIGN-image-generation §4.12 "One home"): every `comfyui` workflow —
	 * workflows are server-agnostic — each with THIS server's validity chip
	 * (*ready* · *Missing nodes: …* · *This workflow names X; your ComfyUI
	 * doesn't have it*), the shipped starters marked *Built in* and read-only,
	 * a row menu (Edit · Duplicate · Export · Delete), **Add workflow** and
	 * **Open ComfyUI**.
	 *
	 * The chips read the server's cached `/object_info` (`workflows:onServer`)
	 * — nothing is recorded by looking. *Validate against this server* in the
	 * editor is the live, recorded check.
	 */
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import RowMenu from "$lib/client/components/menus/RowMenu.svelte"
	import WorkflowAddDialog from "./WorkflowAddDialog.svelte"
	import WorkflowEditorDialog from "./WorkflowEditorDialog.svelte"
	import { saveTextFile, workflowsApi } from "./workflowsApi"
	import { rowActions, validityChip } from "./workflowsTab"

	interface Props {
		connectionId: number
		/** The server's address, for *Open ComfyUI*. */
		baseUrl: string | null | undefined
	}

	let { connectionId, baseUrl }: Props = $props()

	const socket = useTypedSocket()
	const api = workflowsApi(socket)

	let workflows = $state<Sockets.Workflows.Summary[]>([])
	let loaded = $state(false)
	let onServer = $state<Sockets.Workflows.OnServer.Response | null>(null)
	let addOpen = $state(false)
	let editingId = $state<number | null>(null)
	let menuFor = $state<number | null>(null)
	let error = $state<string | null>(null)
	let confirmDelete = $state<Sockets.Workflows.Summary | null>(null)

	const comfyUrl = $derived((baseUrl || "http://localhost:8188").replace(/\/+$/, ""))
	const starters = $derived(workflows.filter((w) => w.isStarter))

	function refreshChecks() {
		api.onServer(connectionId)
			.then((r) => (onServer = r))
			.catch(() => {})
	}

	// Every write re-sends the list (`workflows:list` broadcast).
	useInterest<"workflows:list">("workflows:list", (res) => {
		workflows = (res.workflows ?? []).filter((w) => w.dialect === "comfyui")
		loaded = true
		refreshChecks()
	})

	$effect(() => {
		void connectionId
		socket.emit("workflows:list", { dialect: "comfyui" })
	})

	async function run(fn: () => Promise<unknown>) {
		error = null
		try {
			await fn()
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		}
	}

	const exportFile = (id: number, withDefaults: boolean) =>
		run(async () => {
			const f = await api.exportFile(id, withDefaults)
			saveTextFile(f.filename, f.content)
		})

	const duplicate = (id: number) =>
		run(async () => {
			const row = await api.duplicate(id)
			editingId = row.id
		})

	function menuItems(w: Sockets.Workflows.Summary) {
		const items = []
		for (const a of rowActions(w)) {
			if (a === "edit")
				items.push({ label: "Edit", icon: Icons.Pencil, onSelect: () => (editingId = w.id) })
			if (a === "view")
				items.push({ label: "View", icon: Icons.Eye, onSelect: () => (editingId = w.id) })
			if (a === "duplicate")
				items.push({ label: "Duplicate", icon: Icons.Copy, onSelect: () => duplicate(w.id) })
			if (a === "export")
				items.push({
					label: "Export (with holes)",
					icon: Icons.Download,
					onSelect: () => exportFile(w.id, false)
				})
			if (a === "exportDefaults")
				items.push({
					label: "Export (with current defaults)",
					icon: Icons.FileDown,
					onSelect: () => exportFile(w.id, true)
				})
			if (a === "delete") {
				items.push({ separator: true as const })
				items.push({
					label: "Delete",
					icon: Icons.Trash2,
					destructive: true,
					onSelect: () => (confirmDelete = w)
				})
			}
		}
		return items
	}
</script>

<section class="panel-card flex flex-col gap-3" data-comfy-workflows-tab>
	<div class="flex flex-wrap items-center gap-2">
		<p class="min-w-0 flex-1 text-sm font-medium">
			{workflows.length === 1 ? "1 workflow" : `${workflows.length} workflows`}
		</p>
		<a
			class="btn btn-sm preset-tonal-surface"
			href={comfyUrl}
			target="_blank"
			rel="noopener noreferrer"
		>
			<Icons.ExternalLink size={14} aria-hidden="true" />
			Open ComfyUI
		</a>
		<button type="button" class="btn btn-sm preset-filled-primary-500" onclick={() => (addOpen = true)}>
			<Icons.Plus size={14} aria-hidden="true" />
			Add workflow
		</button>
	</div>
	<p class="text-surface-600-400 text-xs">
		A workflow is a ComfyUI graph with blanks Serene Pub fills in. Every ComfyUI
		connection lists the same workflows; the chip says whether one fits this
		server. Fix a missing node or model in ComfyUI.
	</p>
	{#if onServer && !onServer.checked}
		<p class="text-surface-600-400 text-xs" role="status">
			Not checked yet — press <strong>Test</strong> above so Serene Pub can read which
			nodes and models this ComfyUI has.
		</p>
	{/if}
	{#if error}<p class="text-error-600-400 text-sm" role="alert">{error}</p>{/if}

	{#if !loaded}
		<p class="text-surface-600-400 text-sm">Loading workflows…</p>
	{:else if !workflows.length}
		<p class="text-surface-600-400 text-sm">No workflows yet. Add one to draw with this ComfyUI.</p>
	{:else}
		<ul class="flex flex-col divide-y divide-surface-200-800">
			{#each workflows as w (w.id)}
				{@const chip = validityChip(w.id, onServer)}
				<li class="flex min-w-0 flex-wrap items-center gap-2 py-2" data-workflow-row={w.id}>
					<button
						type="button"
						class="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline"
						onclick={() => (editingId = w.id)}
						title={w.description ?? undefined}
					>
						{w.name}
					</button>
					{#if w.isStarter}
						<span class="badge preset-tonal-surface text-xs" title="Shipped with Serene Pub. Duplicate it to edit.">
							Built in
						</span>
					{/if}
					<span
						class="badge max-w-full truncate text-xs {chip.tone === 'ready'
							? 'preset-tonal-success'
							: chip.tone === 'missing'
								? 'preset-tonal-warning'
								: 'preset-tonal-surface'}"
						title={chip.detail}
						data-validity={chip.tone}
					>
						{chip.label}
					</span>
					<RowMenu
						label={w.name}
						width={240}
						triggerLabel="Options for {w.name}"
						triggerClass="btn-icon btn-icon-sm hover:preset-tonal"
						bind:open={() => menuFor === w.id, (v) => (menuFor = v ? w.id : null)}
						items={menuItems(w)}
					/>
				</li>
			{/each}
		</ul>
	{/if}

	{#if confirmDelete}
		{@const target = confirmDelete}
		<div class="preset-tonal-error flex flex-wrap items-center gap-2 rounded-md p-2 text-sm" role="alert">
			<span class="flex-1">
				Delete “{target.name}”? A step that names it will ask for another.
			</span>
			<button type="button" class="btn btn-sm preset-tonal-surface" onclick={() => (confirmDelete = null)}>
				Keep
			</button>
			<button
				type="button"
				class="btn btn-sm preset-filled-error-500"
				onclick={() =>
					run(async () => {
						await api.remove(target.id)
						confirmDelete = null
					})}
			>
				Delete
			</button>
		</div>
	{/if}
</section>

<WorkflowAddDialog
	open={addOpen}
	{connectionId}
	{starters}
	{onServer}
	onStarterCopied={(row) => {
		addOpen = false
		editingId = row.id
	}}
	onClose={() => {
		addOpen = false
		refreshChecks()
	}}
/>

<WorkflowEditorDialog
	open={editingId != null}
	workflowId={editingId}
	{connectionId}
	onDuplicate={duplicate}
	onClose={() => {
		editingId = null
		refreshChecks()
	}}
/>
