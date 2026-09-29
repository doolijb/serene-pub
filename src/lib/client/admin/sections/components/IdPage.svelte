<script lang="ts">
	/**
	 * One authored component in the editor (C6, P6): its files in CodeMirror,
	 * a preview of the draft fed fixtures, the problems the compiler and the
	 * running widget report, the widget's declaration, and — for a clone — a
	 * diff against core's component as it is today.
	 *
	 * Everything is a draft until Save (`components:save`), which sends the
	 * `updatedAt` this page read: if anyone saved in between, the server
	 * refuses, and the page says so and offers a reload rather than writing
	 * over their work. Preview (`components:preview`) compiles the draft
	 * without storing it and mounts the result under this component's own
	 * owner, never core's.
	 *
	 * A save that does not compile, on a component that has compiled before,
	 * is kept as its **component draft**: sessions keep running the last save.
	 * The editor opens the draft when there is one, says so in a banner with
	 * Revert to last save (`components:revertDraft`), and shows the draft
	 * against the last save in the Last save tab.
	 *
	 * On an instance with no compiler the source is read-only: saving and
	 * previewing both need the compiler. The switch and the scope review
	 * still work there.
	 *
	 * Keys: Ctrl/Cmd+S saves, Ctrl/Cmd+Enter previews.
	 */
	import { getContext, onMount } from "svelte"
	import { adminGoto as goto, adminUnsavedEdits } from "$lib/client/admin/adminRouter.svelte"
	import { adminPage as page } from "$lib/client/admin/adminRouter.svelte"
	import * as Icons from "@lucide/svelte"
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import { WIDGET_BASE_SECTIONS } from "@serene-pub/sdk"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getAdminInterestContext } from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { i18nTextIn } from "$lib/shared/i18n/i18nText"
	import { toaster } from "$lib/client/utils/toaster"
	import { desktop } from "$lib/client/utils/breakpoint.svelte"
	import AdminPageHeader from "$lib/client/components/admin/AdminPageHeader.svelte"
	import PanelTabStrip, { type PanelTab } from "$lib/client/components/panels/PanelTabStrip.svelte"
	import CodeEditor from "$lib/client/components/componentEditor/CodeEditor.svelte"
	import CoreDiff from "$lib/client/components/componentEditor/CoreDiff.svelte"
	import PreviewPane from "$lib/client/components/componentEditor/PreviewPane.svelte"
	import { errorRows, type ErrorRow } from "$lib/client/components/componentEditor/compileErrors"
	import { downloadShareFile } from "$lib/client/components/componentEditor/componentShare"
	import {
		COMPONENT_DRAFT_TEXT,
		SAVE_CONFLICT_TEXT,
		adminRedirect,
		canRevertDraft,
		coreDrift,
		editorSource,
		englishOf,
		exportNotice,
		saveNotice,
		isSaveConflict,
		sameFiles,
		sameWidgetDraft,
		withEnglish,
		type WidgetDraft
	} from "$lib/client/components/componentEditor/editorState"

	type Detail = Sockets.Components.Detail
	type CompileOutcome = Sockets.Components.CompileOutcome

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()
	const interest = getAdminInterestContext()
	const panelsCtx: PanelsCtx | undefined = getContext("panelsCtx")
	/** Offer Focus where the shell has it (desk width) and the view is not already there. */
	let canFocus = $derived(desktop.matches && !!panelsCtx && panelsCtx.viewWidth !== "focus")

	let id = $derived(page.params.id ?? "")

	let component = $state<Detail | null>(null)
	let loadError = $state<string | null>(null)
	let compilerAvailable = $state(true)

	// ── the draft ───────────────────────────────────────────────────────
	let files = $state<Record<string, string>>({})
	let entry = $state("")
	let active = $state("")
	let widget = $state<WidgetDraft>({ label: "", title: "", icon: "", scopes: [], reads: [] })

	function seed(c: Detail) {
		const src = editorSource(c)
		files = { ...src.files }
		entry = src.entry
		if (!Object.hasOwn(src.files, active)) active = src.entry
		widget = draftOf(c)
	}
	const draftOf = (c: Detail): WidgetDraft => ({
		label: englishOf(c.label),
		title: englishOf(c.widget.title),
		icon: c.widget.icon ?? "",
		scopes: [...(c.widget.scopes ?? [])],
		reads: [...(c.widget.reads ?? [])]
	})

	/** What the editor opened: the component draft when there is one, else the saved version. */
	let opened = $derived(component ? editorSource(component) : null)
	let filesDirty = $derived(!!opened && (!sameFiles(files, opened.files) || entry !== opened.entry))
	/**
	 * The side form as Save would send it: trimmed, and an emptied label or
	 * title falling back to the saved one, exactly as `save()` does — so a
	 * trailing space, or a label cleared and left empty, is not an edit that
	 * never clears.
	 */
	let widgetAsSaved = $derived<WidgetDraft | null>(
		component
			? {
					...widget,
					label: widget.label.trim() || englishOf(component.label),
					title: widget.title.trim() || englishOf(component.widget.title),
					icon: widget.icon.trim()
				}
			: null
	)
	let widgetDirty = $derived(!!component && !!widgetAsSaved && !sameWidgetDraft(widgetAsSaved, draftOf(component)))
	let dirty = $derived(filesDirty || widgetDirty)
	adminUnsavedEdits(() => dirty)
	let readOnly = $derived(!compilerAvailable)

	// ── what the compiler and the widget said ───────────────────────────
	let compile = $state<CompileOutcome | null>(null)
	let runtime = $state<{ message: string; stack?: string }[]>([])
	let rows = $derived<ErrorRow[]>(errorRows(compile?.errors ?? [], runtime, files))

	// ── preview ─────────────────────────────────────────────────────────
	let previewUrl = $state<string | null>(null)
	let previewing = $state(false)
	/** The last preview failed to compile: what is mounted is the one before. */
	let previewStale = $state(false)

	// ── writes in flight, and what came back ───────────────────────────
	let saving = $state(false)
	let reverting = $state(false)
	let conflict = $state(false)
	let changedElsewhere = $state(false)
	/** Own writes not yet echoed by `components:changed` — those pushes are ours. */
	let ownWrites = 0
	/**
	 * Replies go to every socket of this user that declared the verb — this
	 * admin's other tabs included — so a reply is taken only while this page
	 * is waiting for one. Another tab's save must not refresh the
	 * `updatedAt` this page will send, or a stale save would pass.
	 */
	let awaitingGet = false
	let awaitingDetail = 0
	/** An export asked for here — another tab's export must not download in this one. */
	let exporting = $state(false)

	// ── core, for a clone ───────────────────────────────────────────────
	let core = $state<Sockets.Components.CoreSource.Response | null>(null)
	let coreError = $state<string | null>(null)
	let drift = $derived(coreDrift(component?.basedOn, core))

	// ── the side panel ──────────────────────────────────────────────────
	const initialTab = page.url.searchParams.get("tab")
	let side = $state(["preview", "problems", "widget", "saved", "core"].includes(initialTab ?? "") ? initialTab! : "preview")
	let tabs = $derived<PanelTab[]>([
		{ value: "preview", label: "Preview", icon: Icons.Eye },
		{ value: "problems", label: "Problems", icon: Icons.CircleAlert, hasError: rows.length > 0 },
		{ value: "widget", label: "Widget", icon: Icons.Settings2, hasError: !!component?.needsReview },
		...(component?.componentDraft ? [{ value: "saved", label: "Last save", icon: Icons.History }] : []),
		...(component?.basedOn ? [{ value: "core", label: "Core", icon: Icons.GitCompare }] : [])
	])

	let editor = $state<ReturnType<typeof CodeEditor> | null>(null)

	/* ── socket wiring ────────────────────────────────────────────────── */

	function handleGet(res: Sockets.Components.Get.Response) {
		if (res.component.id !== id || !awaitingGet) return
		awaitingGet = false
		const first = !component
		component = res.component
		loadError = null
		conflict = false
		changedElsewhere = false
		seed(res.component)
		if (res.component.basedOn) socket.emit("components:coreSource", { slug: res.component.basedOn.component })
		if (first && compilerAvailable) preview()
	}
	function handleGetError(res: Sockets.ErrorResponse) {
		if (!awaitingGet) return
		awaitingGet = false
		loadError = res.error ?? "This component could not be read."
	}
	function handleList(res: Sockets.Components.List.Response) {
		compilerAvailable = res.compiler.available
	}
	function handleSave(res: Sockets.Components.Save.Response) {
		if (res.component.id !== id || !saving) return
		saving = false
		component = res.component
		compile = res.compile
		const notice = saveNotice(res)
		if (notice.tone === "success") {
			toaster.success({ title: notice.title })
			preview()
		} else {
			toaster.warning({ title: notice.title, description: notice.description })
			side = "problems"
		}
	}
	function handleRevertDraft(res: Sockets.Components.RevertDraft.Response) {
		if (res.component.id !== id || !reverting) return
		reverting = false
		component = res.component
		compile = null
		runtime = []
		seed(res.component)
		if (side === "saved") side = "preview"
		toaster.success({ title: "Reverted to the last save" })
		preview()
	}
	function handleRevertDraftError(res: Sockets.ErrorResponse) {
		if (!reverting) return
		reverting = false
		ownWrites = Math.max(0, ownWrites - 1)
		if (isSaveConflict(res.error)) conflict = true
		else if (res.error) toaster.error({ title: res.error })
	}
	function handleSaveError(res: Sockets.ErrorResponse) {
		if (!saving) return
		saving = false
		ownWrites = Math.max(0, ownWrites - 1)
		if (isSaveConflict(res.error)) conflict = true
		else if (res.error) toaster.error({ title: res.error })
	}
	function handlePreview(res: Sockets.Components.Preview.Response) {
		if (!previewing) return
		previewing = false
		compile = res.compile
		if (res.url) {
			runtime = []
			previewUrl = res.url
			previewStale = false
		} else {
			previewStale = !!previewUrl
			side = "problems"
		}
	}
	function handlePreviewError(res: Sockets.ErrorResponse) {
		if (!previewing) return
		previewing = false
		if (res.error) toaster.error({ title: res.error })
	}
	function handleExport(res: Sockets.Components.Export.Response) {
		if (!exporting) return
		exporting = false
		downloadShareFile(res)
		const notice = exportNotice(res, dirty)
		if (notice) toaster.info(notice)
	}
	function handleExportError(res: Sockets.ErrorResponse) {
		if (!exporting) return
		exporting = false
		if (res.error) toaster.error({ title: res.error })
	}
	function handleDetail(res: { component: Detail }) {
		if (res.component.id !== id || awaitingDetail === 0) return
		awaitingDetail--
		component = res.component
	}
	function handleWriteError(res: Sockets.ErrorResponse) {
		if (awaitingDetail === 0) return
		awaitingDetail--
		ownWrites = Math.max(0, ownWrites - 1)
		if (res.error) toaster.error({ title: res.error })
	}
	function handleCoreSource(res: Sockets.Components.CoreSource.Response) {
		if (res.slug !== component?.basedOn?.component) return
		core = res
		coreError = null
	}
	function handleCoreSourceError(res: Sockets.ErrorResponse) {
		coreError = res.error ?? "Core's source could not be read."
	}
	function handleChanged(res: Sockets.Components.Changed.Response) {
		if (res.id !== id) return
		if (ownWrites > 0) {
			ownWrites--
			return
		}
		changedElsewhere = true
	}

	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const releases = [
			interest.declareInterest<"components:get:error">("components:get:error", handleGetError),
			interest.declareInterest<"components:save">("components:save", handleSave),
			interest.declareInterest<"components:save:error">("components:save:error", handleSaveError),
			interest.declareInterest<"components:revertDraft">("components:revertDraft", handleRevertDraft),
			interest.declareInterest<"components:revertDraft:error">("components:revertDraft:error", handleRevertDraftError),
			interest.declareInterest<"components:preview">("components:preview", handlePreview),
			interest.declareInterest<"components:preview:error">("components:preview:error", handlePreviewError),
			interest.declareInterest<"components:setEnabled">("components:setEnabled", handleDetail),
			interest.declareInterest<"components:setEnabled:error">("components:setEnabled:error", handleWriteError),
			interest.declareInterest<"components:reviewScopes">("components:reviewScopes", handleDetail),
			interest.declareInterest<"components:reviewScopes:error">("components:reviewScopes:error", handleWriteError),
			interest.declareInterest<"components:export">("components:export", handleExport),
			interest.declareInterest<"components:export:error">("components:export:error", handleExportError),
			interest.declareInterest<"components:coreSource">("components:coreSource", handleCoreSource),
			interest.declareInterest<"components:coreSource:error">("components:coreSource:error", handleCoreSourceError),
			interest.requestWithInterest("components:list", {}, handleList)
		]
		return () => {
			for (const release of releases) release()
		}
	})

	// The component itself: asked for again when the id in the URL moves.
	$effect(() => {
		if (!userCtx.user?.isAdmin || !id) return
		awaitingGet = true
		return interest.requestWithInterest("components:get", { id }, handleGet)
	})

	// Its announcements, scoped to its owner: another tab's or admin's save.
	$effect(() => {
		if (!userCtx.user?.isAdmin || !component) return
		return interest.declareInterest<"components:changed">(
			interestKey("components:changed", component.ownerId),
			handleChanged
		)
	})

	onMount(() => {
		const to = adminRedirect(userCtx.user)
		if (to) goto(to)
	})

	/* ── actions ──────────────────────────────────────────────────────── */

	function save() {
		if (!component || saving || readOnly || !dirty) return
		saving = true
		ownWrites++
		const c = component
		socket.emit("components:save", {
			id: c.id,
			expectedUpdatedAt: c.updatedAt,
			files: $state.snapshot(files),
			entry,
			label: withEnglish(c.label, widget.label.trim() || englishOf(c.label)),
			widget: {
				...(c.widget as Sockets.Components.Widget),
				title: withEnglish(c.widget.title, widget.title.trim() || englishOf(c.widget.title)),
				icon: widget.icon.trim() || undefined,
				scopes: [...widget.scopes],
				reads: [...widget.reads]
			}
		})
	}

	/** Discard the component draft — and any unsaved edits — and go back to what sessions run. */
	function revertDraft() {
		if (!component || !canRevertDraft(component, { busy: saving || reverting, readOnly })) return
		reverting = true
		ownWrites++
		socket.emit("components:revertDraft", { id: component.id, expectedUpdatedAt: component.updatedAt })
	}

	function preview() {
		if (!component || previewing || readOnly) return
		previewing = true
		socket.emit("components:preview", {
			files: $state.snapshot(files),
			entry,
			framework: component.framework
		})
	}

	function reload() {
		awaitingGet = true
		socket.emit("components:get", { id })
	}

	/** Export what is saved — the draft is not in the file until it is saved. */
	function exportSaved() {
		if (!component || exporting) return
		exporting = true
		socket.emit("components:export", { id: component.id })
	}

	function setEnabled(enabled: boolean) {
		if (!component) return
		ownWrites++
		awaitingDetail++
		socket.emit("components:setEnabled", { id: component.id, enabled })
	}

	function onRuntimeError(e: { message: string; stack?: string }) {
		runtime = [...runtime, e].slice(-20)
	}

	function jump(row: ErrorRow) {
		if (!row.location) return
		editor?.jumpTo(row.location.file, row.location.offset)
	}

	function onKey(e: KeyboardEvent) {
		if (!(e.ctrlKey || e.metaKey)) return
		if (e.key === "s") {
			e.preventDefault()
			save()
		} else if (e.key === "Enter") {
			e.preventDefault()
			preview()
		}
	}

	/* ── the widget's declaration ─────────────────────────────────────── */

	const SCOPES: { key: string; label: string; hint: string }[] = [
		{ key: "session:state", label: "Stats and states", hint: "the cast's and the world's values" },
		{ key: "characters", label: "The cast", hint: "who is in the session, with faces and sprites" },
		{ key: "lore", label: "Lore", hint: "may ask for pages of the session's entries" },
		{ key: "session:full", label: "The whole conversation", hint: "provisional; its shape is not settled" },
		{ key: "persona", label: "The viewer's persona", hint: "declared; nothing supplies it yet" }
	]

	function toggle(list: "scopes" | "reads", key: string) {
		const cur = widget[list]
		widget[list] = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]
	}

	/** Scope review: a checked scope is granted, an unchecked one denied. */
	let reviewDraft = $state<Record<string, boolean>>({})
	$effect(() => {
		const next: Record<string, boolean> = {}
		for (const s of component?.scopes ?? []) next[s.key] = s.pending ? true : s.granted
		reviewDraft = next
	})
	function saveReview() {
		if (!component) return
		ownWrites++
		awaitingDetail++
		const denied = Object.entries(reviewDraft)
			.filter(([, granted]) => !granted)
			.map(([key]) => key)
		socket.emit("components:reviewScopes", { id: component.id, denied })
	}

	const text = (v: unknown) => i18nTextIn(v) ?? ""
