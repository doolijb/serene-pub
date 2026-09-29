<script lang="ts">
	/**
	 * The change-form half of the template admin: one dedicated page per
	 * template (Django's change form), shared by context templates and
	 * variable templates. `id` absent means create mode, which additionally
	 * asks for the pool (the step or variable this template renders for).
	 *
	 * Editing reuses the library's exact write events — every mutation answers
	 * with the whole refreshed view, so this page stays honest about what the
	 * server actually stored. A built-in row is read-only here (clone it to
	 * change it), same rule as everywhere else.
	 */
	import * as Icons from "@lucide/svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { getContext, untrack } from "svelte"
	import { adminGoto as goto, adminUnsavedEdits } from "$lib/client/admin/adminRouter.svelte"
	import { UnsavedEdits } from "$lib/client/forms/unsavedEdits.svelte"
	import { ADMIN_SPLIT } from "$lib/client/components/admin/AdminSplit.svelte"
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

	/** The compact back link's words: "Back to context templates". */
	const backLabel = $derived(
		kind === "context" ? "context templates" : "variable templates"
	)

	const socket = useTypedSocket()
	const split = getContext<{ mode: "desk" | "compact" } | undefined>(
		ADMIN_SPLIT
	)

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

	/** Save is offered on any edit, and always in create mode. */
	let dirty = $derived(seeded && (id == null || edits.dirty))

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
	}) {
		if (res.library) view = res.library
		for (const w of res.warnings ?? [])
			toaster.warning({
				title: w.line ? `Line ${w.line}: ${w.message}` : w.message
			})
	}
	function handleError(res: { error?: string }) {
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
		useInterest<"pipelines:libraryUpdateTemplate">(ev, handleWrite)
		useInterest<"pipelines:libraryUpdateTemplate:error">(
			`${ev}:error`,
			handleError
		)
	}

	/** The library view, asked for and listened for in one. BARE, same reason. */
	$effect(() => requestWithInterest("pipelines:library", {}, handleLibrary))

	function save() {
		// The pool control names the TARGET; `engine` above says where the
		// language comes from in each mode.
		const split = poolId
			? splitPoolKey(poolId, CORE_TEMPLATE_ENGINE)
			: { poolId: "", engine: CORE_TEMPLATE_ENGINE }
		if (id != null) {
			socket.emit("pipelines:libraryUpdateTemplate", {
				kind,
				id,
				name,
				source,
				engine
			})
			toaster.success({ title: "Template saved" })
		} else {
			if (!poolId) return
			socket.emit("pipelines:libraryCreateTemplate", {
				kind,
				poolId: split.poolId,
				name: name || undefined,
				source: source || undefined,
				engine
			})
			toaster.success({ title: "Template created" })
			edits.forget()
			goto(basePath)
		}
	}

	function clone() {
		if (id == null) return
		socket.emit("pipelines:libraryCloneTemplate", { kind, id })
		toaster.success({ title: "Template cloned" })
		goto(basePath)
	}

	function remove() {
		if (id == null || !row) return
		if (
			!confirm(
				row.usedBy.length
					? `'${row.name}' is still used by ${row.usedBy.join(", ")}. ` +
							`The server will refuse until those point somewhere else. Try anyway?`
					: `Delete '${row.name}'? Nothing is using it.`
			)
		)
			return
		socket.emit("pipelines:libraryDeleteTemplate", { kind, id })
		edits.forget()
		goto(basePath)
	}
</script>

