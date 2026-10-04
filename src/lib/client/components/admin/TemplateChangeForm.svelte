<script lang="ts">
	/**
	 * The change-form half of the template admin: one dedicated page per
	 * template (Django's change form, built on `AdminChangeForm`), shared by
	 * context templates and variable templates. `id` absent means add mode,
	 * which additionally asks for the pool (the step or variable this
	 * template renders for). Fieldsets: Template (name, pool), Source,
	 * Preview, and the pipelines using it inline; the save row is Django's.
	 *
	 * Editing reuses the library's exact write events — every mutation answers
	 * with the whole refreshed view, so this page stays honest about what the
	 * server actually stored. A built-in row is read-only here (clone it to
	 * change it), same rule as everywhere else.
	 */
	import * as Icons from "@lucide/svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { untrack } from "svelte"
	import { adminGoto as goto, adminUnsavedEdits } from "$lib/client/admin/adminRouter.svelte"
	import { UnsavedEdits } from "$lib/client/forms/unsavedEdits.svelte"
	import AdminChangeForm, { type AdminSaveIntent } from "./AdminChangeForm.svelte"
	import AdminFieldset from "./AdminFieldset.svelte"
	import AdminField, { describedBy } from "./AdminField.svelte"
	import AdminInline from "./AdminInline.svelte"
	import { deletionFor } from "./changelist"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import {
		requestWithInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import TemplateEditor from "$lib/client/components/templates/TemplateEditor.svelte"
	import { getVariable } from "@serene-pub/sdk"
	import { contextTemplateScope } from "$lib/shared/utils/contextConfigCards"
	import {
		CORE_TEMPLATE_ENGINE,
		splitPoolKey
	} from "$lib/shared/pipelines/poolKey"

	import { toaster } from "$lib/client/utils/toaster"

	type Template = Sockets.Pipelines.Library.LibraryTemplate

	interface Props {
		kind: "context" | "variable"
		/** Route base, e.g. `/admin/context-templates`. */
		basePath: string
		/** The row to edit; absent = create mode. */
		id?: number
	}
	let { kind, basePath, id }: Props = $props()

	/** The changelist's name: the breadcrumb and the save row's words. */
	const sectionLabel = $derived(
		kind === "context" ? "Context templates" : "Variable templates"
	)
	const noun = { singular: "template", plural: "templates" }

	const socket = useTypedSocket()

	let view = $state<Sockets.Pipelines.Library.Response>({})
	let loading = $state(true)
	/** Draft fields; seeded from the row once (or blank in create mode). */
	let name = $state("")
	let source = $state("")
	/**
	 * The pool a template belongs to, as the composite `(node type)#(engine)`
	 * key the library builds.
	 *
	 * The ENGINE is not separate state and must not be: it is half of this key,
	 * so a template's language is decided by choosing its pool. Holding it apart
	 * meant create mode started with `engine = null`, which the renderer used to
	 * silently coerce to Handlebars — the exact bug this sprint removed — and
	 * which the event now rejects outright.
	 */
	let poolId = $state("")
	let seeded = $state(false)

	let rows = $derived(
		(kind === "context"
			? (view.contextTemplates ?? [])
			: (view.variableTemplates ?? [])) as Template[]
	)
	let row = $derived(id != null ? rows.find((r) => r.id === id) : undefined)
	let pools = $derived(
		(kind === "context"
			? (view.contextPools ?? [])
			: (view.variablePools ?? [])) as Array<{
			id: string
			label: string
		}>
	)
	let readonly = $derived(!!row?.isImmutable)

	/**
	 * Unsaved edits against the row as last pushed. Every push of the
	 * library moves the saved snapshot and only a clean form is overwritten,
	 * so the echo of this page's own save makes it clean. Create mode's
	 * snapshot is the blank form it opened on: nothing typed, nothing to lose.
	 */
	const edits = new UnsavedEdits(() => ({ name, source, poolId }))
	$effect(() => {
		if (loading) return
		if (id != null) {
			if (!row) return
			const next = { name: row.name, source: row.source, poolId: row.poolId }
			untrack(() =>
				edits.adoptSaved(next, (n) => {
					name = n.name
					source = n.source
					poolId = n.poolId
				})
			)
			seeded = true
		} else if (!seeded) {
			poolId = pools[0]?.id ?? ""
			seeded = true
			untrack(() => edits.markSaved())
		}
	})
	adminUnsavedEdits(() => edits.dirty)


	/**
	 * The language this row is written in.
	 *
	 * On an existing row it is the row's own, never re-derived from the pool
	 * control: `poolId` is seeded from `row.poolId`, which is the BARE target
	 * id, so splitting it would answer "Handlebars" for every row and a save
	 * would try to rewrite a Liquid template as Handlebars. In create mode
	 * there is no row yet and the pool key is where the choice lives.
	 */
	let engine = $derived(
		id != null
			? (row?.engine ?? CORE_TEMPLATE_ENGINE)
			: splitPoolKey(poolId, CORE_TEMPLATE_ENGINE).engine
	)

	/**
	 * What this template may reference: a context template sees the whole
	 * vocabulary; a variable layout sees only what its variable declares. A
	 * plugin's variable isn't in this bundle, so the editor simply offers no
	 * assistance rather than the wrong assistance.
	 *
	 * Split first: in create mode `poolId` is the composite `(variable)#(engine)`
	 * key, and a variable id with an engine glued to it matches no declaration.
	 */
	let scope = $derived(
		kind === "context"
			? contextTemplateScope()
			: getVariable(splitPoolKey(poolId, CORE_TEMPLATE_ENGINE).poolId)
					?.scope
	)

	function handleLibrary(res: Sockets.Pipelines.Library.Response) {
		view = res
		loading = false
	}
	/**
	 * Every write answers with the refreshed view, wrapped.
	 *
	 * ⚠ The payload is `{ library, warnings? }`, not the view itself. Assigning
	 * the wrapper to `view` left every list on it undefined, so the page
	 * decided the row no longer existed the moment it was saved.
	 */
	function handleWrite(res: {
		library?: Sockets.Pipelines.Library.Response
		warnings?: Sockets.Pipelines.TemplateWarning[]
		createdId?: number
	}) {
		if (res.library) view = res.library
		for (const w of res.warnings ?? [])
			toaster.warning({
				title: w.line ? `Line ${w.line}: ${w.message}` : w.message
			})
	}
	/** This page's own save or delete landing, by the event it answers on. */
	function handleMine(
		ev: (typeof WRITE_EVENTS)[number],
		res: { library?: Sockets.Pipelines.Library.Response; createdId?: number }
	) {
		if (ev === "pipelines:libraryDeleteTemplate" && deleting) {
			deleting = false
			edits.forget()
			toaster.success({ title: "Template deleted" })
			void goto(basePath, { replaceState: true })
			return
		}
		const intent = pendingIntent
		const mine =
			(ev === "pipelines:libraryUpdateTemplate" && id != null) ||
			(ev === "pipelines:libraryCreateTemplate" && id == null)
		if (!intent || !mine) return
		pendingIntent = null
		saving = false
		edits.forget()
		toaster.success({ title: id != null ? "Template saved" : "Template added" })
		if (id != null) edits.markSaved()
		if (intent === "save") void goto(basePath)
		else if (intent === "another") void goto(`${basePath}/new`)
		else if (id == null && res.createdId)
			void goto(`${basePath}/${res.createdId}`, { replaceState: true })
	}
	function handleError(res: { error?: string }) {
		if (pendingIntent || deleting) {
			pendingIntent = null
			saving = false
			deleting = false
			formErrors = [res.error ?? "The library refused the edit."]
			return
		}
		toaster.error({ title: res.error ?? "The library refused the edit." })
	}

	// ── preview ─────────────────────────────────────────────────────
	let preview = $state<Sockets.Pipelines.PreviewTemplate.Response | null>(
		null
	)
	function handlePreview(res: Sockets.Pipelines.PreviewTemplate.Response) {
		preview = res
	}
	function runPreview() {
		// Split, because the server indexes the pool as two columns and the
		// composite is an in-memory key only. Sending the composite as `poolId`
		// would look up a pool that no row is stored under.
		if (!poolId) return
		const split = splitPoolKey(poolId, CORE_TEMPLATE_ENGINE)
		socket.emit("pipelines:previewTemplate", {
			kind,
			source,
			engine,
			poolId: split.poolId
		})
	}

	const WRITE_EVENTS = [
		"pipelines:libraryCreateTemplate",
		"pipelines:libraryUpdateTemplate",
		"pipelines:libraryCloneTemplate",
		"pipelines:libraryDeleteTemplate"
	] as const

	/**
	 * The preview and every write's answer stand: each comes back when the
	 * person presses a button, not in reply to anything asked here. One
	 * `useInterest` call per key — each is its own `$effect`, released with the
	 * component. BARE: a template pool is not one session's anything.
	 */
	useInterest<"pipelines:previewTemplate">(
		"pipelines:previewTemplate",
		handlePreview
	)
	for (const ev of WRITE_EVENTS) {
		useInterest<"pipelines:libraryUpdateTemplate">(ev, (res) => {
			handleWrite(res)
			handleMine(ev, res)
		})
		useInterest<"pipelines:libraryUpdateTemplate:error">(
			`${ev}:error`,
			handleError
		)
	}

	/** The library view, asked for and listened for in one. BARE, same reason. */
	$effect(() => requestWithInterest("pipelines:library", {}, handleLibrary))

	let saving = $state(false)
	let pendingIntent: AdminSaveIntent | null = null
	let deleting = false
	let formErrors = $state<string[]>([])

	function save(intent: AdminSaveIntent) {
		formErrors = []
		if (id != null) {
			if (!edits.dirty) {
				if (intent === "save") void goto(basePath)
				else if (intent === "another") void goto(`${basePath}/new`)
				return
			}
			saving = true
			pendingIntent = intent
			socket.emit("pipelines:libraryUpdateTemplate", { kind, id, name, source, engine })
		} else {
			if (!poolId) {
				formErrors = [kind === "context" ? "Pick the step it renders for." : "Pick the variable it lays out."]
				return
			}
			const split = splitPoolKey(poolId, CORE_TEMPLATE_ENGINE)
			saving = true
			pendingIntent = intent
			socket.emit("pipelines:libraryCreateTemplate", {
				kind,
				poolId: split.poolId,
				name: name || undefined,
				source: source || undefined,
				engine
			})
		}
	}

	function clone() {
		if (id == null) return
		socket.emit("pipelines:libraryCloneTemplate", { kind, id })
		toaster.success({ title: "Template duplicated" })
		void goto(basePath)
	}

	function remove() {
		if (id == null || !row) return
		deleting = true
		socket.emit("pipelines:libraryDeleteTemplate", { kind, id })
	}

	const deletion = () =>
		deletionFor([row!], {
			noun,
			label: (r) => r.name,
			protect: (r) =>
				r.usedBy.length
					? `still used by ${r.usedBy.join(", ")} — point ${r.usedBy.length === 1 ? "it" : "them"} at another template first`
					: null
		})
</script>

{#if loading}
	<div class="text-surface-600-400 flex items-center justify-center gap-2 py-16 text-sm" role="status">
		<Icons.LoaderCircle size={16} class="animate-spin" aria-hidden="true" />
		Loading template…
	</div>
{:else if id != null && !row}
	<div class="m-auto flex flex-col items-center gap-3 py-16 text-center">
		<p class="text-surface-600-400 text-sm">There is no template {id}.</p>
		<a href={basePath} class="btn btn-sm preset-tonal-surface">All {sectionLabel.toLowerCase()}</a>
	</div>
{:else}
	<AdminChangeForm
		mode={id != null ? "change" : "add"}
		title={id != null ? (name.trim() || row?.name || "Template") : "Add template"}
		purpose={readonly
			? "A built-in template: read-only. Duplicate it to make one you can change."
			: undefined}
		noun="template"
		changelistHref={basePath}
		changelistLabel={sectionLabel}
		dirty={id != null ? edits.dirty : !!(name.trim() || source.trim())}
		{saving}
		canSave={readonly ? false : id == null ? !saving && !!poolId : undefined}
		errors={formErrors}
		deletion={id != null && !readonly ? deletion : undefined}
		onDelete={id != null && !readonly ? remove : undefined}
		onSave={save}
	>
		{#snippet headerActions()}
			{#if id != null}
				<button type="button" class="btn btn-sm preset-tonal-surface" onclick={clone}>
					<Icons.Copy size={16} aria-hidden="true" /> Duplicate
				</button>
			{/if}
		{/snippet}
		{#snippet headerExtra()}
			{#if row}
				<div class="flex flex-wrap items-center gap-1.5 text-xs">
					<span class="border-surface-300-700 text-surface-600-400 rounded-full border px-2 py-0.5">
						{row.poolLabel}
					</span>
					{#if readonly}
						<span class="border-surface-300-700 text-surface-600-400 rounded-full border px-2 py-0.5">
							Built-in
						</span>
					{/if}
				</div>
			{/if}
		{/snippet}

		<AdminFieldset title="Template">
			<div class="grid gap-4 @min-[36rem]/content:grid-cols-2">
				{#if readonly}
					<AdminField id="template-admin-name" label="Name" value={name} />
				{:else}
					<AdminField
						id="template-admin-name"
						label="Name"
						help={id == null ? "Optional — a default is assigned." : undefined}
					>
						<input
							id="template-admin-name"
							class="input"
							type="text"
							bind:value={name}
							aria-describedby={describedBy("template-admin-name", false)}
						/>
					</AdminField>
				{/if}
				{#if id == null}
					<!-- The engine is half of the pool key, so choosing the pool
					     chooses the language ("Assemble · Handlebars"); a second
					     control for the same fact could disagree with it. -->
					<AdminField
						id="template-admin-pool"
						label={kind === "context" ? "Step (pool)" : "Variable"}
						required
						help="Fixed once made: storing text under another language does not translate it."
					>
						<Select
							label={kind === "context" ? "Step (pool)" : "Variable"}
							labelHidden
							options={pools.map((p) => ({ value: p.id, label: p.label }))}
							bind:value={poolId}
							describedBy={describedBy("template-admin-pool", false)}
						/>
					</AdminField>
				{:else}
					<AdminField
						id="template-admin-pool"
						label={kind === "context" ? "Step (pool)" : "Variable"}
						value={row?.poolLabel ?? poolId}
					/>
				{/if}
			</div>
		</AdminFieldset>

		<AdminFieldset title="Source">
			{#snippet aside()}
				<button type="button" class="btn btn-sm preset-tonal-surface shrink-0" onclick={runPreview}>
					<Icons.Eye size={14} aria-hidden="true" /> Preview
				</button>
			{/snippet}
			<TemplateEditor
				value={source}
				{scope}
				{engine}
				{readonly}
				rows={16}
				oninput={(v) => (source = v)}
			/>
		</AdminFieldset>

		{#if preview}
			<AdminFieldset title="Preview">
				{#if preview.error}
					<p class="text-error-600-400 text-xs">{preview.error}</p>
				{/if}
				{#if preview.issues?.length}
					<ul class="text-warning-600-400 list-inside list-disc text-xs">
						{#each preview.issues as issue, i (i)}
							<li>{issue}</li>
						{/each}
					</ul>
				{/if}
				{#if preview.rendered != null}
					<pre
						class="bg-surface-50-950 overflow-x-auto rounded-[10px] p-2 font-mono text-xs whitespace-pre-wrap">{preview.rendered}</pre>
				{/if}
				{#if preview.messages?.length}
					{#each preview.messages as m, i (i)}
						<div class="text-xs">
							<span class="font-semibold">{m.role}:</span>
							<pre
								class="bg-surface-50-950 mt-1 overflow-x-auto rounded-[10px] p-2 font-mono whitespace-pre-wrap">{m.content}</pre>
						</div>
					{/each}
				{/if}
			</AdminFieldset>
		{/if}

		{#if row}
			<AdminInline
				title="Used by"
				description="The pipelines that pick this template."
				rows={row.usedBy}
				rowKey={(n) => n}
				columns={[{ key: "name", label: "Pipeline", primary: true, text: (n) => n }]}
				emptyMessage="No pipeline picks this template yet."
			/>
		{/if}
	</AdminChangeForm>
{/if}
