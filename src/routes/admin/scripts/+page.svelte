<script lang="ts">
	/**
	 * Scripts — the Django-style changelist (18 §4d). Rows are typed text
	 * transforms; the type column says what a script operates on and its
	 * blast-radius badge says what it is able to do. Edit and New navigate to
	 * dedicated change pages — nothing on this list writes to the database.
	 * Import stays here as an explicit review-then-submit flow (per-script
	 * opt-in, source visible, unknown types flagged, re-validated server-side);
	 * Export downloads a pack and writes nothing.
	 *
	 * Admin-only, checked here and again in every handler.
	 */
	import { getContext, onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import AdminList, {
		type AdminColumn
	} from "$lib/client/components/admin/AdminList.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { downloadBlob } from "$lib/client/utils/downloadBlob"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()

	type Script = Sockets.Pipelines.Scripts.Script
	type ScriptType = Sockets.Pipelines.Scripts.ScriptType

	let view = $state<Sockets.Pipelines.Scripts.Response>({})
	let loading = $state(true)

	let types = $derived(new Map((view.types ?? []).map((t) => [t.typeId, t])))
	let rows = $derived(view.scripts ?? [])

	const scopeLabel = (content: string) =>
		content.charAt(0).toUpperCase() + content.slice(1)

	const columns: AdminColumn<Script>[] = [
		{ key: "name", label: "Name", value: (r) => r.name },
		{
			key: "type",
			label: "Type",
			value: (r) => types.get(r.typeId)?.name ?? r.typeId
		},
		{
			key: "scope",
			label: "Scope",
			value: (r) => types.get(r.typeId)?.content ?? ""
		},
		{ key: "enabled", label: "Status", value: (r) => (r.enabled ? 0 : 1) },
		{ key: "usedBy", label: "Used by", value: (r) => r.usedBy.length },
		{ key: "actions", label: "", class: "w-px text-right" }
	]

	const exportIds = (ids: number[]) =>
		socket.emit("pipelines:exportScripts", { ids })

	/* --- sharing (18 §2, U-S7): explicit review-then-submit ----------- */

	type ImportItem = {
		name: string
		type: string
		typeName: string
		blastRadius: string
		known: boolean
		reads: string[]
		writes: string[]
		source: string
		checked: boolean
	}
	let importOpen = $state(false)
	let importText = $state("")
	let importError = $state<string | null>(null)
	let importItems = $state<ImportItem[] | null>(null)

	function openImport() {
		importOpen = true
		importText = ""
		importItems = null
		importError = null
	}

	function parseImport() {
		importItems = null
		importError = null
		let raw: unknown
		try {
			raw = JSON.parse(importText)
		} catch {
			importError = "That is not JSON."
			return
		}
		const entries = Array.isArray((raw as any)?.scripts)
			? ((raw as any).scripts as unknown[])
			: [raw]
		const items: ImportItem[] = []
		for (const e of entries) {
			const item = e as Record<string, unknown> | null
			if (
				!item ||
				typeof item.type !== "string" ||
				typeof item.name !== "string" ||
				typeof item.source !== "string"
			) {
				importError =
					"Expected {type, name, source, in, out} entries — one, or a scripts@1 pack."
				return
			}
			const known = types.get(item.type)
			items.push({
				name: item.name,
				type: item.type,
				typeName: known?.name ?? item.type,
				blastRadius: known?.blastRadius ?? "",
				known: !!known,
				reads: Array.isArray(item.in) ? (item.in as string[]) : [],
				writes: Array.isArray(item.out) ? (item.out as string[]) : [],
				source: item.source,
				// Unknown types cannot land here — refused server-side too —
				// so the box starts unchecked and stays disabled.
				checked: !!known
			})
		}
		importItems = items
	}

	function importFile(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0]
		if (!file) return
		const reader = new FileReader()
		reader.onload = () => {
			importText = String(reader.result ?? "")
			parseImport()
		}
		reader.readAsText(file)
	}

	function submitImport() {
		if (!importItems) return
		let raw: unknown
		try {
			raw = JSON.parse(importText)
		} catch {
			return
		}
		const accept = importItems
			.map((item, index) => (item.checked ? index : -1))
			.filter((index) => index >= 0)
		socket.emit("pipelines:importScripts", { artifact: raw, accept })
	}

	/* --- socket wiring ------------------------------------------------ */

	onMount(() => {
		if (!userCtx.user?.isAdmin) {
			goto("/")
			return
		}
		socket.on(
			"pipelines:scripts",
			(res: Sockets.Pipelines.Scripts.Response) => {
				view = res
				loading = false
			}
		)
		socket.on("pipelines:scripts:error", (res: { error?: string }) => {
			if (res.error) toaster.error({ title: res.error })
			loading = false
		})
		socket.on(
			"pipelines:exportScripts",
			(res: Sockets.Pipelines.ScriptShare.ExportResponse) => {
				if (res.blob && res.filename)
					downloadBlob(res as { blob: unknown; filename: string })
			}
		)
		socket.on(
			"pipelines:exportScripts:error",
			(res: { error?: string }) => {
				if (res.error) toaster.error({ title: res.error })
			}
		)
		socket.on(
			"pipelines:importScripts",
			(res: Sockets.Pipelines.ScriptShare.ImportResponse) => {
				if (res.scripts) view = res.scripts
				importOpen = false
				const skippedForReal = (res.report?.skipped ?? []).filter(
					(s) => s.reason !== "not selected"
				)
				toaster.success({
					title: `Imported ${res.report?.imported.length ?? 0} script${
						(res.report?.imported.length ?? 0) === 1 ? "" : "s"
					}`,
					...(skippedForReal.length
						? {
								description: skippedForReal
									.map((s) => `${s.name}: ${s.reason}`)
									.join(" · ")
							}
						: {})
				})
			}
		)
		socket.on(
			"pipelines:importScripts:error",
			(res: { error?: string }) => {
				if (res.error) toaster.error({ title: res.error })
			}
		)
		socket.emit("pipelines:scripts", {})
	})

	onDestroy(() => {
		socket.off("pipelines:scripts")
		socket.off("pipelines:scripts:error")
		socket.off("pipelines:exportScripts")
		socket.off("pipelines:exportScripts:error")
		socket.off("pipelines:importScripts")
		socket.off("pipelines:importScripts:error")
	})