{#if split?.mode !== "desk"}
	<a
		href={basePath}
		class="text-surface-600-400 hover:text-surface-950-50 mb-3 inline-flex items-center gap-1 self-start text-[13px]"
	>
		<Icons.ChevronLeft size={14} /> Back to {backLabel}
	</a>
{/if}

<h2
	class="text-surface-950-50 mb-4 flex flex-wrap items-center gap-2 [font-family:var(--typo-heading--font-family)] text-base font-semibold"
>
	{id != null ? (row?.name ?? "Template") : "New template"}
	{#if readonly}
		<span
			class="preset-tonal-surface rounded-full px-2 py-0.5 font-sans text-xs font-normal"
		>
			built-in · read-only
		</span>
	{/if}
</h2>

{#if loading}
	<p class="text-surface-600-400 text-sm">Loading…</p>
{:else if id != null && !row}
	<div class="panel-card text-surface-600-400 py-8 text-center text-sm">
		This template no longer exists.
		<a class="underline" href={basePath}>Back to the list</a>
		.
	</div>
{:else}
	<div class="flex flex-col gap-4">
		<div class="panel-card flex flex-col gap-3">
			<div class="field-row">
				<label class="flex flex-col gap-1 text-sm">
					<span class="font-medium">Name</span>
					<input
						class="input"
						bind:value={name}
						{readonly}
						placeholder="Template name"
					/>
				</label>
				{#if id == null}
					<Select
						class="text-sm"
						label={kind === "context" ? "Step (pool)" : "Variable"}
						options={pools.map((p) => ({
							value: p.id,
							label: p.label
						}))}
						bind:value={poolId}
					/>
				{:else}
					<label class="flex flex-col gap-1 text-sm">
						<span class="font-medium">
							{kind === "context" ? "Step (pool)" : "Variable"}
						</span>
						<input
							class="input"
							value={row?.poolLabel ?? poolId}
							readonly
						/>
					</label>
				{/if}
				<!-- No Engine select: the engine is half of the pool key, so the
				     Pool control above already chooses it — its labels read
				     "Assemble · Handlebars". A second control for the same fact
				     could disagree with the pool, and its "default" option was
				     literally `value={null}`, the null this sprint removed.

				     That the pool control is read-only in edit mode is the
				     right behaviour rather than a limitation: a language is
				     chosen when a template is created, because storing the text
				     under a different engine does not translate it. -->
			</div>

			<label class="flex flex-col gap-1 text-sm">
				<span class="font-medium">Template</span>
				<TemplateEditor
					value={source}
					{scope}
					{engine}
					{readonly}
					rows={16}
					oninput={(v) => (source = v)}
				/>
			</label>

			{#if row?.usedBy.length}
				<p class="text-surface-600-400 text-xs">
					Used by: {row.usedBy.join(", ")}
				</p>
			{/if}

			<div class="flex flex-wrap items-center gap-2">
				{#if !readonly}
					<button
						class="btn btn-sm preset-filled-primary-500"
						disabled={!dirty || (id == null && !poolId)}
						onclick={save}
					>
						<Icons.Save size={14} />
						{id != null ? "Save" : "Create"}
					</button>
				{/if}
				<button
					class="btn btn-sm preset-tonal-surface"
					onclick={runPreview}
				>
					<Icons.Eye size={14} /> Preview
				</button>
				<div class="flex-1"></div>
				{#if id != null}
					<button
						class="btn btn-sm preset-tonal-surface"
						onclick={clone}
					>
						<Icons.Copy size={14} /> Clone
					</button>
					{#if !readonly}
						<button
							class="btn btn-sm preset-tonal-error"
							onclick={remove}
						>
							<Icons.Trash2 size={14} /> Delete
						</button>
					{/if}
				{/if}
			</div>
		</div>

		{#if preview}
			<div class="panel-card flex flex-col gap-2 text-sm">
				<h3 class="text-sm font-semibold">Preview</h3>
				{#if preview.error}
					<p class="text-error-500 text-xs">{preview.error}</p>
				{/if}
				{#if preview.issues?.length}
					<ul class="text-warning-500 list-inside list-disc text-xs">
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
			</div>
		{/if}
	</div>
{/if}

<style>
	.field-row {
		display: grid;
		gap: 1rem;
		grid-template-columns: 1fr;
	}
	@container content (min-width: 700px) {
		.field-row {
			grid-template-columns: 2fr 2fr 1fr;
		}
	}
</style>
