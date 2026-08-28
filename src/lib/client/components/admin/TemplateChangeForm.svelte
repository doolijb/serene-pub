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
	import { onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import TemplateEditor from "$lib/client/components/templates/TemplateEditor.svelte"
	import { getVariable } from "@serene-pub/sdk"
	import { contextTemplateScope } from "$lib/shared/utils/contextConfigCards"
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

	const socket = useTypedSocket()

	let view = $state<Sockets.Pipelines.Library.Response>({})
	let loading = $state(true)
	/** Draft fields; seeded from the row once (or blank in create mode). */
	let name = $state("")
	let source = $state("")
	let engine = $state<string | null>(null)
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
			: (view.variablePools ?? [])) as Array<{ id: string; label: string }>
	)
	let engines = $derived(view.engines ?? [])
	let readonly = $derived(!!row?.isImmutable)

	// Seed drafts exactly once, when the row first arrives.
	$effect(() => {
		if (seeded || loading) return
		if (id != null) {
			if (!row) return
			name = row.name
			source = row.source
			engine = row.engine
			poolId = row.poolId
			seeded = true
		} else {
			poolId = pools[0]?.id ?? ""
			seeded = true
		}
	})

	let dirty = $derived(
		seeded &&
			(id == null ||
				(row &&
					(name !== row.name ||
						source !== row.source ||
						(engine ?? null) !== (row.engine ?? null))))
	)

	/**
	 * What this template may reference: a context template sees the whole
	 * vocabulary; a variable layout sees only what its variable declares. A
	 * plugin's variable isn't in this bundle, so the editor simply offers no
	 * assistance rather than the wrong assistance.
	 */
	let scope = $derived(
		kind === "context" ? contextTemplateScope() : getVariable(poolId)?.scope
	)

	function handleLibrary(res: Sockets.Pipelines.Library.Response) {
		view = res
		loading = false
	}
	/** Every write answers with the refreshed view. */
	function handleWrite(res: Sockets.Pipelines.Library.Response) {
		view = res
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
		socket.emit("pipelines:previewTemplate", {
			kind,
			source,
			engine,
			poolId
		})
	}

	const WRITE_EVENTS = [
		"pipelines:libraryCreateTemplate",
		"pipelines:libraryUpdateTemplate",
		"pipelines:libraryCloneTemplate",
		"pipelines:libraryDeleteTemplate"
	] as const

	onMount(() => {
		socket.on("pipelines:library", handleLibrary)
		socket.on("pipelines:previewTemplate", handlePreview)
		for (const ev of WRITE_EVENTS) {
			socket.on(ev as any, handleWrite)
			socket.on(`${ev}:error` as any, handleError)
		}
		socket.emit("pipelines:library", {})
	})
	onDestroy(() => {
		socket.off("pipelines:library", handleLibrary)
		socket.off("pipelines:previewTemplate", handlePreview)
		for (const ev of WRITE_EVENTS) {
			socket.off(ev as any, handleWrite)
			socket.off(`${ev}:error` as any, handleError)
		}
	})

	function save() {
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
				poolId,
				name: name || undefined,
				source: source || undefined,
				engine
			})
			toaster.success({ title: "Template created" })
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
		goto(basePath)
	}
</script>

<div class="mb-4 flex flex-wrap items-center gap-3">
	<div class="min-w-0 flex-1">
		<p class="text-surface-600-400 text-xs">
			<a href={basePath} class="hover:underline">
				{kind === "context" ? "Context templates" : "Variable templates"}
			</a>
			/
			<strong>{id != null ? (row?.name ?? "…") : "New"}</strong>
		</p>
		<h2 class="flex items-center gap-2 text-lg font-semibold">
			{#if kind === "context"}
				<Icons.LayoutTemplate size={20} />
			{:else}
				<Icons.Braces size={20} />
			{/if}
			{id != null ? (row?.name ?? "Template") : "New template"}
			{#if readonly}
				<span
					class="preset-tonal-surface rounded-full px-2 py-0.5 text-xs font-normal"
					>built-in · read-only</span
				>
			{/if}
		</h2>
	</div>
	<a class="btn btn-sm preset-tonal-surface" href={basePath}>
		<Icons.ArrowLeft size={16} /> Back to list
	</a>
</div>

{#if loading}
	<p class="text-surface-600-400 text-sm">Loading…</p>
{:else if id != null && !row}
	<div
		class="card preset-tonal text-surface-600-400 px-3 py-8 text-center text-sm"
	>
		This template no longer exists.
		<a class="underline" href={basePath}>Back to the list</a>.
	</div>
{:else}
	<div class="form-max flex flex-col gap-4">
		<div
			class="card preset-tonal flex flex-col gap-3 p-4 shadow-sm"
		>
			<div class="field-row">
				<label class="flex flex-col gap-1 text-sm">
					<span class="font-medium">Name</span>
					<input
						class="input"
						bind:value={name}
						readonly={readonly}
						placeholder="Template name"
					/>
				</label>
				<label class="flex flex-col gap-1 text-sm">
					<span class="font-medium">
						{kind === "context" ? "Step (pool)" : "Variable"}
					</span>
					{#if id == null}
						<select class="select" bind:value={poolId}>
							{#each pools as p (p.id)}
								<option value={p.id}>{p.label}</option>
							{/each}
						</select>
					{:else}
						<input
							class="input"
							value={row?.poolLabel ?? poolId}
							readonly
						/>
					{/if}
				</label>
				{#if engines.length > 1}
					<label class="flex flex-col gap-1 text-sm">
						<span class="font-medium">Engine</span>
						<select
							class="select"
							bind:value={engine}
							disabled={readonly}
						>
							<option value={null}>default</option>
							{#each engines as e (e.id)}
								<option value={e.id}>{e.id}</option>
							{/each}
						</select>
					</label>
				{/if}
			</div>

			<label class="flex flex-col gap-1 text-sm">
				<span class="font-medium">Template</span>
				<TemplateEditor
					value={source}
					{scope}
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
			<div
				class="card preset-tonal flex flex-col gap-2 p-4 text-sm shadow-sm"
			>
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
						class="bg-surface-200-800 overflow-x-auto rounded p-2 font-mono text-xs whitespace-pre-wrap">{preview.rendered}</pre>
				{/if}
				{#if preview.messages?.length}
					{#each preview.messages as m, i (i)}
						<div class="text-xs">
							<span class="font-semibold">{m.role}:</span>
							<pre
								class="bg-surface-200-800 mt-1 overflow-x-auto rounded p-2 font-mono whitespace-pre-wrap">{m.content}</pre>
						</div>
					{/each}
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.form-max {
		max-width: 64rem;
	}
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