</script>

<div class="mb-4 flex flex-wrap items-start gap-3">
	<div class="flex-1">
		<h2 class="flex items-center gap-2 text-lg font-semibold">
			<Icons.SquareCode size={20} /> Scripts
		</h2>
		<p class="text-surface-600-400 text-sm">
			Typed text that transforms a run — usable by any pipeline that
			accepts the script's type.
		</p>
	</div>
	<button class="btn btn-sm preset-tonal-surface" onclick={openImport}>
		<Icons.Upload size={16} /> Import
	</button>
	{#if rows.length}
		<button
			class="btn btn-sm preset-tonal-surface"
			title="Export every script as one pack"
			onclick={() => exportIds(rows.map((r) => r.id))}
		>
			<Icons.Download size={16} /> Export all
		</button>
	{/if}
	<a class="btn btn-sm preset-filled-primary-500" href="/admin/scripts/new">
		<Icons.Plus size={16} /> New script
	</a>
</div>

<AdminList
	{rows}
	{columns}
	{loading}
	searchText={(r) =>
		`${r.name} ${types.get(r.typeId)?.name ?? ""} ${r.typeId}`}
	searchPlaceholder="Search scripts…"
	defaultSort="name"
	storageKey="serene-pub:adminView:scripts"
	emptyMessage="No scripts authored yet — create one, or import a pack."
	onRowClick={(r) => goto(`/admin/scripts/${r.id}`)}
>
	{#snippet cell(row, col)}
		{#if col.key === "name"}
			<span class="font-semibold" class:opacity-50={!row.enabled}
				>{row.name}</span
			>
			{#if row.isImmutable}
				<span
					class="preset-tonal-surface ml-1.5 rounded-full px-1.5 py-0.5 text-[0.68rem]"
					>built-in</span
				>
			{/if}
		{:else if col.key === "type"}
			{@const t = types.get(row.typeId)}
			<span class="text-surface-700-300 text-xs">
				{t?.name ?? row.typeId}
			</span>
			{#if t}
				<span
					class="preset-tonal-warning ml-1 rounded-full px-1.5 py-0.5 text-[0.68rem]"
					title="What a script of this type is able to do"
					>{t.blastRadius}</span
				>
			{/if}
		{:else if col.key === "scope"}
			<span class="text-surface-700-300 text-xs">
				{scopeLabel(types.get(row.typeId)?.content ?? "")}
			</span>
		{:else if col.key === "enabled"}
			{#if row.enabled}
				<span
					class="preset-tonal-success rounded-full px-2 py-0.5 text-xs"
					>enabled</span
				>
			{:else}
				<span
					class="preset-tonal-surface rounded-full px-2 py-0.5 text-xs"
					title="A disabled script keeps its place in every chain and does nothing."
					>disabled</span
				>
			{/if}
		{:else if col.key === "usedBy"}
			{#if row.usedBy.length}
				<span
					class="preset-tonal-secondary rounded-full px-2 py-0.5 text-xs"
					title={row.usedBy.join(", ")}
					>{row.usedBy.length} chain{row.usedBy.length === 1
						? ""
						: "s"}</span
				>
			{:else}
				<span class="text-surface-600-400 text-xs">unused</span>
			{/if}
		{:else if col.key === "actions"}
			<span class="flex justify-end gap-1.5">
				<button
					class="btn btn-sm preset-tonal-surface"
					title="Export"
					onclick={(e) => {
						e.stopPropagation()
						exportIds([row.id])
					}}
				>
					<Icons.Download size={13} />
				</button>
				<a
					class="btn btn-sm preset-tonal-surface"
					href="/admin/scripts/{row.id}"
					onclick={(e) => e.stopPropagation()}
				>
					<Icons.Pencil size={13} /> Edit
				</a>
			</span>
		{/if}
	{/snippet}
</AdminList>

<!-- Import review: parsed client-side for the preview; the server re-validates
     on submit, which is the copy that counts. -->
{#if importOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
	>
		<div
			class="card bg-surface-100-900 flex max-h-[90dvh] w-[52rem] max-w-full flex-col gap-3 p-4 shadow-xl"
		>
			<header class="flex items-center justify-between">
				<h3 class="text-base font-semibold">Import scripts</h3>
				<button
					class="btn-icon btn-sm preset-tonal-surface"
					onclick={() => (importOpen = false)}
					aria-label="Close"
				>
					<Icons.X size={14} />
				</button>
			</header>

			{#if !importItems}
				<p class="text-surface-600-400 text-sm">
					Paste a script (or a scripts@1 pack), or choose a file.
					You'll review each script before anything is imported.
				</p>
				<textarea
					class="textarea h-40 w-full font-mono text-xs"
					placeholder={'{"type": "core:script:text/transform@1", "name": "…", "source": "…"}'}
					bind:value={importText}
				></textarea>
				<div class="flex items-center gap-2">
					<label class="btn btn-sm preset-tonal-surface">
						<Icons.FileUp size={14} /> From file
						<input
							type="file"
							accept="application/json,.json"
							class="hidden"
							onchange={importFile}
						/>
					</label>
					<div class="flex-1"></div>
					<button
						class="btn btn-sm preset-filled-primary-500"
						disabled={!importText.trim()}
						onclick={parseImport}
					>
						Review
					</button>
				</div>
				{#if importError}
					<p class="text-error-500 text-sm">{importError}</p>
				{/if}
			{:else}
				<div class="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
					{#each importItems as item, i (i)}
						<div
							class="border-surface-200-800 rounded-lg border p-2"
						>
							<label class="flex items-center gap-2">
								<input
									type="checkbox"
									class="checkbox"
									bind:checked={item.checked}
									disabled={!item.known}
								/>
								<span class="min-w-0 flex-1 truncate font-medium"
									>{item.name}</span
								>
								<span class="text-surface-600-400 text-xs"
									>{item.typeName}</span
								>
								{#if item.known}
									<span
										class="preset-tonal-warning rounded-full px-1.5 py-0.5 text-[0.68rem]"
										>{item.blastRadius}</span
									>
								{:else}
									<span
										class="preset-tonal-error rounded-full px-1.5 py-0.5 text-[0.68rem]"
										>unknown type</span
									>
								{/if}
							</label>
							<p class="text-surface-600-400 mt-1 text-xs">
								reads {item.reads.join(", ") || "—"} · writes {item.writes.join(
									", "
								) || "—"}
							</p>
							<pre
								class="bg-surface-200-800 mt-1 max-h-32 overflow-auto rounded p-2 font-mono text-xs">{item.source}</pre>
						</div>
					{/each}
				</div>
				<div class="flex items-center gap-2">
					<button
						class="btn btn-sm preset-tonal-surface"
						onclick={() => (importItems = null)}
					>
						<Icons.ArrowLeft size={14} /> Back
					</button>
					<div class="flex-1"></div>
					<button
						class="btn btn-sm preset-filled-primary-500"
						disabled={!importItems.some((i) => i.checked)}
						onclick={submitImport}
					>
						<Icons.Upload size={14} /> Import selected
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}
