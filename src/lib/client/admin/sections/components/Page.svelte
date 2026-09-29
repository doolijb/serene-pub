<script lang="ts">
	/**
	 * Components — the admin surface for **authored components** (C6, P6):
	 * widgets an admin writes or clones here, kept on this instance, each its
	 * own owner (`authored.<id>`) with its own UI worker and enable switch.
	 *
	 * Two lists. Core's components, whose source can be read and — all but
	 * the conversation (`messages`, view-only: it runs on core's own trust) —
	 * cloned into a new widget; a clone never replaces core's. Then this
	 * instance's authored components: switch one on or off, see whether its
	 * scopes wait for review or its last compile failed, open it in the
	 * editor, export it, delete it.
	 *
	 * An instance with no compiler (Android) cannot write, clone or preview:
	 * the page says so and keeps what still works there — the list, the
	 * switch, the review, delete and export.
	 *
	 * Admin-only: the layout turns non-admins away and every handler checks
	 * again. Every verb's reply is gated, so each one used here is declared
	 * through the admin interest context first; the `:error`s are ungated but
	 * are heard the same way.
	 */
	import { getContext, onMount } from "svelte"
	import { adminGoto as goto } from "$lib/client/admin/adminRouter.svelte"
	import * as Icons from "@lucide/svelte"
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getAdminInterestContext } from "$lib/client/sockets/interest.svelte"
	import { i18nTextIn } from "$lib/shared/i18n/i18nText"
	import { toaster } from "$lib/client/utils/toaster"
	import CodeEditor from "$lib/client/components/componentEditor/CodeEditor.svelte"
	import { adminRedirect } from "$lib/client/components/componentEditor/editorState"
	import AdminPageHeader from "$lib/client/components/admin/AdminPageHeader.svelte"
	import ImportComponentDialog from "$lib/client/components/componentEditor/ImportComponentDialog.svelte"
	import { downloadShareFile } from "$lib/client/components/componentEditor/componentShare"

	type Summary = Sockets.Components.Summary
	type CoreRow = Sockets.Components.CoreList.Response["components"][number]

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()
	const interest = getAdminInterestContext()

	let authored = $state<Summary[]>([])
	let core = $state<CoreRow[]>([])
	let compiler = $state<{ available: boolean; reason?: string }>({ available: true })
	let loading = $state(true)
	let refusal = $state<string | null>(null)
	let framework = $state<Sockets.Components.Framework>("svelte")
	/** A clone or create in flight, so a second press does not make two. */
	let making = $state<string | null>(null)
	let importOpen = $state(false)
	/**
	 * Replies reach every tab of this admin that declared the verb, so a tab
	 * acts on one only while it is waiting for it: another tab's clone must
	 * not navigate this one, nor its export download here.
	 */
	let pending = 0
	let exporting = false
	let wantSource: string | null = null

	/** Core's source, open read-only below the core list. */
	let viewing = $state<Sockets.Components.CoreSource.Response | null>(null)
	let viewingFile = $state("")

	const text = (v: unknown) => i18nTextIn(v) ?? ""

	function handleList(res: Sockets.Components.List.Response) {
		authored = res.components
		compiler = res.compiler
		loading = false
		refusal = null
	}
	function handleCoreList(res: Sockets.Components.CoreList.Response) {
		core = res.components
	}
	function handleCoreSource(res: Sockets.Components.CoreSource.Response) {
		if (res.slug !== wantSource) return
		wantSource = null
		viewing = res
		viewingFile = res.entry
	}
	function handleMade(res: Sockets.Components.Clone.Response) {
		if (!making) return
		making = null
		goto(`/admin/components/${res.component.id}`)
	}
	function handleRowChanged(res: { component: Sockets.Components.Detail }) {
		pending = Math.max(0, pending - 1)
		const i = authored.findIndex((c) => c.id === res.component.id)
		if (i >= 0) authored[i] = res.component
	}
	function handleDeleted(res: Sockets.Components.Delete.Response) {
		pending = Math.max(0, pending - 1)
		authored = authored.filter((c) => c.id !== res.id)
	}
	function handleExport(res: Sockets.Components.Export.Response) {
		if (!exporting) return
		exporting = false
		downloadShareFile(res)
	}
	/** Anything announced — another tab's save, an import — re-reads the list. */
	function handleChanged() {
		socket.emit("components:list", {})
	}
	function handleListError(res: Sockets.ErrorResponse) {
		loading = false
		refusal = res.error ?? "The components could not be read."
	}
	function handleError(res: Sockets.ErrorResponse) {
		if (!making && !exporting && !wantSource && pending === 0) return
		making = null
		exporting = false
		wantSource = null
		pending = Math.max(0, pending - 1)
		if (res.error) toaster.error({ title: res.error })
	}

	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const releases = [
			interest.declareInterest<"components:list:error">("components:list:error", handleListError),
			interest.declareInterest<"components:coreList:error">("components:coreList:error", handleListError),
			interest.declareInterest<"components:clone">("components:clone", handleMade),
			interest.declareInterest<"components:create">("components:create", handleMade),
			interest.declareInterest<"components:setEnabled">("components:setEnabled", handleRowChanged),
			interest.declareInterest<"components:delete">("components:delete", handleDeleted),
			interest.declareInterest<"components:export">("components:export", handleExport),
			interest.declareInterest<"components:coreSource">("components:coreSource", handleCoreSource),
			interest.declareInterest<"components:changed">("components:changed", handleChanged),
			...(
				[
					"components:coreSource:error",
					"components:clone:error",
					"components:create:error",
					"components:setEnabled:error",
					"components:delete:error",
					"components:export:error"
				] as const
			).map((e) => interest.declareInterest<"components:clone:error">(e, handleError)),
			interest.requestWithInterest("components:coreList", {}, handleCoreList),
			interest.requestWithInterest("components:list", {}, handleList)
		]
		return () => {
			for (const release of releases) release()
		}
	})

	onMount(() => {
		const to = adminRedirect(userCtx.user)
		if (to) goto(to)
	})

	function clone(slug: string) {
		if (making) return
		making = `clone:${slug}`
		socket.emit("components:clone", { slug })
	}
	function create() {
		if (making) return
		making = "create"
		socket.emit("components:create", { framework })
	}
	function setEnabled(c: Summary, enabled: boolean) {
		pending++
		socket.emit("components:setEnabled", { id: c.id, enabled })
	}
	function remove(c: Summary) {
		if (!confirm(`Delete "${text(c.label)}"? Layouts that place ${c.widgetId} show it as missing.`)) return
		pending++
		socket.emit("components:delete", { id: c.id, expectedUpdatedAt: c.updatedAt })
	}
	function exportOne(c: Summary) {
		exporting = true
		socket.emit("components:export", { id: c.id })
	}
	function viewSource(slug: string) {
		if (viewing?.slug === slug) {
			viewing = null
			return
		}
		wantSource = slug
		socket.emit("components:coreSource", { slug })
	}
