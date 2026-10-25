<script lang="ts">
	/**
	 * The pipeline canvas (PLAN-pipeline-canvas-and-genre-authoring §3, §4.4):
	 * the minimap beside the line, the drawer along the bottom, the overlays —
	 * none, the last run's receipt, the changes since the version before (or,
	 * in a draft, since the published version) — and, from P2, the editor.
	 *
	 * Reads one version as a document (`pipelines:document`); never the
	 * `pipelines:detail` topology, which has no ports. A draft is one admin's
	 * working copy of the spec on the server (`draft.svelte.ts`): every edit
	 * is a pure function over the document, sent up, and the server's
	 * recompiled, validated copy comes back. Publishing writes a version and
	 * reconciles configurations; a shipped spec is copied under the admin's
	 * own slug first (fork), never edited in place.
	 *
	 * Measures its own width, never the viewport (STYLE-GUIDE §1.9): beside
	 * the line from 720px, the minimap is a scrubber across the top below it.
	 */
	import * as Icons from "@lucide/svelte"
	import { untrack } from "svelte"
	import { SvelteSet } from "svelte/reactivity"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import type { SpecDocument } from "@serene-pub/sdk"
	import { getInterestContext } from "$lib/client/sockets/interest.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { adminGoto } from "$lib/client/admin/adminRouter.svelte"
	import {
		clauseStatus,
		diffOf,
		lineOf,
		receiptIndex,
		type DiffMark,
		type NodeRun,
		type RunStatus
	} from "./lineModel"
	import {
		kindVar,
		MARK_VAR,
		NOT_REACHED_VAR,
		STATUS_LABEL,
		STATUS_VAR,
		type Overlay
	} from "./canvasTokens"
	import {
		bumpPatch,
		createDraftSession,
		ownerOf,
		OWNER_SLUG,
		SPEC_NAME,
		type PreviewResult
	} from "./draft.svelte"
	import Minimap from "./Minimap.svelte"
	import LineView from "./LineView.svelte"
	import CanvasDrawer, { type DrawerTab } from "./CanvasDrawer.svelte"

	type Versions = NonNullable<Sockets.Pipelines.Detail.Response["spec"]>["versions"]
	type Graph = NonNullable<NonNullable<Sockets.Pipelines.Detail.Response["spec"]>["graph"]>
	type Runs = Sockets.Pipelines.Runs.Response["runs"]

	interface Props {
		slug: string
		versions: Versions
		graph: Graph | null
		runs: Runs
		editsConfigId?: number
		readOnlyName?: string | null
		pending: Record<string, unknown>
		pendingClears: string[]
		onDraftSet: (option: Sockets.Pipelines.Option, value: unknown) => void
		onDraftClear: (option: Sockets.Pipelines.Option) => void
		onLoaded: (detail: Sockets.Pipelines.NamespaceDetail) => void
	}

	let {
		slug,
		versions,
		graph,
		runs,
		editsConfigId,
		readOnlyName = null,
		pending,
		pendingClears,
		onDraftSet,
		onDraftClear,
		onLoaded
	}: Props = $props()

	const interest = getInterestContext()
	const socket = useTypedSocket()

	/* ── the published document ───────────────────────────────────── */
	let activeDoc = $state<SpecDocument | null>(null)
	let version = $state<Sockets.Pipelines.Document.Response["version"] | null>(null)
	let loadError = $state<string | null>(null)
	let baseDoc = $state<SpecDocument | null>(null)
	let baseVersionId = $state<number | null>(null)

	const onDocument = (res: Sockets.Pipelines.Document.Response) => {
		if (res.error) {
			loadError = res.error
			return
		}
		if (!res.document || !res.version) return
		if (res.document.id !== untrack(() => slug)) return
		if (baseVersionId != null && res.version.id === baseVersionId) {
			baseDoc = res.document
			return
		}
		if (res.version.isActive) {
			activeDoc = res.document
			version = res.version
			loadError = null
		}
	}
	const onDocumentError = (res: { error?: string }) => {
		if (res.error) loadError = res.error
	}

	$effect(() => {
		const initialSlug = untrack(() => slug)
		const releases = [
			interest.declareInterest<"pipelines:document:error">("pipelines:document:error", onDocumentError),
			interest.requestWithInterest("pipelines:document", { slug: initialSlug }, onDocument)
		]
		return () => {
			for (const r of releases) r()
		}
	})
	const reloadDocument = () => socket.emit("pipelines:document", { slug })

	/* ── the draft ────────────────────────────────────────────────── */
	const session = createDraftSession({ slug: untrack(() => slug), socket, interest })
	$effect(() => session.connect())
	const editing = $derived(!!session.draft)
	// What the line draws: the draft when there is one, else the published document.
	const doc = $derived(session.draft?.document ?? activeDoc)
	const model = $derived(doc ? lineOf(doc) : null)
	$effect(() => {
		// `editing` is the only dependency: the load reads the catalogue state
		// itself, and tracking that here would re-request it on every reset.
		if (editing) untrack(() => void session.loadCatalogue())
	})

	/* ── selection, open clauses ──────────────────────────────────── */
	let selected = $state<string | null>(null)
	const open = new SvelteSet<string>()
	let drawerTab = $state<DrawerTab>("item")
	let drawerCollapsed = $state(false)

	const select = (key: string) => {
		selected = key
		const path = model?.pathOf.get(key) ?? []
		for (const id of path) open.add(id)
		if (model?.clauses.has(key)) open.add(key)
	}
	const toggle = (id: string) => {
		if (open.has(id)) open.delete(id)
		else open.add(id)
	}
	const stepKeyOf = (key: string) =>
		graph?.nodes.find((n) => n.key === key)?.stepKey ?? null
	// A selection the document does not hold is dropped (after a remove).
	$effect(() => {
		if (selected && model && !model.nodes.has(selected) && !model.clauses.has(selected)) selected = null
	})

	/* ── overlays ─────────────────────────────────────────────────── */
	let overlay = $state<Overlay>("none")
	let runId = $state<string | null>(null)
	let receipt = $state<unknown>(null)
	let receiptRunId = $state<string | null>(null)

	$effect(() => {
		if (overlay === "receipt" && !runId && runs.length) runId = runs[0].runId
	})
	const onRun = (res: Sockets.Pipelines.Run.Response) => {
		const run = (res as { run?: { runId?: string; receipt?: unknown } }).run
		if (!run?.runId || run.runId !== untrack(() => runId)) return
		receipt = run.receipt ?? null
		receiptRunId = run.runId
	}
	$effect(() => {
		if (overlay !== "receipt" || !runId) return
		if (receiptRunId === runId) return
		const id = runId
		return interest.requestWithInterest("pipelines:run", { runId: id }, onRun)
	})
	const index = $derived(receipt && receiptRunId === runId ? receiptIndex(receipt) : null)

	const previousVersion = $derived.by(() => {
		const active = versions.find((v) => v.isActive)
		if (!active) return null
		return (
			versions
				.filter((v) => !v.isActive && v.id < active.id && v.status !== "draft")
				.sort((a, b) => b.id - a.id)[0] ?? null
		)
	})
	$effect(() => {
		if (overlay !== "diff" || editing || !previousVersion) return
		if (baseVersionId === previousVersion.id && baseDoc) return
		baseVersionId = previousVersion.id
		return interest.requestWithInterest(
			"pipelines:document",
			{ slug: untrack(() => slug), versionId: previousVersion.id },
			onDocument
		)
	})
	// In a draft the diff is draft against published, computed here; else the version before.
	const diff = $derived.by(() => {
		if (overlay !== "diff" || !doc) return null
		if (editing) return activeDoc ? diffOf(activeDoc, doc) : null
		return baseDoc ? diffOf(baseDoc, doc) : null
	})
	const diffAgainst = $derived(editing ? (version?.semver ?? "published") : (previousVersion?.semver ?? ""))

	const statusOf = (key: string) => {
		if (!index || !model) return null
		if (model.clauses.has(key)) return clauseStatus(model, index, key)
		return index.get(key)?.status ?? null
	}
	const colorOf = (key: string, kind: string) => {
		if (overlay === "receipt") {
			const s = statusOf(key)
			return s ? STATUS_VAR[s] : NOT_REACHED_VAR
		}
		return kindVar(kind)
	}
	const dotOf = (key: string, kind: string) => {
		if (overlay !== "receipt") return null
		const s = statusOf(key)
		return s ? STATUS_VAR[s] : NOT_REACHED_VAR
	}
	const dotTitleOf = (key: string) => {
		const s = statusOf(key)
		return s ? STATUS_LABEL[s] : "not reached"
	}
	const markOf = (key: string): DiffMark | null => diff?.marks.get(key) ?? null
	const selectedRun = $derived<NodeRun | null>(
		selected && index ? (index.get(selected) ?? null) : null
	)
	const LEGEND: RunStatus[] = ["ok", "halt", "err", "dry", "skip"]

	/* ── editing: start, discard, publish, fork ───────────────────── */
	let forkOpen = $state(false)
	let forkOwner = $state("")
	let forkName = $state("")
	let forkLabel = $state("")
	let discardOpen = $state(false)
	let publishOpen = $state(false)
	let publishSemver = $state("")
	let preview = $state<PreviewResult | null>(null)
	let previewing = $state(false)
	let published = $state<{ semver: string; culled: number; backfilled: number } | null>(null)

	const forkValid = $derived(
		OWNER_SLUG.test(forkOwner) && forkOwner !== "core" && SPEC_NAME.test(forkName) && forkLabel.trim().length > 0
	)

	async function startEditing() {
		if (!activeDoc) return
		session.error = null
		if (session.shipped) {
			forkName = forkName || (slug.split("/").pop() ?? "reply")
			forkLabel = forkLabel || "Reply (copy)"
			forkOpen = true
			return
		}
		await session.start(activeDoc)
	}
	async function confirmFork() {
		if (!forkValid) return
		const newSlug = await session.fork(forkOwner, forkName, forkLabel.trim())
		if (!newSlug) return
		forkOpen = false
		await adminGoto(`/admin/pipelines/${encodeURIComponent(newSlug)}?tab=canvas`)
	}
	async function confirmDiscard() {
		if (await session.discard()) {
			discardOpen = false
			selected = null
		}
	}
	async function openPublish() {
		publishSemver = bumpPatch(version?.semver ?? "0.1.0")
		published = null
		session.error = null
		publishOpen = true
		await refreshPreview()
	}
	async function refreshPreview() {
		previewing = true
		preview = await session.preview(publishSemver)
		previewing = false
	}
	async function confirmPublish() {
		const result = await session.publish(publishSemver)
		if (!result) return
		published = result
		reloadDocument()
	}
	const validate = () => {
		if (session.draft) void session.apply((d) => d)
	}

	/* ── width ────────────────────────────────────────────────────── */
	let el = $state<HTMLElement | null>(null)
	let width = $state(0)
	$effect(() => {
		const node = el
		if (!node || typeof ResizeObserver === "undefined") return
		const ro = new ResizeObserver(([entry]) => {
			width = Math.round(entry.contentRect.width)
		})
		ro.observe(node)
		return () => ro.disconnect()
	})
	const narrow = $derived(width > 0 && width < 720)

	const SEG = "btn btn-sm rounded-none"
	const on = (o: Overlay) => (overlay === o ? "preset-tonal-primary" : "preset-tonal-surface")
	const DIALOG =
		"bg-surface-100-900 border-surface-200-800 flex w-[30rem] max-w-full flex-col gap-3 rounded-container border p-4"
