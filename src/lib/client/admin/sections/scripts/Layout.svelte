<script lang="ts">
	/**
	 * Scripts (18 §4d) — typed text transforms, as a list beside the script
	 * it opens (`[id]/+page.svelte`) or the creator (`new`). Each row says
	 * its type and how many chains use it; the detail says what the type is
	 * able to do. Nothing on this list writes to the database. Import stays
	 * here as an explicit review-then-submit dialog (per-script opt-in, source
	 * visible, unknown types flagged, re-validated server-side); Export
	 * downloads a pack and writes nothing.
	 *
	 * This layout owns the export download for the whole section — the
	 * detail's Export button answers here — because two standing handlers on
	 * `pipelines:exportScripts` would download the pack twice.
	 *
	 * Admin-only, checked here and again in every handler.
	 */
	import { getContext, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { adminGoto as goto } from "$lib/client/admin/adminRouter.svelte"
	import { adminPage as page } from "$lib/client/admin/adminRouter.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import {
		declareInterest,
		requestWithInterest
	} from "$lib/client/sockets/interest.svelte"
	import AdminList, {
		type AdminColumn
	} from "$lib/client/components/admin/AdminList.svelte"
	import AdminPageHeader from "$lib/client/components/admin/AdminPageHeader.svelte"
	import AdminSplit from "$lib/client/components/admin/AdminSplit.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { downloadBlob } from "$lib/client/utils/downloadBlob"

	let { children } = $props()

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()

	type Script = Sockets.Pipelines.Scripts.Script
	type ScriptKind = Sockets.Pipelines.Scripts.ScriptKind

	let view = $state<Sockets.Pipelines.Scripts.Response>({})
	let loading = $state(true)

	let types = $derived(new Map((view.types ?? []).map((t) => [t.typeId, t])))
	let rows = $derived(view.scripts ?? [])

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
		{ key: "usedBy", label: "Used by", value: (r) => r.usedBy.length }
	]

	let selectedId = $derived(page.params.id)
	let hasDetail = $derived(
		!!selectedId || page.url.pathname.endsWith("/new")
	)

	function meta(r: Script): string {
		const parts = [types.get(r.typeId)?.name ?? r.typeId]
		parts.push(
			r.usedBy.length
				? `${r.usedBy.length} chain${r.usedBy.length === 1 ? "" : "s"}`
				: "unused"
		)
		if (!r.enabled) parts.push("disabled")
		return parts.join(" · ")
	}

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

	function handlePipelinesScripts(res: Sockets.Pipelines.Scripts.Response) {
		view = res
		loading = false
	}

	function handlePipelinesScriptsError(res: { error?: string }) {
		if (res.error) toaster.error({ title: res.error })
		loading = false
	}

	function handlePipelinesExportScripts(
		res: Sockets.Pipelines.ScriptShare.ExportResponse
	) {
		if (res.blob && res.filename)
			downloadBlob(res as { blob: unknown; filename: string })
	}

	function handlePipelinesExportScriptsError(res: { error?: string }) {
		if (res.error) toaster.error({ title: res.error })
	}

	function handlePipelinesImportScripts(
		res: Sockets.Pipelines.ScriptShare.ImportResponse
	) {
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

	function handlePipelinesImportScriptsError(res: { error?: string }) {
		if (res.error) toaster.error({ title: res.error })
	}

	onMount(() => {
		if (!userCtx.user?.isAdmin) {
			goto("/")
			return
		}
	})

	/**
	 * The list, asked for and listened for in one; export and import stand,
	 * because their answers come back when the person presses the button —
	 * and a download or an import report is not a reply to anything asked
	 * here. All BARE: a script inventory is not one session's anything.
	 *
	 * The app-wide registry, not `adminInterest`: `pipelines:` is a MIXED
	 * family — most of its handlers answer every user — so these are ordinary
	 * keys, and the admin check here is the same one the redirect above makes.
	 */
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const releases = [
			declareInterest<"pipelines:scripts:error">(
				"pipelines:scripts:error",
				handlePipelinesScriptsError
			),
			declareInterest<"pipelines:exportScripts">(
				"pipelines:exportScripts",
				handlePipelinesExportScripts
			),
			declareInterest<"pipelines:exportScripts:error">(
				"pipelines:exportScripts:error",
				handlePipelinesExportScriptsError
			),
			declareInterest<"pipelines:importScripts">(
				"pipelines:importScripts",
				handlePipelinesImportScripts
			),
			declareInterest<"pipelines:importScripts:error">(
				"pipelines:importScripts:error",
				handlePipelinesImportScriptsError
			),
			requestWithInterest("pipelines:scripts", {}, handlePipelinesScripts)
		]
		return () => {
			for (const release of releases) release()
		}
	})