</script>

<ImportComponentDialog bind:open={importOpen} coreComponents={core} />

<div class="components-page flex flex-col gap-3">
	<AdminPageHeader
		title="Components"
		purpose="Widgets written on this instance: clone one of core's to change how it looks, or start from blank, and switch it on for layouts to place."
	>
		{#snippet actions()}
			<div class="header-actions">
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					onclick={() => (importOpen = true)}
					aria-haspopup="dialog"
				>
					<Icons.Upload size={14} /> Import
				</button>
				{#if compiler.available}
					<label class="sr-only" for="new-framework">Framework</label>
					<select id="new-framework" class="select w-auto text-sm" bind:value={framework}>
						<option value="svelte">Svelte</option>
						<option value="vanilla">Vanilla</option>
					</select>
					<button type="button" class="btn btn-sm preset-filled-primary-500" onclick={create} disabled={!!making}>
						<Icons.Plus size={14} /> New component
					</button>
				{/if}
			</div>
		{/snippet}
	</AdminPageHeader>

	{#if !compiler.available}
		<div class="panel-card flex items-start gap-3" role="status">
			<Icons.Info size={18} class="text-warning-500 mt-0.5 shrink-0" />
			<div class="text-sm">
				<p class="font-medium">Authoring is not available on this instance</p>
				<p class="text-surface-600-400">
					It has no component compiler{compiler.reason ? ` (${compiler.reason})` : ""}. You can still switch components on and off, review their scopes, export and delete them, and import share files that carry their compiled module.
				</p>
			</div>
		</div>
	{/if}

	{#if refusal}
		<div class="panel-card text-error-700-300 text-sm" role="alert">{refusal}</div>
	{/if}

	<section class="panel-card flex flex-col gap-3" aria-labelledby="authored-heading">
		<div>
			<h2 id="authored-heading" class="text-sm font-medium">Your components</h2>
			<p class="text-surface-600-400 text-xs">
				Each runs apart from the page, under its own owner. Layouts can place one once it is on.
			</p>
		</div>

		{#if loading}
			<p class="text-surface-600-400 flex items-center gap-2 text-sm" role="status">
				<Icons.LoaderCircle size={14} class="animate-spin" /> Loading components…
			</p>
		{:else if !authored.length}
			<p class="text-surface-600-400 text-sm">
				{compiler.available
					? "Clone one of core's components below, or start a new one."
					: "Import a share file that carries its compiled module."}
			</p>
		{:else}
			<ul class="flex flex-col gap-1">
				{#each authored as c (c.id)}
					<li class="component-row">
						<div class="row-main">
							<p class="flex flex-wrap items-center gap-2">
								<a class="truncate text-[15px] font-medium hover:underline" href="/admin/components/{c.id}">{text(c.label)}</a>
								{#if c.needsReview}
									<a
										href="/admin/components/{c.id}?tab=widget"
										class="preset-tonal-warning rounded-full px-2 py-0.5 text-xs"
										title="A scope it asks for waits for an admin's decision, and is refused until then"
									>Needs review</a>
								{/if}
								{#if c.basedOn}
									<span class="preset-tonal-surface rounded-full px-2 py-0.5 text-xs">Clone of {c.basedOn.component}</span>
								{/if}
								{#if c.hasComponentDraft}
									<a
										href="/admin/components/{c.id}"
										class="preset-tonal-warning rounded-full px-2 py-0.5 text-xs"
										title="The latest save doesn't compile; sessions keep running the last save"
									>Draft</a>
								{/if}
							</p>
							<p class="text-surface-600-400 truncate font-mono text-xs">{c.widgetId} · {c.framework}</p>
							{#if c.lastError}
								<p class="text-error-700-300 mt-0.5 line-clamp-2 text-xs">
									<Icons.CircleAlert size={12} class="inline" aria-hidden="true" /> Last compile failed: {c.lastError}
								</p>
							{:else if c.refusal}
								<p class="text-error-700-300 mt-0.5 text-xs">
									<Icons.CircleAlert size={12} class="inline" aria-hidden="true" /> Not offered — its compiled module was {c.refusal}.
								</p>
							{:else if c.enabled && !c.src}
								<p class="text-surface-600-400 mt-0.5 text-xs">On, but not offered yet — it has not compiled.</p>
							{/if}
						</div>
						<div class="row-controls">
							<Switch
								checked={c.enabled}
								onCheckedChange={(e) => setEnabled(c, e.checked)}
								class="flex items-center gap-2"
							>
								<Switch.Label class="text-surface-600-400 text-xs"
									><span class="sr-only">Offer {text(c.label)} to layouts: </span>{c.enabled ? "On" : "Off"}</Switch.Label
								>
								<Switch.Control class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500">
									<Switch.Thumb />
								</Switch.Control>
								<Switch.HiddenInput />
							</Switch>
							<div class="flex items-center gap-1">
								<a class="btn btn-sm preset-tonal-surface" href="/admin/components/{c.id}">
									<Icons.SquarePen size={14} /> {compiler.available ? "Edit" : "Open"}
								</a>
								<button
									type="button"
									class="btn-icon btn-icon-sm preset-tonal-surface"
									aria-label="Export {text(c.label)}"
									title="Export"
									onclick={() => exportOne(c)}
								>
									<Icons.Download size={14} />
								</button>
								<button
									type="button"
									class="btn-icon btn-icon-sm preset-tonal-error"
									aria-label="Delete {text(c.label)}"
									title="Delete"
									onclick={() => remove(c)}
								>
									<Icons.Trash2 size={14} />
								</button>
							</div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="panel-card flex flex-col gap-3" aria-labelledby="core-heading">
		<div>
			<h2 id="core-heading" class="text-sm font-medium">Core's components</h2>
			<p class="text-surface-600-400 text-xs">
				A clone is a new widget beside core's, never in its place. The conversation can be read but not cloned.
			</p>
		</div>
		<ul class="flex flex-col gap-1">
			{#each core as c (c.slug)}
				<li class="component-row">
					<div class="row-main">
						<p class="truncate text-[15px] font-medium">{c.title}</p>
						<p class="text-surface-600-400 truncate font-mono text-xs">{c.slug} · {c.framework}</p>
					</div>
					<div class="row-controls">
						<button
							type="button"
							class="btn btn-sm preset-tonal-surface"
							aria-expanded={viewing?.slug === c.slug}
							onclick={() => viewSource(c.slug)}
						>
							<Icons.FileCode size={14} /> {viewing?.slug === c.slug ? "Hide source" : "View source"}
						</button>
						{#if c.cloneable && compiler.available}
							<button
								type="button"
								class="btn btn-sm preset-tonal-surface"
								disabled={!!making}
								onclick={() => clone(c.slug)}
							>
								{#if making === `clone:${c.slug}`}
									<Icons.LoaderCircle size={14} class="animate-spin" />
								{:else}
									<Icons.Copy size={14} />
								{/if}
								Clone
							</button>
						{:else if !c.cloneable}
							<span class="text-surface-600-400 px-2 text-xs">View only</span>
						{/if}
					</div>
				</li>
			{:else}
				<li class="text-surface-600-400 text-sm">Reading core's components…</li>
			{/each}
		</ul>
		{#if viewing}
			<div class="core-source flex flex-col gap-2">
				<p class="text-surface-600-400 text-xs">
					{viewing.slug} as core ships it ({viewing.catalogVersion}) — read only.
				</p>
				{#key viewing.slug}
					<CodeEditor
						files={viewing.files}
						entry={viewing.entry}
						bind:active={viewingFile}
						readOnly
						label="{viewing.slug} source files"
					/>
				{/key}
			</div>
		{/if}
	</section>
</div>

<style>
	/*
	 * The header's actions sit beside the title where there is room. In the
	 * 400px dock they take their own row, so the title and its sentence keep
	 * the full width instead of wrapping a word to a line.
	 */
	.header-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	@container content (max-width: 559px) {
		.header-actions {
			width: 100cqi;
		}
	}
	.components-page {
		max-width: 72rem;
	}
	/*
	 * A row is the name and its facts, then the controls. Where the section
	 * is wide (Focus) they share a line; in the 400px dock the controls drop
	 * under the name, right-aligned, so the name keeps the full width.
	 */
	.component-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		min-height: 44px;
		padding: 6px 8px;
		border-radius: 10px;
	}
	.component-row:hover {
		background: color-mix(in oklab, var(--color-surface-500) 8%, transparent);
	}
	.row-main {
		flex: 1 1 0%;
		min-width: 0;
	}
	.row-controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 8px 12px;
		margin-left: auto;
	}
	@container content (max-width: 559px) {
		.row-main {
			flex-basis: 100%;
		}
	}
	.core-source {
		height: 520px;
	}
	@container content (max-width: 559px) {
		.core-source {
			height: 420px;
		}
	}
</style>