</script>

<svelte:window onkeydown={onKey} />

<a
	class="text-surface-600-400 hover:text-surface-800-200 mb-3 inline-flex items-center gap-1 text-[13px]"
	href="/admin/components"
>
	<Icons.ChevronLeft size={14} /> Back to components
</a>

<AdminPageHeader
	title={component ? text(component.label) : "Component"}
	purpose="Edit its files, preview them against sample data, and save to change what sessions run."
>
	{#snippet actions()}
		<div class="header-actions">
			{#if component}
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					onclick={exportSaved}
					disabled={exporting}
				>
					{#if exporting}<Icons.LoaderCircle size={14} class="animate-spin" />{:else}<Icons.Download size={14} />{/if}
					Export
				</button>
				{#if !readOnly}
					<button type="button" class="btn btn-sm preset-tonal-surface" onclick={preview} disabled={previewing} title="Ctrl+Enter">
						{#if previewing}<Icons.LoaderCircle size={14} class="animate-spin" />{:else}<Icons.Play size={14} />{/if}
						Preview
					</button>
					<button type="button" class="btn btn-sm preset-filled-primary-500" onclick={save} disabled={!dirty || saving || conflict} title="Ctrl+S">
						{#if saving}<Icons.LoaderCircle size={14} class="animate-spin" />{:else}<Icons.Save size={14} />{/if}
						Save
					</button>
				{/if}
			{/if}
		</div>
	{/snippet}
	{#if component}
		<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
			<p class="text-surface-600-400 flex min-w-0 flex-wrap items-center gap-2 text-xs">
				<span class="truncate font-mono">{component.widgetId} · {component.framework}</span>
				{#if component.basedOn}
					<span class="preset-tonal-surface rounded-full px-2 py-0.5">Clone of {component.basedOn.component}</span>
				{/if}
				{#if dirty}
					<span class="preset-tonal-warning rounded-full px-2 py-0.5">Unsaved</span>
				{/if}
			</p>
			<Switch checked={component.enabled} onCheckedChange={(e) => setEnabled(e.checked)} class="ml-auto flex items-center gap-2">
				<Switch.Label class="text-sm">Offered to layouts</Switch.Label>
				<Switch.Control class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500">
					<Switch.Thumb />
				</Switch.Control>
				<Switch.HiddenInput />
			</Switch>
		</div>
		{#if canFocus}
			<!-- The editor wants room: beside the page (dock, half) it stacks,
			     and Focus gives it the code and the preview side by side. -->
			<p class="focus-hint text-surface-600-400 flex flex-wrap items-center gap-2 text-sm">
				The editor has more room in Focus.
				<button type="button" class="btn btn-sm preset-tonal-surface" onclick={() => panelsCtx?.setViewWidth("focus")}>
					<Icons.Maximize2 size={14} /> Open in Focus
				</button>
			</p>
		{/if}
	{/if}
</AdminPageHeader>

{#if loadError}
	<div class="panel-card text-sm" role="alert">
		<p class="text-error-700-300">{loadError}</p>
		<a class="underline" href="/admin/components">Back to components</a>
	</div>
{:else if !component}
	<p class="text-surface-600-400 flex items-center gap-2 text-sm" role="status">
		<Icons.LoaderCircle size={14} class="animate-spin" /> Loading the component…
	</p>
{:else}
	<div class="mb-3 flex flex-col gap-2">
		{#if conflict}
			<div class="banner banner-error" role="alert">
				<Icons.TriangleAlert size={16} class="shrink-0" />
				<p class="flex-1">{SAVE_CONFLICT_TEXT}</p>
				<button type="button" class="btn btn-sm preset-tonal-surface" onclick={reload}>Reload</button>
			</div>
		{:else if changedElsewhere}
			<div class="banner banner-warning" role="status">
				<Icons.RefreshCw size={16} class="shrink-0" />
				<p class="flex-1">This component was changed somewhere else. Reload to see that version{dirty ? " — your unsaved changes here are dropped" : ""}.</p>
				<button type="button" class="btn btn-sm preset-tonal-surface" onclick={reload}>Reload</button>
			</div>
		{/if}
		{#if component.componentDraft}
			<div class="banner banner-warning" role="status" data-component-draft>
				<Icons.FilePen size={16} class="shrink-0" />
				<p class="flex-1">{COMPONENT_DRAFT_TEXT}{dirty ? " Reverting drops your unsaved changes here too." : ""}</p>
				<button type="button" class="btn btn-sm preset-tonal-surface" onclick={() => (side = "saved")}>Compare</button>
				{#if !readOnly}
					<button
						type="button"
						class="btn btn-sm preset-tonal-warning"
						onclick={revertDraft}
						disabled={!canRevertDraft(component, { busy: saving || reverting, readOnly })}
					>
						{#if reverting}<Icons.LoaderCircle size={14} class="animate-spin" />{:else}<Icons.Undo2 size={14} />{/if}
						Revert to last save
					</button>
				{/if}
			</div>
		{/if}
		{#if drift === "changed"}
			<div class="banner banner-primary" role="status">
				<Icons.GitCompare size={16} class="shrink-0" />
				<p class="flex-1">Core's {component.basedOn?.component} has changed since you cloned it.</p>
				<button type="button" class="btn btn-sm preset-tonal-surface" onclick={() => (side = "core")}>Compare</button>
			</div>
		{/if}
		{#if readOnly}
			<div class="banner banner-warning" role="status">
				<Icons.Info size={16} class="shrink-0" />
				<p class="flex-1">This instance has no component compiler, so the source is read only here. You can still switch it on or off and review its scopes.</p>
			</div>
		{/if}
		{#if component.lastError && !compile}
			<div class="banner banner-error" role="status">
				<Icons.CircleAlert size={16} class="shrink-0" />
				<p class="flex-1">The last save did not compile: {component.lastError}</p>
			</div>
		{/if}
	</div>

	<div class="editor-grid">
		<div class="editor-main">
			<CodeEditor
				bind:this={editor}
				{files}
				{entry}
				bind:active
				{readOnly}
				label="{text(component.label)} files"
				onedit={(path, t) => (files[path] = t)}
				onfiles={(next, nextEntry, nextActive) => {
					files = next
					entry = nextEntry
					active = nextActive
				}}
			/>
		</div>

		<div class="editor-side panel-card flex min-h-0 flex-col gap-3">
			<PanelTabStrip {tabs} bind:value={side} ariaLabel="Component tools" panelIdPrefix="component-side" />

			<div id="component-side-preview" role="tabpanel" aria-labelledby="component-side-preview-tab" hidden={side !== "preview"} class="min-h-0 flex-1">
				{#if previewStale}
					<p class="text-warning-700-300 mb-2 text-xs" role="status">Your edits don't compile — this is the last version that did. See Problems.</p>
				{/if}
				<PreviewPane
					url={previewUrl}
					owner={component.ownerId}
					title={widget.title || text(component.widget.title)}
					scopes={widget.scopes}
					reads={widget.reads}
					{onRuntimeError}
				/>
			</div>

			<div id="component-side-problems" role="tabpanel" aria-labelledby="component-side-problems-tab" hidden={side !== "problems"} class="min-h-0 flex-1 overflow-auto">
				{#if !compile && !runtime.length}
					<p class="text-surface-600-400 text-sm">Preview or save to compile your edits; what goes wrong shows here.</p>
				{:else if !rows.length}
					<p class="text-sm"><Icons.CircleCheck size={14} class="text-success-500 inline" /> It compiles{runtime.length ? "" : ", and the preview has reported nothing"}.</p>
				{/if}
				{#if rows.length}
					<ul class="flex flex-col gap-1">
						{#each rows as row, i (i)}
							<li>
								{#if row.location}
									<button type="button" class="problem-row w-full text-left" onclick={() => jump(row)}>
										<span class="text-error-700-300 font-mono text-xs">{row.place}</span>
										<span class="block text-sm whitespace-pre-wrap">{row.text}</span>
									</button>
								{:else}
									<div class="problem-row">
										<span class="text-error-700-300 font-mono text-xs">{row.kind === "runtime" ? "While running" : row.place || "Compile"}</span>
										<span class="block text-sm whitespace-pre-wrap">{row.text}</span>
										{#if row.stack}
											<details class="mt-1">
												<summary class="text-surface-600-400 cursor-pointer text-xs">Stack</summary>
												<pre class="text-surface-600-400 overflow-x-auto text-xs whitespace-pre-wrap">{row.stack}</pre>
											</details>
										{/if}
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
				{#if compile?.warnings.length}
					<details class="mt-3 text-xs">
						<summary class="text-surface-600-400 cursor-pointer">{compile.warnings.length} warning{compile.warnings.length === 1 ? "" : "s"}</summary>
						<ul class="mt-1 space-y-1">
							{#each compile.warnings as w, i (i)}<li class="whitespace-pre-wrap">{w}</li>{/each}
						</ul>
					</details>
				{/if}
			</div>

			<div id="component-side-widget" role="tabpanel" aria-labelledby="component-side-widget-tab" hidden={side !== "widget"} class="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
				<label class="flex flex-col gap-1 text-sm">
					<span class="text-surface-600-400 text-xs">Name in this list</span>
					<input class="input" bind:value={widget.label} disabled={readOnly} />
				</label>
				<label class="flex flex-col gap-1 text-sm">
					<span class="text-surface-600-400 text-xs">Title on the widget</span>
					<input class="input" bind:value={widget.title} disabled={readOnly} />
				</label>
				<label class="flex flex-col gap-1 text-sm">
					<span class="text-surface-600-400 text-xs">Icon (a Lucide icon name)</span>
					<input class="input font-mono" bind:value={widget.icon} disabled={readOnly} spellcheck="false" />
				</label>
				<fieldset class="flex flex-col gap-1.5">
					<legend class="text-surface-600-400 mb-1 text-xs">What it may read beyond the basics</legend>
					{#each SCOPES as s (s.key)}
						<label class="flex items-start gap-2 text-sm">
							<input type="checkbox" class="checkbox mt-0.5" checked={widget.scopes.includes(s.key)} onchange={() => toggle("scopes", s.key)} disabled={readOnly} />
							<span>{s.label} <span class="text-surface-600-400 text-xs">— {s.hint}</span></span>
						</label>
					{/each}
				</fieldset>
				<fieldset class="flex flex-col gap-1.5">
					<legend class="text-surface-600-400 mb-1 text-xs">Basic sections it reads (none ticked reads them all)</legend>
					<div class="flex flex-wrap gap-x-4 gap-y-1.5">
						{#each WIDGET_BASE_SECTIONS as r (r)}
							<label class="flex items-center gap-2 font-mono text-xs">
								<input type="checkbox" class="checkbox" checked={widget.reads.includes(r)} onchange={() => toggle("reads", r)} disabled={readOnly} />
								{r}
							</label>
						{/each}
					</div>
				</fieldset>
				{#if widgetDirty}
					<p class="text-surface-600-400 text-xs">Saved with the source. The scopes it asks for wait for review once saved.</p>
				{/if}

				{#if component.scopes.length}
					<fieldset class="flex flex-col gap-1.5">
						<legend class="text-surface-600-400 mb-1 text-xs">Scope review — what this instance grants it (as saved)</legend>
						{#each component.scopes as s (s.key)}
							<label class="flex items-center gap-2 text-sm">
								<input type="checkbox" class="checkbox" bind:checked={reviewDraft[s.key]} />
								<span class="flex-1">{s.label}</span>
								{#if s.pending}
									<span class="preset-tonal-warning rounded-full px-2 py-0.5 text-xs">Waiting for review</span>
								{:else}
									<span class="text-surface-600-400 text-xs">{s.granted ? "Granted" : "Denied"}</span>
								{/if}
							</label>
						{/each}
						<div>
							<button type="button" class="btn btn-sm preset-filled-primary-500" onclick={saveReview}>
								<Icons.ShieldCheck size={14} /> Save review
							</button>
						</div>
					</fieldset>
				{/if}
			</div>

			{#if component.componentDraft}
				<div id="component-side-saved" role="tabpanel" aria-labelledby="component-side-saved-tab" hidden={side !== "saved"} class="min-h-0 flex-1">
					{#if side === "saved"}
						<CoreDiff
							core={{ slug: "last save", files: component.files, catalogVersion: "" }}
							{files}
							drift="unknown"
							otherName="the last save"
							caption="Struck lines are the last save — what sessions run; the rest is this draft."
						/>
					{/if}
				</div>
			{/if}

			{#if component.basedOn}
				<div id="component-side-core" role="tabpanel" aria-labelledby="component-side-core-tab" hidden={side !== "core"} class="min-h-0 flex-1">
					{#if side === "core"}
						<CoreDiff {core} {files} {drift} error={coreError} />
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/if}

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
	.editor-grid {
		display: grid;
		gap: 12px;
		grid-template-columns: minmax(0, 1fr);
	}
	.editor-main {
		height: 70vh;
		min-height: 480px;
		min-width: 0;
	}
	.editor-side {
		min-height: 480px;
		min-width: 0;
	}
	@container content (min-width: 1000px) {
		.focus-hint {
			display: none;
		}
		.editor-grid {
			grid-template-columns: minmax(0, 1fr) minmax(360px, 460px);
		}
		.editor-side {
			height: 70vh;
		}
	}
	.banner {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		padding: 8px 12px;
		border-radius: 10px;
		font-size: 14px;
	}
	.banner-error {
		background: color-mix(in oklab, var(--color-error-500) 14%, transparent);
	}
	.banner-warning {
		background: color-mix(in oklab, var(--color-warning-500) 14%, transparent);
	}
	.banner-primary {
		background: color-mix(in oklab, var(--color-primary-500) 14%, transparent);
	}
	.problem-row {
		display: block;
		padding: 6px 8px;
		border-radius: 8px;
	}
	button.problem-row:hover {
		background: color-mix(in oklab, var(--color-surface-500) 10%, transparent);
	}
	button.problem-row:focus-visible {
		outline: 2px solid var(--color-primary-500);
		outline-offset: 2px;
	}
</style>