</script>

<AdminPageHeader
	title="Scripts"
	purpose="Typed text that transforms a run, usable by any pipeline that accepts the script's type."
>
	{#snippet actions()}
		<button type="button" class="btn btn-sm preset-tonal-surface" onclick={openImport}>
			<Icons.Upload size={16} /> Import
		</button>
		{#if rows.length}
			<button
				type="button"
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
	{/snippet}
</AdminPageHeader>

<AdminSplit {hasDetail} emptyMessage="Pick a script to read or edit it.">
	{#snippet list()}
		<AdminList
			{rows}
			{columns}
			{loading}
			compact
			rowTitle={(r) => r.name}
			rowMeta={meta}
			rowBadge={(r) => (r.isImmutable ? "Built-in" : undefined)}
			isSelected={(r) => String(r.id) === selectedId}
			searchText={(r) =>
				`${r.name} ${types.get(r.typeId)?.name ?? ""} ${r.typeId}`}
			searchPlaceholder="Filter scripts"
			defaultSort="name"
			emptyMessage="No scripts authored yet. Create one, or import a pack."
			onRowClick={(r) => goto(`/admin/scripts/${r.id}`)}
		>
			{#snippet cell(row)}{row.name}{/snippet}
		</AdminList>
	{/snippet}
	<!-- Keyed: SvelteKit reuses the page when only the id changes, and a
	     detail seeds its form once. -->
	{#key page.url.pathname}
		{@render children?.()}
	{/key}
</AdminSplit>

<!-- Import review: parsed client-side for the preview; the server re-validates
     on submit, which is the copy that counts. -->
<Dialog open={importOpen} onOpenChange={(e) => (importOpen = e.open)}>
	<Portal>
		<Dialog.Backdrop class="bg-surface-950/60 fixed inset-0 z-50" />
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 border-surface-200-800 flex max-h-[90dvh] w-[52rem] max-w-full flex-col gap-3 border p-4 shadow-xl"
			>
				<header class="flex items-center justify-between">
					<Dialog.Title
						class="[font-family:var(--typo-heading--font-family)] text-base font-semibold"
					>
						Import scripts
					</Dialog.Title>
					<Dialog.CloseTrigger
						class="btn btn-icon btn-sm preset-tonal-surface"
						aria-label="Close"
					>
						<Icons.X size={14} />
					</Dialog.CloseTrigger>
				</header>

				{#if !importItems}
					<Dialog.Description class="text-surface-600-400 text-sm">
						Paste a script (or a scripts@1 pack), or choose a file.
						You'll review each script before anything is imported.
					</Dialog.Description>
					<textarea
						class="textarea h-40 w-full font-mono text-xs"
						aria-label="Script or pack JSON"
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
							type="button"
							class="btn btn-sm preset-filled-primary-500"
							disabled={!importText.trim()}
							onclick={parseImport}
						>
							Review
						</button>
					</div>
					{#if importError}
						<p class="text-error-600-400 text-sm">{importError}</p>
					{/if}
				{:else}
					<div class="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
						{#each importItems as item, i (i)}
							<div class="border-surface-200-800 rounded-lg border p-2">
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
											class="preset-tonal-warning rounded-full px-1.5 py-0.5 text-[11px]"
											>{item.blastRadius}</span
										>
									{:else}
										<span
											class="preset-tonal-error rounded-full px-1.5 py-0.5 text-[11px]"
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
							type="button"
							class="btn btn-sm preset-tonal-surface"
							onclick={() => (importItems = null)}
						>
							<Icons.ArrowLeft size={14} /> Back
						</button>
						<div class="flex-1"></div>
						<button
							type="button"
							class="btn btn-sm preset-filled-primary-500"
							disabled={!importItems.some((i) => i.checked)}
							onclick={submitImport}
						>
							<Icons.Upload size={14} /> Import selected
						</button>
					</div>
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
