<script lang="ts">
	/**
	 * The pipeline library — the admin workspace.
	 *
	 * The config panel answers "what is this pipeline set to". This answers the
	 * other question, which the panel structurally cannot: *what exists, and
	 * what is using it.* A panel is per-pipeline and narrows to one option; a
	 * library is per-entity and has to show the rows nobody has selected
	 * anywhere, because those are exactly the ones that need tidying up.
	 *
	 * ## Why `usedBy` is on every row
	 *
	 * Everything listed here is shared on purpose — which makes "may I delete
	 * this" genuinely unanswerable from inside one pipeline's settings, since
	 * the thing holding a row is routinely somewhere the person looking is not.
	 * The server already refuses a delete that would strand a selection; this
	 * says *what* is holding it before they try, which is the difference
	 * between a rule and a dead end.
	 *
	 * ## Grouped by pool, not by pipeline — prompts included, now
	 *
	 * Templates group by the step that renders them and layouts by the variable
	 * they render, because that is what "these are interchangeable" means. A
	 * pipeline heading would suggest ownership the model does not have.
	 *
	 * **Prompts used to be the exception** and were grouped by pipeline. They
	 * are pooled by `(step, slot)` now and follow their step into every
	 * pipeline reusing it, so a pipeline heading over them was asserting
	 * exactly the ownership the paragraph above rejects. They group like
	 * everything else here.
	 *
	 * ## A pool names its language
	 *
	 * A template pool is `(what it renders, which language)`. Grouping on the
	 * node or variable alone would put a Jinja row and a Handlebars row under
	 * one heading, interleaved, with no way to tell which was which but reading
	 * the markup — and the "New" button under that heading would have no way to
	 * know which language it was creating in. So the grouping key carries the
	 * engine, and `createIn` splits it back apart.
	 *
	 * Admin-only, checked here and again in every handler. The check here is for
	 * the person; the check in the handler is the one that matters.
	 */
	import { getContext, onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import EmptyState from "$lib/client/components/EmptyState.svelte"
	import TemplateEditor from "$lib/client/components/templates/TemplateEditor.svelte"
	import { getVariable } from "@serene-pub/sdk"
	import { contextTemplateScope } from "$lib/shared/utils/contextConfigCards"
	import {
		CORE_TEMPLATE_ENGINE,
		splitPoolKey
	} from "$lib/shared/pipelines/poolKey"
	import { toaster } from "$lib/client/utils/toaster"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()

	type Tab = "pipelines" | "prompts" | "templates" | "layouts"
	const TABS: Array<{ key: Tab; label: string; icon: any }> = [
		{ key: "pipelines", label: "Pipelines", icon: Icons.Workflow },
		{ key: "prompts", label: "Prompts", icon: Icons.MessageSquareText },
		{
			key: "templates",
			label: "Context templates",
			icon: Icons.LayoutTemplate
		},
		{ key: "layouts", label: "Variable layouts", icon: Icons.Braces }
	]
	let tab = $state<Tab>("pipelines")

	let view = $state<Sockets.Pipelines.Library.Response>({})
	let loading = $state(true)

	/**
	 * Which row's editor is open, as `kind:id`.
	 *
	 * One at a time. These are large bodies of text — a context template is the
	 * biggest authored thing in the product — and a page of them all expanded is
	 * a page nobody can find anything on.
	 */
	let openRow = $state<string | null>(null)
	/**
	 * Unsaved edits, keyed the same way, so switching rows cannot cross them.
	 *
	 * `engine` is a concrete id, never null. It used to be `string | null`
	 * with null meaning "core's default", which made the dirty check wrong in a
	 * way nobody would look for: a freshly-opened Handlebars row seeded a null
	 * draft and compared it against a row whose engine now reads back as the
	 * concrete core id, so the row was "dirty" the instant it was expanded and
	 * the save bar appeared over an untouched template.
	 */
	let drafts = $state<
		Record<string, { name: string; source: string; engine: string }>
	>({})

	const rowKey = (kind: string, id: number) => `${kind}:${id}`

	type EditableRow = {
		id: number
		name: string
		source: string
		engine?: string | null
	}

	function toggle(kind: string, row: EditableRow) {
		const key = rowKey(kind, row.id)
		if (openRow === key) {
			openRow = null
			return
		}
		openRow = key
		if (!drafts[key]) drafts[key] = seedDraft(row)
	}

	const seedDraft = (row: EditableRow) => ({
		name: row.name,
		source: row.source,
		engine: row.engine ?? CORE_ENGINE
	})

	const draftFor = (kind: string, row: EditableRow) =>
		drafts[rowKey(kind, row.id)] ?? seedDraft(row)

	function edit(
		kind: string,
		id: number,
		patch: { name?: string; source?: string; engine?: string }
	) {
		const key = rowKey(kind, id)
		const d = drafts[key] ?? { name: "", source: "", engine: CORE_ENGINE }
		drafts[key] = { ...d, ...patch }
	}

	const dirty = (kind: string, row: EditableRow) => {
		const d = drafts[rowKey(kind, row.id)]
		return (
			!!d &&
			(d.name !== row.name ||
				d.source !== row.source ||
				d.engine !== (row.engine ?? CORE_ENGINE))
		)
	}

	/* --- template engines --------------------------------------------- */

	/**
	 * Core's engine, named rather than inferred from an absence.
	 *
	 * The row's column is NOT NULL now, so "unset means core's" is no longer a
	 * thing the data can say — and it never should have been the thing the
	 * *editor* said either: a template keeps whatever language it was written
	 * in, which is the argument the column's own note has always made.
	 */
	const CORE_ENGINE = CORE_TEMPLATE_ENGINE
	const engines = $derived(view?.engines ?? [])

	/**
	 * A pool key's two halves, split back apart.
	 *
	 * The grouping key is `<node type or variable>#<engine>` — see the header.
	 * `#` is safe as the separator because neither half contains one and both
	 * contain colons. A key with no `#` is a row whose pool nothing declares
	 * any more (a disabled plugin's), and it falls back to core's engine so it
	 * still gets a heading rather than vanishing off a page whose whole job is
	 * to show what exists.
	 */
	const splitPool = (poolKey: string) =>
		splitPoolKey(poolKey, CORE_ENGINE)

	/* --- template + layout writes ------------------------------------ */

	const templateKind = (t: Tab) =>
		t === "templates" ? "context" : "variable"

	function saveTemplate(t: Tab, row: { id: number }) {
		const key = rowKey(templateKind(t), row.id)
		const d = drafts[key]
		if (!d) return
		socket.emit("pipelines:libraryUpdateTemplate", {
			kind: templateKind(t) as any,
			id: row.id,
			name: d.name,
			source: d.source,
			engine: d.engine
		})
		delete drafts[key]
	}

	function cloneTemplate(t: Tab, row: { id: number }) {
		socket.emit("pipelines:libraryCloneTemplate", {
			kind: templateKind(t) as any,
			id: row.id
		})
	}

	function deleteTemplate(
		t: Tab,
		row: { id: number; name: string; usedBy: string[] }
	) {
		if (
			!confirm(
				row.usedBy.length
					? `'${row.name}' is still used by ${row.usedBy.join(", ")}. ` +
							`The server will refuse until those point somewhere else. Try anyway?`
					: `Delete '${row.name}'? Nothing is using it.`
			)
		)
			return
		socket.emit("pipelines:libraryDeleteTemplate", {
			kind: templateKind(t) as any,
			id: row.id
		})
	}

	/**
	 * A new row in this pool — in this pool's *language*.
	 *
	 * The heading's key carries both halves; the create names them separately,
	 * because the server stores them in separate columns. Without the engine
	 * the row would land in core's pool whatever heading the button sat under,
	 * which is a "New" button that creates something into a list you are not
	 * looking at.
	 */
	function createIn(t: Tab, poolKey: string) {
		const { poolId, engine } = splitPool(poolKey)
		socket.emit("pipelines:libraryCreateTemplate", {
			kind: templateKind(t) as any,
			poolId,
			engine
		})
	}

	/**
	 * What a row's template may reference.
	 *
	 * A context template sees the whole vocabulary; a variable layout sees only
	 * what its own variable declares — one name, usually. Offering the layout
	 * editor the context vocabulary would autocomplete `scenario` into a
	 * characters layout, where it renders nothing.
	 *
	 * A plugin's variable is registered on the server and not in this bundle,
	 * so `getVariable` comes back empty and the editor simply offers no
	 * assistance rather than the wrong assistance.
	 */
	function scopeFor(t: Tab, poolKey: string) {
		if (t === "templates") return contextTemplateScope()
		// The bare variable id — the registry knows nothing about pools.
		return getVariable(splitPool(poolKey).poolId)?.scope
	}

	/* --- prompt writes ------------------------------------------------ */

	/**
	 * The last preview, per row.
	 *
	 * Explicit rather than live-on-keystroke: rendering is a round trip, and a
	 * preview that redraws mid-word is noise. The button is also the honest
	 * affordance — it says "this is what it would produce", which is a question
	 * you ask at a moment, not continuously.
	 */
	let previews = $state<
		Record<
			string,
			{
				messages?: Array<{ role: string; content: string }>
				rendered?: string
				issues?: string[]
				error?: string
			}
		>
	>({})
	let previewFor: string | null = null

	function preview(
		t: Tab,
		poolKey: string,
		row: { id: number; source: string }
	) {
		const key = rowKey(templateKind(t), row.id)
		previewFor = key
		const d = draftFor(templateKind(t), row as any)
		socket.emit("pipelines:previewTemplate", {
			kind: t === "templates" ? "context" : "variable",
			source: d.source,
			// The DRAFT's engine, not the pool's — someone changing the engine
			// picker wants to see what that change does, and previewing in the
			// pool's language would show them the one thing they did not ask
			// about. Concrete rather than nullable: an optional engine here
			// previewed in core's language whatever the draft said, so the
			// template rendered on this screen and shipped raw markup for real.
			engine: d.engine,
			poolId: splitPool(poolKey).poolId
		})
	}

	const onPreview = (res: Sockets.Pipelines.PreviewTemplate.Response) => {
		const key = previewFor
		previewFor = null
		if (key) previews[key] = res
	}

	/** Prompt drafts hold named fields rather than one source. */
	let promptDrafts = $state<
		Record<number, { name: string; fields: Record<string, string> }>
	>({})

	function togglePrompt(row: Sockets.Pipelines.Library.LibraryPrompt) {
		const key = rowKey("prompt", row.id)
		if (openRow === key) {
			openRow = null
			return
		}
		openRow = key
		if (!promptDrafts[row.id])
			promptDrafts[row.id] = {
				name: row.name,
				fields: { ...row.fields }
			}
	}

	const promptDirty = (row: Sockets.Pipelines.Library.LibraryPrompt) => {
		const d = promptDrafts[row.id]
		if (!d) return false
		if (d.name !== row.name) return true
		return Object.keys({ ...row.fields, ...d.fields }).some(
			(k) => (d.fields[k] ?? "") !== (row.fields[k] ?? "")
		)
	}

	function savePrompt(row: Sockets.Pipelines.Library.LibraryPrompt) {
		const d = promptDrafts[row.id]
		if (!d) return
		socket.emit("pipelines:libraryUpdatePrompt", {
			id: row.id,
			name: d.name,
			fields: d.fields
		})
		delete promptDrafts[row.id]
	}

	function deletePrompt(row: Sockets.Pipelines.Library.LibraryPrompt) {
		if (
			!confirm(
				row.usedBy.length
					? `'${row.name}' is still used by ${row.usedBy.join(", ")}. ` +
							`The server will refuse until those point somewhere else. Try anyway?`
					: `Delete '${row.name}'? Nothing is using it.`
			)
		)
			return
		socket.emit("pipelines:libraryDeletePrompt", { id: row.id })
	}

	/* --- grouping ----------------------------------------------------- */

	/**
	 * Rows by pool, seeded from the *declared* pools rather than from the rows.
	 *
	 * A pool with nothing in it is exactly the one that needs a New button, and
	 * grouping the rows alone would leave it off the page entirely. Core ships a
	 * context template for the assemble step and none for the other nodes that
	 * declare a template slot, so an empty pool is the common case.
	 *
	 * A row whose pool nobody declares still shows — a layout left behind by a
	 * disabled plugin is a thing an admin needs to see in order to delete.
	 */
	function byPool(
		rows: Sockets.Pipelines.Library.LibraryTemplate[],
		pools: Sockets.Pipelines.Library.LibraryPool[]
	) {
		const out = new Map<
			string,
			{ label: string; rows: Sockets.Pipelines.Library.LibraryTemplate[] }
		>()
		for (const p of pools) out.set(p.id, { label: p.label, rows: [] })
		for (const r of rows) {
			// A row's `poolId` is the first half only; its `engine` is the
			// second. Recombined here rather than sent pre-joined so the field
			// keeps meaning what the server's contract says it means.
			const key = `${r.poolId}#${r.engine}`
			const g = out.get(key) ?? { label: r.poolLabel, rows: [] }
			g.rows.push(r)
			out.set(key, g)
		}
		return [...out.entries()].sort((a, b) =>
			a[1].label.localeCompare(b[1].label)
		)
	}

	/**
	 * Prompts by pool, seeded from the declared pools — the same shape, and the
	 * same reason, as `byPool` above.
	 *
	 * This was `promptsBySpec`, grouping on `specSlug`. That column is gone,
	 * and so is the claim it encoded: a prompt belongs to a step, not to a
	 * pipeline. Seeding from `promptPools` also gives an empty pool its own
	 * heading, which is the case core does not have and a plugin's node —
	 * shipping a prompts slot and no prose — always does.
	 */
	function promptsByPool(
		rows: Sockets.Pipelines.Library.LibraryPrompt[],
		pools: Sockets.Pipelines.Library.LibraryPool[]
	) {
		const out = new Map<
			string,
			{ label: string; rows: Sockets.Pipelines.Library.LibraryPrompt[] }
		>()
		for (const p of pools) out.set(p.id, { label: p.label, rows: [] })
		for (const r of rows) {
			const g = out.get(r.poolId) ?? { label: r.poolLabel, rows: [] }
			g.rows.push(r)
			out.set(r.poolId, g)
		}
		return [...out.entries()].sort((a, b) =>
			a[1].label.localeCompare(b[1].label)
		)
	}

	/**
	 * Copy archived text, rather than restore it.
	 *
	 * The step no longer declares the field, so putting the text back would put
	 * it where nothing reads it — and the next boot's sweep would move it out
	 * again. Copying hands it to the person, who knows where it belongs now.
	 */
	async function copyArchived(text: string) {
		try {
			await navigator.clipboard.writeText(text)
			toaster.success({ title: "Copied to the clipboard" })
		} catch {
			toaster.error({
				title: "Could not reach the clipboard. Select the text and copy it."
			})
		}
	}

	/* --- wiring ------------------------------------------------------- */

	const onView = (res: Sockets.Pipelines.Library.Response) => {
		if (res.error) return
		view = res
		loading = false
	}
	const onWrite = (res: {
		library?: Sockets.Pipelines.Library.Response
		error?: string
	}) => {
		if (res.error || !res.library) return
		view = res.library
	}
	// The server's refusals are written for a person — "'Grim tone' is still
	// selected somewhere" — so they are shown rather than replaced by a status.
	const onRefusal = (res: { error?: string }) => {
		if (res.error) toaster.error({ title: res.error })
	}

	const WRITES = [
		"libraryCreateTemplate",
		"libraryCloneTemplate",
		"libraryUpdateTemplate",
		"libraryDeleteTemplate",
		"libraryClonePrompt",
		"libraryUpdatePrompt",
		"libraryDeletePrompt"
	] as const

	onMount(() => {
		if (!userCtx.user?.isAdmin) {
			goto("/")
			return
		}
		socket.on("pipelines:library", onView)
		socket.on("pipelines:previewTemplate", onPreview)
		socket.on("pipelines:previewTemplate:error", onRefusal)
		socket.on("pipelines:library:error", onRefusal)
		for (const w of WRITES) {
			socket.on(`pipelines:${w}` as any, onWrite as any)
			socket.on(`pipelines:${w}:error` as any, onRefusal as any)
		}
		socket.emit("pipelines:library", {})
	})

	onDestroy(() => {
		socket.off("pipelines:library", onView)
		socket.off("pipelines:previewTemplate", onPreview)
		socket.off("pipelines:previewTemplate:error", onRefusal)
		socket.off("pipelines:library:error", onRefusal)
		for (const w of WRITES) {
			socket.off(`pipelines:${w}` as any, onWrite as any)
			socket.off(`pipelines:${w}:error` as any, onRefusal as any)
		}
	})

	const templates = $derived(view.contextTemplates ?? [])
	const layouts = $derived(view.variableTemplates ?? [])
</script>

<div class="flex flex-col gap-6 p-4">
	<header class="flex items-center gap-3">
		<Icons.Library size={24} />
		<div class="min-w-0 flex-1">
			<h1 class="text-2xl font-semibold">Pipeline library</h1>
			<p class="text-muted text-sm">
				Everything the pipelines are built from, and what is using it.
			</p>
		</div>
		<a class="btn btn-sm preset-tonal-surface" href="/admin/pipelines">
			<Icons.ArrowLeft size={16} /> Pipelines
		</a>
	</header>

	<nav class="border-surface-200-700 flex flex-wrap gap-1 border-b pb-1">
		{#each TABS as t (t.key)}
			{@const Icon = t.icon}
			<button
				type="button"
				class="btn btn-sm {tab === t.key
					? 'preset-filled-primary-500'
					: 'preset-tonal-surface'}"
				onclick={() => (tab = t.key)}
			>
				<Icon size={15} />
				{t.label}
			</button>
		{/each}
	</nav>

	{#if loading}
		<p class="text-muted text-sm">Loading…</p>
	{:else if tab === "pipelines"}
		<section class="flex flex-col gap-2">
			{#if !view.pipelines?.length}
				<EmptyState
					icon={Icons.Workflow}
					message="Nothing is published. Core publishes its own pipelines at startup, so an empty list usually means the type registry refused to sync — check the server log for a bootstrap warning."
				/>
			{:else}
				{#each view.pipelines as p (p.slug)}
					<a
						class="card bg-surface-100-800 hover:preset-tonal-primary flex items-center gap-3 p-3"
						href="/admin/pipelines/{p.slug}"
					>
						<Icons.Workflow size={18} class="shrink-0" />
						<div class="min-w-0 flex-1">
							<p class="truncate font-medium">{p.name}</p>
							<p class="text-muted truncate font-mono text-xs">
								{p.slug}
							</p>
						</div>
						<div class="text-muted shrink-0 text-right text-xs">
							<p>{p.version ?? "unpublished"}</p>
							<p>{p.nodeCount} steps</p>
						</div>
						<Icons.ChevronRight size={16} class="shrink-0" />
					</a>
				{/each}
				<p class="text-muted mt-2 text-xs">
					<Icons.Info size={12} class="inline" />
					Adding, cloning and rewiring a pipeline is structural editing
					— the lens view, which is not built yet. Each pipeline's page
					says what is actually published.
				</p>
			{/if}
		</section>
	{:else if tab === "prompts"}
		{@const promptPools = view.promptPools ?? []}
		<section class="flex flex-col gap-4">
			{#if !view.prompts?.length && !promptPools.length}
				<EmptyState
					icon={Icons.MessageSquareText}
					message="Nothing declares a prompts slot. Core publishes its own pipelines at startup, so an empty page usually means the type registry refused to sync."
				/>
			{/if}
			{#each promptsByPool(view.prompts ?? [], promptPools) as [poolId, group] (poolId)}
				<div class="flex flex-col gap-2">
					<h2 class="text-sm font-semibold">{group.label}</h2>
					{#if !group.rows.length}
						<!-- A declared pool with nothing in it. Core has none;
						     a plugin node that ships no prose of its own always
						     does, and grouping the rows alone would leave it
						     off the page entirely. -->
						<p class="text-muted text-xs">
							Nothing written for this step yet. It runs on
							whatever the pipeline's configuration selects.
						</p>
					{/if}
					{#each group.rows as row (row.id)}
						{@const key = rowKey("prompt", row.id)}
						<div class="card bg-surface-100-800 p-3">
							<div class="flex items-center gap-2">
								<button
									type="button"
									class="flex min-w-0 flex-1 items-center gap-2 text-left"
									onclick={() => togglePrompt(row)}
								>
									<Icons.ChevronRight
										size={14}
										class="shrink-0 transition-transform {openRow ===
										key
											? 'rotate-90'
											: ''}"
									/>
									<span class="truncate font-medium">
										{row.name}
									</span>
									{#if row.isImmutable}
										<Icons.Lock
											size={12}
											class="shrink-0"
										/>
									{/if}
									{#if row.origin}
										<!-- Where it was written, which is not
										     where it belongs: a prompt follows
										     its step into every pipeline that
										     reuses it. -->
										<span
											class="text-muted shrink-0 text-xs"
										>
											from {row.origin}
										</span>
									{/if}
									{#if Object.keys(row.archived ?? {}).length}
										<span
											class="preset-tonal-warning shrink-0 rounded-full px-2 py-0.5 text-[0.68rem]"
											title={`Archived: ${Object.keys(row.archived).join(", ")}`}
										>
											{Object.keys(row.archived).length} archived
										</span>
									{/if}
								</button>
								<button
									type="button"
									class="btn btn-sm preset-tonal-surface shrink-0"
									title="Duplicate"
									onclick={() =>
										socket.emit(
											"pipelines:libraryClonePrompt",
											{ id: row.id }
										)}
								>
									<Icons.Copy size={14} />
								</button>
								{#if !row.isImmutable}
									<button
										type="button"
										class="btn btn-sm preset-tonal-surface shrink-0"
										title="Delete"
										onclick={() => deletePrompt(row)}
									>
										<Icons.Trash2 size={14} />
									</button>
								{/if}
							</div>
							{@render usage(row.usedBy)}

							{#if openRow === key}
								{@const d = promptDrafts[row.id]}
								<div class="mt-3 space-y-3">
									{#if row.isImmutable}
										<p class="text-muted text-xs">
											<Icons.Lock
												size={11}
												class="inline"
											/>
											One of the prompts Serene Pub ships.
											Duplicate it to make it yours.
										</p>
									{:else}
										<label
											class="flex flex-col gap-1 text-xs font-medium"
										>
											Name
											<input
												type="text"
												class="input w-full"
												value={d?.name ?? row.name}
												oninput={(e) =>
													(promptDrafts[row.id] = {
														name: e.currentTarget
															.value,
														fields: d?.fields ?? {
															...row.fields
														}
													})}
											/>
										</label>
									{/if}
									{#each Object.keys(row.fields) as field (field)}
										<label
											class="flex flex-col gap-1 text-xs font-medium"
										>
											{field}
											<textarea
												class="textarea w-full font-mono text-xs"
												rows={row.isImmutable ? 3 : 6}
												readonly={row.isImmutable}
												spellcheck="false"
												value={d?.fields?.[field] ??
													row.fields[field] ??
													""}
												oninput={(e) =>
													(promptDrafts[row.id] = {
														name:
															d?.name ?? row.name,
														fields: {
															...(d?.fields ?? {
																...row.fields
															}),
															[field]:
																e.currentTarget
																	.value
														}
													})}
											></textarea>
										</label>
									{/each}
									{#if Object.keys(row.archived ?? {}).length}
										<!-- Read-only, and apart from the boxes
										     above. `fields` and `archived` are
										     two columns; rendered as one list
										     the archived text would be saved
										     back into `fields`, and the next
										     boot's sweep would move it out
										     again — a row ping-ponging between
										     two shapes forever. -->
										<div
											class="border-surface-500/30 space-y-2 border-t pt-3"
										>
											<p class="text-muted text-xs">
												<Icons.Archive
													size={11}
													class="inline"
												/>
												Archived — this step no longer has
												{Object.keys(row.archived)
													.length === 1
													? "this field"
													: "these fields"}. Kept so
												the wording can be copied
												somewhere it is still used.
											</p>
											{#each Object.entries(row.archived) as [field, text] (field)}
												<div
													class="flex flex-col gap-1"
												>
													<div
														class="flex items-center gap-2"
													>
														<span
															class="flex-1 text-xs font-medium"
														>
															{field}
														</span>
														<button
															type="button"
															class="btn btn-sm preset-tonal-surface shrink-0"
															onclick={() =>
																copyArchived(
																	text
																)}
														>
															<Icons.Copy
																size={13}
															/> Copy
														</button>
													</div>
													<textarea
														class="textarea w-full font-mono text-xs opacity-70"
														rows="3"
														readonly
														spellcheck="false"
														value={text}
													></textarea>
												</div>
											{/each}
										</div>
									{/if}

									{#if promptDirty(row)}
										{@render saveBar(
											() => {
												delete promptDrafts[row.id]
											},
											() => savePrompt(row)
										)}
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/each}
		</section>
	{:else}
		{@const rows = tab === "templates" ? templates : layouts}
		{@const pools =
			(tab === "templates" ? view.contextPools : view.variablePools) ??
			[]}
		{@const kind = templateKind(tab)}
		<section class="flex flex-col gap-4">
			{#if !rows.length && !pools.length}
				<EmptyState
					icon={Icons.LayoutTemplate}
					message="Nothing declares one of these. Core publishes its own pipelines at startup, so an empty page usually means the type registry refused to sync."
				/>
			{/if}
			{#each byPool(rows, pools) as [poolId, group] (poolId)}
				<div class="flex flex-col gap-2">
					<div class="flex items-center gap-2">
						<h2 class="flex-1 text-sm font-semibold">
							{group.label}
						</h2>
						<button
							type="button"
							class="btn btn-sm preset-tonal-surface"
							title="Write a new one for {group.label}"
							onclick={() => createIn(tab, poolId)}
						>
							<Icons.Plus size={14} /> New
						</button>
					</div>
					{#if !group.rows.length}
						<p class="text-muted text-xs">
							Nothing written for this step yet. It renders its
							built-in default until something is.
						</p>
					{/if}
					{#each group.rows as row (row.id)}
						{@const key = rowKey(kind, row.id)}
						{@const d = draftFor(kind, row)}
						<div class="card bg-surface-100-800 p-3">
							<div class="flex items-center gap-2">
								<button
									type="button"
									class="flex min-w-0 flex-1 items-center gap-2 text-left"
									onclick={() => toggle(kind, row)}
								>
									<Icons.ChevronRight
										size={14}
										class="shrink-0 transition-transform {openRow ===
										key
											? 'rotate-90'
											: ''}"
									/>
									<span class="truncate font-medium">
										{row.name}
									</span>
									{#if row.isImmutable}
										<Icons.Lock
											size={12}
											class="shrink-0"
										/>
									{/if}
									{#if row.origin}
										<span
											class="text-muted shrink-0 text-xs"
										>
											from {row.origin}
										</span>
									{/if}
								</button>
								<button
									type="button"
									class="btn btn-sm preset-tonal-surface shrink-0"
									title="Duplicate"
									onclick={() => cloneTemplate(tab, row)}
								>
									<Icons.Copy size={14} />
								</button>
								{#if !row.isImmutable}
									<button
										type="button"
										class="btn btn-sm preset-tonal-surface shrink-0"
										title="Delete"
										onclick={() => deleteTemplate(tab, row)}
									>
										<Icons.Trash2 size={14} />
									</button>
								{/if}
							</div>
							{@render usage(row.usedBy)}

							{#if openRow === key}
								<div class="mt-3 space-y-3">
									{#if row.isImmutable}
										<p class="text-muted text-xs">
											<Icons.Lock
												size={11}
												class="inline"
											/>
											One of the ones Serene Pub ships. Duplicate
											it to make it yours.
										</p>
									{:else}
										<label
											class="flex flex-col gap-1 text-xs font-medium"
										>
											Name
											<input
												type="text"
												class="input w-full"
												value={d.name}
												oninput={(e) =>
													edit(kind, row.id, {
														name: e.currentTarget
															.value
													})}
											/>
										</label>
									{/if}
									<label
										class="flex flex-col gap-1 text-xs font-medium"
									>
										{tab === "templates"
											? "Template"
											: "Layout"}
										<TemplateEditor
											rows={row.isImmutable
												? 6
												: tab === "templates"
													? 18
													: 8}
											readonly={row.isImmutable}
											value={d.source}
											scope={scopeFor(tab, poolId)}
											oninput={(source) =>
												edit(kind, row.id, { source })}
										/>
									</label>
									{#if engines.length > 1 && !row.isImmutable}
										<!-- Only when there is a choice to
										     make: with core's engine alone, a
										     picker with one option is chrome.

										     The chosen id is saved as itself.
										     It used to map core's id back to
										     NULL — "stay on whatever core
										     ships" — which the column can no
										     longer express and which was the
										     wrong intent anyway: a template
										     keeps the language it was written
										     in, so core's default moving must
										     not silently rewrite it.

										     ⚠ Changing this MOVES the row into
										     another pool. It leaves this
										     heading and appears under that
										     language's, which is why the note
										     below says so. -->
										<label
											class="flex flex-col gap-1 text-xs font-medium"
										>
											Engine
											<select
												class="select w-full"
												value={d.engine}
												onchange={(e) =>
													edit(kind, row.id, {
														engine: e.currentTarget
															.value
													})}
											>
												{#each engines as eng (eng.id)}
													<option value={eng.id}>
														{eng.id}
														{eng.owner === "core"
															? "(built in)"
															: `(${eng.owner})`}
													</option>
												{/each}
											</select>
											{#if d.engine !== (row.engine ?? CORE_ENGINE)}
												<span
													class="text-muted text-xs"
												>
													<Icons.Info
														size={11}
														class="inline"
													/>
													Saving moves this out of
													<strong>
														{group.label}
													</strong>
													and in under the new language's
													heading. The text is not translated.
												</span>
											{/if}
										</label>
									{/if}
									<div class="flex items-center gap-2">
										<button
											type="button"
											class="btn btn-sm preset-tonal-surface"
											onclick={() =>
												preview(tab, poolId, row)}
										>
											<Icons.Eye size={14} /> Preview
										</button>
										{#if previews[key]}
											<button
												type="button"
												class="btn btn-sm preset-tonal-surface"
												onclick={() => {
													delete previews[key]
												}}
											>
												Hide
											</button>
										{/if}
										<p class="text-muted text-xs">
											Rendered against sample data, not
											your sessions.
										</p>
									</div>

									{#if previews[key]}
										{@const shown = previews[key]}
										{#if shown.error}
											<p
												class="preset-tonal-error rounded p-2 text-xs"
											>
												{shown.error}
											</p>
										{/if}
										{#if shown.issues?.length}
											<!-- A draft can render *and* be
											     wrong: a name nothing supplies
											     produces an empty string, not
											     an error. -->
											<ul
												class="preset-tonal-warning flex flex-col gap-1 rounded p-2 text-xs"
											>
												{#each shown.issues as issue (issue)}
													<li>{issue}</li>
												{/each}
											</ul>
										{/if}
										{#if shown.rendered !== undefined}
											<pre
												class="bg-surface-200-700 max-h-64 overflow-auto rounded p-2 font-mono text-xs whitespace-pre-wrap">{shown.rendered ||
													"(renders nothing)"}</pre>
										{/if}
										{#if shown.messages?.length}
											<div class="flex flex-col gap-1">
												{#each shown.messages as m, i (i)}
													<div
														class="bg-surface-200-700 rounded p-2"
													>
														<p
															class="text-muted mb-1 text-xs font-semibold uppercase"
														>
															{m.role}
														</p>
														<pre
															class="max-h-48 overflow-auto font-mono text-xs whitespace-pre-wrap">{m.content}</pre>
													</div>
												{/each}
											</div>
										{/if}
									{/if}

									{#if dirty(kind, row)}
										{@render saveBar(
											() => {
												delete drafts[key]
											},
											() => saveTemplate(tab, row)
										)}
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/each}
		</section>
	{/if}
</div>

{#snippet usage(usedBy: string[])}
	<!-- The answer to the question a delete button raises, before it is asked.
	     "Nothing" is worth saying out loud: it is the only state in which a
	     delete is certain to succeed, and silence would read as unknown. -->
	<p class="text-muted mt-1 pl-6 text-xs">
		{#if usedBy.length}
			<Icons.Link2 size={11} class="inline" />
			Used by {usedBy.join(", ")}
		{:else}
			<Icons.Unlink size={11} class="inline" />
			Not used by any pipeline
		{/if}
	</p>
{/snippet}

{#snippet saveBar(cancel: () => void, save: () => void)}
	<div class="flex items-center justify-end gap-2">
		<span class="text-muted mr-auto text-xs">Unsaved changes</span>
		<button
			type="button"
			class="btn btn-sm preset-tonal-surface"
			onclick={cancel}
		>
			Cancel
		</button>
		<button
			type="button"
			class="btn btn-sm preset-filled-primary-500"
			onclick={save}
		>
			<Icons.Save size={14} /> Save
		</button>
	</div>
{/snippet}
