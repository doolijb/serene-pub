<script lang="ts">
	/**
	 * Components — the admin surface for **authored components** (C6, P6):
	 * widgets an admin writes or clones here, kept on this instance, each its
	 * own owner (`authored.<id>`) with its own UI worker and enable switch.
	 *
	 * The changelist (note 37, Django admin) of this instance's authored
	 * components: status, review, compile state, framework; bulk Turn on /
	 * Turn off / Delete (a confirmation page: layouts that place one show it
	 * as missing). A row opens its editor — the change view — at
	 * `/admin/components/<id>`; "Add component" opens the add form (`/new`,
	 * blank or a clone of core's). Below, **Core's components** (Django's
	 * related read-only list): their source can be read and — all but the
	 * conversation (`messages`, view-only: it runs on core's own trust) —
	 * cloned into a new widget; a clone never replaces core's.
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
	import AdminChangelist from "$lib/client/components/admin/AdminChangelist.svelte"
	import AdminFieldset from "$lib/client/components/admin/AdminFieldset.svelte"
	import {
		deletionFor,
		type AdminBulkAction,
		type AdminChangelistColumn,
		type AdminChangelistFilter
	} from "$lib/client/components/admin/changelist"
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
		exportsLeft = Math.max(0, exportsLeft - 1)
		if (!exportsLeft) exporting = false
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
	function setEnabled(c: Summary, enabled: boolean) {
		pending++
		socket.emit("components:setEnabled", { id: c.id, enabled })
	}
	const noun = { singular: "component", plural: "components" }
	type Status = "draft" | "failed" | "refused" | "waiting" | "on" | "off"
	const STATUS_ORDER: Status[] = ["failed", "refused", "draft", "waiting", "on", "off"]
	function statusOf(c: Summary): Status {
		if (c.lastError) return "failed"
		if (c.refusal) return "refused"
		if (c.hasComponentDraft) return "draft"
		if (c.enabled && !c.src) return "waiting"
		return c.enabled ? "on" : "off"
	}
	const STATUS_WORD: Record<Status, string> = {
		failed: "Last compile failed",
		refused: "Not offered",
		draft: "Draft waiting",
		waiting: "On — not compiled yet",
		on: "On",
		off: "Off"
	}
	const STATUS_DOT: Record<Status, string> = {
		failed: "bg-error-500",
		refused: "bg-error-500",
		draft: "bg-warning-500",
		waiting: "bg-warning-500",
		on: "bg-success-500",
		off: "bg-surface-400-600"
	}
	const columns: AdminChangelistColumn<Summary>[] = [
		{ key: "label", label: "Name", primary: true, text: (c) => text(c.label), sortValue: (c) => text(c.label) },
		{
			key: "status",
			label: "Status",
			custom: true,
			text: (c) => STATUS_WORD[statusOf(c)],
			sortValue: (c) => STATUS_ORDER.indexOf(statusOf(c))
		},
		{
			key: "review",
			label: "Scopes",
			text: (c) => (c.needsReview ? "Needs review" : "Reviewed"),
			sortValue: (c) => (c.needsReview ? 0 : 1)
		},
		{
			key: "basedOn",
			label: "Based on",
			text: (c) => (c.basedOn ? `Clone of ${c.basedOn.component}` : "Blank"),
			sortValue: (c) => c.basedOn?.component ?? null
		},
		{
			key: "widget",
			label: "Widget",
			text: (c) => `${c.widgetId} · ${c.framework}`,
			sortValue: (c) => c.widgetId,
			class: "font-mono text-xs",
			hideWhenStacked: true
		}
	]
	const filters: AdminChangelistFilter<Summary>[] = [
		{
			key: "status",
			label: "Status",
			values: statusOf,
			optionLabel: (v) => STATUS_WORD[v as Status] ?? v,
			order: STATUS_ORDER
		},
		{
			key: "review",
			label: "Scopes",
			values: (c) => (c.needsReview ? "pending" : "reviewed"),
			optionLabel: (v) => (v === "pending" ? "Needs review" : "Reviewed"),
			order: ["pending", "reviewed"]
		},
		{
			key: "framework",
			label: "Framework",
			values: (c) => c.framework,
			optionLabel: (v) => (v === "svelte" ? "Svelte" : v === "vanilla" ? "Vanilla" : v)
		}
	]
	const bulkActions: AdminBulkAction<Summary>[] = [
		{
			key: "on",
			label: "Turn selected components on",
			icon: Icons.Power,
			run: (s) => s.filter((c) => !c.enabled).forEach((c) => setEnabled(c, true))
		},
		{
			key: "off",
			label: "Turn selected components off",
			icon: Icons.PowerOff,
			run: (s) => s.filter((c) => c.enabled).forEach((c) => setEnabled(c, false))
		},
		{
			key: "export",
			label: "Export selected components",
			icon: Icons.Download,
			run: (s) => s.forEach((c) => exportOne(c))
		},
		{
			key: "delete",
			label: "Delete selected components…",
			icon: Icons.Trash2,
			destructive: true,
			confirm: (s) =>
				deletionFor(s, {
					noun,
					label: (c) => text(c.label),
					related: (c) => [{ label: "Layouts that place it show", items: [`${c.widgetId} as missing`] }]
				}),
			run: (s) => {
				for (const c of s) {
					pending++
					socket.emit("components:delete", { id: c.id, expectedUpdatedAt: c.updatedAt })
				}
			}
		}
	]
	let exportsLeft = 0
	function exportOne(c: Summary) {
		exporting = true
		exportsLeft++
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

<div class="flex min-w-0 flex-col gap-4">
	<AdminChangelist
		title="Components"
		purpose="Widgets written on this pub: clone one of core's to change how it looks, or start from blank, and switch it on for layouts to place. Each runs apart from the page, under its own owner."
		rows={authored}
		rowKey={(c) => c.id}
		{columns}
		{filters}
		{bulkActions}
		{loading}
		{noun}
		searchText={(c) => `${text(c.label)} ${c.widgetId} ${c.framework} ${c.basedOn?.component ?? ""}`}
		rowHref={(c) => `/admin/components/${c.id}`}
		addHref={compiler.available ? "/admin/components/new" : undefined}
		defaultSort="label"
		emptyIcon={Icons.Blocks}
		emptyMessage={compiler.available
			? "No components yet. Add one, or clone one of core's below."
			: "No components yet. Import a share file that carries its compiled module."}
	>
		{#snippet headerActions()}
			<button
				type="button"
				class="btn btn-sm preset-tonal-surface"
				onclick={() => (importOpen = true)}
				aria-haspopup="dialog"
			>
				<Icons.Upload size={14} aria-hidden="true" /> Import
			</button>
		{/snippet}
		{#snippet headerExtra()}
			{#if !compiler.available}
				<p class="text-surface-700-300 flex items-start gap-2 text-sm" role="status">
					<span class="bg-warning-500 mt-1.5 size-2 shrink-0 rounded-full" aria-hidden="true"></span>
					<span>
						Authoring is not available on this pub: it has no component compiler{compiler.reason
							? ` (${compiler.reason})`
							: ""}. You can still switch components on and off, review their scopes, export and delete
						them, and import share files that carry their compiled module.
					</span>
				</p>
			{/if}
			{#if refusal}
				<p class="text-error-700-300 text-sm" role="alert">{refusal}</p>
			{/if}
		{/snippet}
		{#snippet cell(row, col)}
			{#if col.key === "status"}
				{@const st = statusOf(row)}
				<span
					class="inline-flex items-center gap-1.5"
					title={row.lastError ?? (row.refusal ? `Its compiled module was ${row.refusal}` : undefined)}
				>
					<span class="size-2 shrink-0 rounded-full {STATUS_DOT[st]}" aria-hidden="true"></span>
					{STATUS_WORD[st]}
				</span>
			{/if}
		{/snippet}
	</AdminChangelist>

	<AdminFieldset
		id="core-components"
		title="Core's components"
		description="A clone is a new widget beside core's, never in its place. The conversation can be read but not cloned."
	>
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
	</AdminFieldset>
</div>

<style>
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