</script>

<div bind:this={el} class="panel-card flex flex-col !p-0" style="min-height: 32rem">
	<!-- ── the bar: version or draft, overlay, actions ──────────── -->
	<div class="border-surface-200-800 flex flex-wrap items-center gap-2 border-b px-3 py-2">
		{#if editing}
			<span class="chip preset-tonal-primary text-meta">draft</span>
			<span class="text-surface-600-400 text-xs">from {session.draft?.basedOnSemver ?? version?.semver ?? "?"}</span>
			{#if session.errorCount}
				<span class="text-error-600-400 flex items-center gap-1 text-xs"><i class="bg-error-500 block size-2 rounded-full"></i>{session.errorCount} {session.errorCount === 1 ? "notice" : "notices"} · publish blocked</span>
			{:else if session.findings.length}
				<span class="text-warning-700-300 text-xs">{session.findings.length} {session.findings.length === 1 ? "warning" : "warnings"}</span>
			{:else}
				<span class="text-success-600-400 flex items-center gap-1 text-xs"><i class="bg-success-500 block size-2 rounded-full"></i>valid</span>
			{/if}
		{:else if version}
			<span class="font-mono text-xs">{version.semver}</span>
			<span class="chip preset-tonal-surface text-meta">{version.status}{version.isActive ? " · active" : ""}</span>
		{/if}
		{#if model}
			<span class="text-surface-600-400 text-xs">{model.nodeCount} nodes · {model.clauseCount} clauses</span>
		{/if}
		{#if session.error}
			<span class="text-error-600-400 text-xs" role="alert">{session.error}</span>
		{/if}
		<div class="ml-auto flex flex-wrap items-center gap-2">
			<div class="border-surface-200-800 flex overflow-hidden rounded-md border" role="group" aria-label="Colour the line by">
				<button type="button" class="{SEG} {on('none')}" aria-pressed={overlay === "none"} onclick={() => (overlay = "none")}>Structure</button>
				<button type="button" class="{SEG} {on('receipt')}" aria-pressed={overlay === "receipt"} disabled={runs.length === 0} title={runs.length ? "Colour by the last run's receipt" : "No runs yet"} onclick={() => (overlay = "receipt")}>Last run</button>
				<button type="button" class="{SEG} {on('diff')}" aria-pressed={overlay === "diff"} disabled={!editing && !previousVersion} title={editing ? "The draft against the published version" : previousVersion ? `Changes since ${previousVersion.semver}` : "No earlier version"} onclick={() => (overlay = "diff")}>Changes</button>
			</div>
			{#if overlay === "receipt" && runs.length > 1}
				<select class="select h-8 w-48 text-xs" aria-label="Which run" bind:value={runId}>
					{#each runs.slice(0, 10) as r (r.runId)}
						<option value={r.runId}>{r.outcome}{r.isPreview ? " · preview" : ""} · {r.elapsedMs} ms · {r.runId.slice(0, 8)}</option>
					{/each}
				</select>
			{/if}
			{#if editing}
				<button type="button" class="btn btn-sm preset-tonal-surface" disabled={session.busy} onclick={validate}><Icons.ShieldCheck size={14} /> Validate</button>
				<button type="button" class="btn btn-sm preset-tonal-surface" disabled={session.busy} onclick={() => (discardOpen = true)}><Icons.Undo2 size={14} /> Discard…</button>
				<button type="button" class="btn btn-sm preset-filled-primary-500" disabled={session.busy || session.errorCount > 0} onclick={openPublish}><Icons.Upload size={14} /> Publish…</button>
			{:else if session.loaded && activeDoc}
				<button type="button" class="btn btn-sm preset-tonal-surface" disabled={session.busy} title={session.shipped ? "A shipped pipeline is copied under your own name first" : "Start a draft of this version"} onclick={startEditing}>
					<Icons.PencilLine size={14} /> {session.shipped ? "Copy and edit…" : "Edit"}
				</button>
			{/if}
		</div>
	</div>
	{#if overlay === "receipt"}
		<div class="text-surface-600-400 border-surface-200-800 flex flex-wrap items-center gap-3 border-b px-3 py-1 text-meta">
			{#each LEGEND as s (s)}
				<span class="flex items-center gap-1"><i class="block size-2 rounded-full" style="background: {STATUS_VAR[s]}"></i>{STATUS_LABEL[s]}</span>
			{/each}
			<span class="flex items-center gap-1"><i class="block size-2 rounded-full" style="background: {NOT_REACHED_VAR}"></i>not reached</span>
			{#if !index}<span class="italic">loading the receipt…</span>{/if}
		</div>
	{:else if overlay === "diff"}
		<div class="text-surface-600-400 border-surface-200-800 flex flex-wrap items-center gap-3 border-b px-3 py-1 text-meta">
			{#if diff}
				<span class="flex items-center gap-1"><i class="block size-2 rounded-sm" style="background: {MARK_VAR.added}"></i>{diff.added.length} added</span>
				<span class="flex items-center gap-1"><i class="block size-2 rounded-sm" style="background: {MARK_VAR.changed}"></i>{diff.changed.length} changed</span>
				<span class="flex items-center gap-1"><i class="block size-2 rounded-sm" style="background: {MARK_VAR.removed}"></i>{diff.removed.length} removed{diff.removed.length ? `: ${diff.removed.join(", ")}` : ""}</span>
				<span>against {diffAgainst}</span>
			{:else}
				<span class="italic">loading {diffAgainst}…</span>
			{/if}
		</div>
	{/if}

	{#if loadError}
		<p class="text-error-600-400 px-4 py-6 text-sm">{loadError}</p>
	{:else if !doc || !model}
		<p class="text-surface-600-400 px-4 py-6 text-sm">Reading the pipeline…</p>
	{:else}
		<div class="flex min-h-0 flex-1 {narrow ? 'flex-col' : 'flex-row'}">
			{#if narrow}
				<div class="border-surface-200-800 border-b px-2">
					<Minimap {model} {selected} {colorOf} {markOf} onSelect={select} orientation="horizontal" />
				</div>
			{:else}
				<div class="border-surface-200-800 bg-surface-100-900/40 w-[230px] shrink-0 border-r" style="max-height: 44rem">
					<Minimap {model} {selected} {colorOf} {markOf} onSelect={select} orientation="vertical" />
				</div>
			{/if}
			<div class="flex min-w-0 flex-1 flex-col">
				<div class="min-h-0 flex-1 overflow-y-auto px-3" style="max-height: 44rem">
					{#if model.rows.length === 0}
						<p class="text-surface-600-400 px-2 py-6 text-sm">Nothing on the line yet. {editing ? "Use the drawer to add the first step." : "Start a draft to add steps."}</p>
					{/if}
					<LineView
						{model}
						{selected}
						isOpen={(id) => open.has(id)}
						{dotOf}
						{dotTitleOf}
						{markOf}
						onSelect={select}
						onToggle={toggle}
					/>
				</div>
				<CanvasDrawer
					{doc}
					{model}
					{selected}
					{stepKeyOf}
					run={selectedRun}
					hasReceipt={overlay === "receipt" && !!index}
					bind:tab={drawerTab}
					bind:collapsed={drawerCollapsed}
					{slug}
					{editsConfigId}
					{readOnlyName}
					{pending}
					{pendingClears}
					{onDraftSet}
					{onDraftClear}
					{onLoaded}
					{editing}
					busy={session.busy}
					catalogue={session.catalogue}
					composites={session.composites}
					ownerSlug={ownerOf(slug)}
					findings={session.findings}
					onEdit={(fn) => session.apply(fn)}
					onSelect={select}
					onSaveComposite={(s, l, d) => session.saveComposite(s, l, d)}
				/>
			</div>
		</div>
	{/if}
</div>

<!-- ── copy a shipped pipeline under your own name ─────────────── -->
<Dialog open={forkOpen} onOpenChange={(e) => (forkOpen = e.open)}>
	<Portal>
		<Dialog.Backdrop class="bg-surface-950/60 fixed inset-0 z-50" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content class={DIALOG}>
				<Dialog.Title class="text-base font-semibold">This pipeline is shipped</Dialog.Title>
				<Dialog.Description class="text-surface-600-400 text-sm">
					Shipped pipelines stay as written. Your edits go into a copy under a name of your own, published as its first version. Its contributed actions are not copied: their slash names belong to the original.
				</Dialog.Description>
				<label class="flex flex-col gap-1 text-sm">
					<span class="font-medium">Owner slug</span>
					<input class="input font-mono" placeholder="acme.lab" bind:value={forkOwner} aria-describedby="fork-owner-hint" />
					<span id="fork-owner-hint" class="text-surface-600-400 text-xs">Lower-case letters, digits, dots and dashes. Every id you make lives under it, and it never changes.</span>
				</label>
				<label class="flex flex-col gap-1 text-sm">
					<span class="font-medium">Pipeline name</span>
					<input class="input font-mono" placeholder="reply" bind:value={forkName} />
				</label>
				<label class="flex flex-col gap-1 text-sm">
					<span class="font-medium">Label</span>
					<input class="input" placeholder="Reply (copy)" bind:value={forkLabel} onkeydown={(e) => e.key === "Enter" && confirmFork()} />
				</label>
				{#if forkOwner && forkName}
					<p class="text-surface-600-400 font-mono text-xs">{forkOwner}:spec/{forkName}</p>
				{/if}
				{#if session.error}<p class="text-error-600-400 text-sm" role="alert">{session.error}</p>{/if}
				<button class="btn btn-sm preset-filled-primary-500" disabled={!forkValid || session.busy} onclick={confirmFork}>
					<Icons.Copy size={14} /> Copy and open it
				</button>
				<button class="btn btn-sm preset-tonal-surface" onclick={() => (forkOpen = false)}>Cancel</button>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>

<!-- ── discard ──────────────────────────────────────────────────── -->
<Dialog open={discardOpen} onOpenChange={(e) => (discardOpen = e.open)} role="alertdialog" closeOnInteractOutside={false}>
	<Portal>
		<Dialog.Backdrop class="bg-surface-950/60 fixed inset-0 z-50" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content class={DIALOG}>
				<Dialog.Title class="text-base font-semibold">Discard this draft?</Dialog.Title>
				<Dialog.Description class="text-surface-600-400 text-sm">
					Every change since {session.draft?.basedOnSemver ?? "the published version"} goes. The published version stays as it is.
				</Dialog.Description>
				<button class="btn btn-sm preset-filled-error-500" disabled={session.busy} onclick={confirmDiscard}><Icons.Trash2 size={14} /> Discard the draft</button>
				<button class="btn btn-sm preset-tonal-surface" onclick={() => (discardOpen = false)}>Keep editing</button>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>

<!-- ── publish ──────────────────────────────────────────────────── -->
<Dialog open={publishOpen} onOpenChange={(e) => (publishOpen = e.open)}>
	<Portal>
		<Dialog.Backdrop class="bg-surface-950/60 fixed inset-0 z-50" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content class={DIALOG}>
				{#if published}
					<Dialog.Title class="text-base font-semibold">Published {published.semver}</Dialog.Title>
					<Dialog.Description class="text-surface-600-400 text-sm">
						It is the active version now. Configurations were reconciled: {published.culled} {published.culled === 1 ? "value" : "values"} culled, {published.backfilled} back-filled. Culled values are listed as notices on the Configure tab.
					</Dialog.Description>
					<button class="btn btn-sm preset-filled-primary-500" onclick={() => (publishOpen = false)}>Done</button>
				{:else}
					<Dialog.Title class="text-base font-semibold">Publish the draft</Dialog.Title>
					<Dialog.Description class="text-surface-600-400 text-sm">
						A new version becomes active; the one it replaces stays for its receipts. Configurations keep the values whose addresses still exist and lose the rest, with a notice for each.
					</Dialog.Description>
					<label class="flex flex-col gap-1 text-sm">
						<span class="font-medium">Version</span>
						<input class="input font-mono" bind:value={publishSemver} onchange={refreshPreview} />
						{#if preview?.semverTaken}
							<span class="text-warning-700-300 text-xs">{publishSemver} exists already; the new document publishes beside it, told apart by its hash.</span>
						{/if}
					</label>
					{#if previewing}
						<p class="text-surface-600-400 text-sm italic">Working out what changes…</p>
					{:else if preview}
						{@const errors = preview.findings.filter((f) => f.severity === "error")}
						{#if errors.length}
							<p class="text-error-600-400 text-sm">{errors.length} {errors.length === 1 ? "notice blocks" : "notices block"} publishing — see the drawer's Notices tab.</p>
						{/if}
						{#if preview.affected.length === 0}
							<p class="text-surface-600-400 text-sm">No configuration loses a value.</p>
						{:else}
							<div class="flex max-h-48 flex-col gap-1 overflow-y-auto text-sm">
								{#each preview.affected as a (a.configId)}
									<div class="panel-inset rounded-md p-2">
										<div class="font-medium">{a.configName}</div>
										{#if a.culled.length}
											<div class="text-surface-600-400 text-xs">loses: <span class="font-mono">{a.culled.join(" · ")}</span></div>
										{/if}
										{#if a.backfilled.length}
											<div class="text-surface-600-400 text-xs">gains defaults at: <span class="font-mono">{a.backfilled.join(" · ")}</span></div>
										{/if}
									</div>
								{/each}
							</div>
						{/if}
					{/if}
					{#if session.error}<p class="text-error-600-400 text-sm" role="alert">{session.error}</p>{/if}
					<button class="btn btn-sm preset-filled-primary-500" disabled={session.busy || previewing || !publishSemver.trim() || (preview?.findings.some((f) => f.severity === "error") ?? false)} onclick={confirmPublish}>
						<Icons.Upload size={14} /> Publish {publishSemver}
					</button>
					<button class="btn btn-sm preset-tonal-surface" onclick={() => (publishOpen = false)}>Cancel</button>
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
