<script lang="ts">
	/**
	 * One prompt's dedicated change page (Django change form). A prompt is a
	 * name plus named text fields, owned by one pipeline; built-in rows are
	 * read-only here — clone to make an editable variant. Every write answers
	 * with the refreshed library view.
	 */
	import { onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import { page } from "$app/state"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"

	type Prompt = Sockets.Pipelines.Library.LibraryPrompt

	const socket = useTypedSocket()
	let id = $derived(Number(page.params.id))

	let view = $state<Sockets.Pipelines.Library.Response>({})
	let loading = $state(true)
	let name = $state("")
	let fields = $state<Record<string, string>>({})
	let seeded = $state(false)

	let row = $derived(
		((view.prompts ?? []) as Prompt[]).find((r) => r.id === id)
	)
	let readonly = $derived(!!row?.isImmutable)

	$effect(() => {
		if (seeded || loading || !row) return
		name = row.name
		fields = { ...row.fields }
		seeded = true
	})

	let dirty = $derived(
		seeded &&
			!!row &&
			(name !== row.name ||
				Object.keys(row.fields).some(
					(k) => (fields[k] ?? "") !== (row!.fields[k] ?? "")
				))
	)

	function handleLibrary(res: Sockets.Pipelines.Library.Response) {
		view = res
		loading = false
	}
	function handleWrite(res: Sockets.Pipelines.Library.Response) {
		view = res
	}
	function handleError(res: { error?: string }) {
		toaster.error({ title: res.error ?? "The library refused the edit." })
	}

	const WRITE_EVENTS = [
		"pipelines:libraryUpdatePrompt",
		"pipelines:libraryClonePrompt",
		"pipelines:libraryDeletePrompt"
	] as const

	onMount(() => {
		socket.on("pipelines:library", handleLibrary)
		for (const ev of WRITE_EVENTS) {
			socket.on(ev as any, handleWrite)
			socket.on(`${ev}:error` as any, handleError)
		}
		socket.emit("pipelines:library", {})
	})
	onDestroy(() => {
		socket.off("pipelines:library", handleLibrary)
		for (const ev of WRITE_EVENTS) {
			socket.off(ev as any, handleWrite)
			socket.off(`${ev}:error` as any, handleError)
		}
	})

	function save() {
		if (!row) return
		socket.emit("pipelines:libraryUpdatePrompt", { id, name, fields })
		toaster.success({ title: "Prompt saved" })
	}
	function clone() {
		socket.emit("pipelines:libraryClonePrompt", { id })
		toaster.success({ title: "Prompt cloned" })
		goto("/admin/prompts")
	}
	function remove() {
		if (!row) return
		if (
			!confirm(
				row.usedBy.length
					? `'${row.name}' is still used by ${row.usedBy.join(", ")}. ` +
							`The server will refuse until those point somewhere else. Try anyway?`
					: `Delete '${row.name}'? Nothing is using it.`
			)
		)
			return
		socket.emit("pipelines:libraryDeletePrompt", { id })
		goto("/admin/prompts")
	}
</script>

<div class="mb-4 flex flex-wrap items-center gap-3">
	<div class="min-w-0 flex-1">
		<p class="text-surface-600-400 text-xs">
			<a href="/admin/prompts" class="hover:underline">Prompts</a>
			/ <strong>{row?.name ?? "…"}</strong>
		</p>
		<h2 class="flex items-center gap-2 text-lg font-semibold">
			<Icons.MessageSquareText size={20} />
			{row?.name ?? "Prompt"}
			{#if readonly}
				<span
					class="preset-tonal-surface rounded-full px-2 py-0.5 text-xs font-normal"
					>built-in · read-only</span
				>
			{/if}
		</h2>
		{#if row}
			<p class="text-surface-600-400 text-sm">
				Pipeline: {row.specName}
				<span class="font-mono text-xs">({row.specSlug})</span>
			</p>
		{/if}
	</div>
	<a class="btn btn-sm preset-tonal-surface" href="/admin/prompts">
		<Icons.ArrowLeft size={16} /> Back to list
	</a>
</div>

{#if loading}
	<p class="text-surface-600-400 text-sm">Loading…</p>
{:else if !row}
	<div
		class="card preset-filled-surface-100-900 text-surface-600-400 px-3 py-8 text-center text-sm"
	>
		This prompt no longer exists.
		<a class="underline" href="/admin/prompts">Back to the list</a>.
	</div>
{:else}
	<div
		class="form-max card preset-filled-surface-100-900 flex flex-col gap-3 p-4 shadow-sm"
	>
		<label class="flex max-w-md flex-col gap-1 text-sm">
			<span class="font-medium">Name</span>
			<input class="input" bind:value={name} readonly={readonly} />
		</label>

		{#each Object.keys(row.fields) as field (field)}
			<label class="flex flex-col gap-1 text-sm">
				<span class="font-medium">{field}</span>
				<textarea
					class="textarea w-full font-mono text-xs"
					rows={readonly ? 4 : 8}
					readonly={readonly}
					spellcheck="false"
					bind:value={fields[field]}
				></textarea>
			</label>
		{/each}

		{#if row.usedBy.length}
			<p class="text-surface-600-400 text-xs">
				Used by: {row.usedBy.join(", ")}
			</p>
		{/if}

		<div class="flex flex-wrap items-center gap-2">
			{#if !readonly}
				<button
					class="btn btn-sm preset-filled-primary-500"
					disabled={!dirty}
					onclick={save}
				>
					<Icons.Save size={14} /> Save
				</button>
			{/if}
			<div class="flex-1"></div>
			<button class="btn btn-sm preset-tonal-surface" onclick={clone}>
				<Icons.Copy size={14} /> Clone
			</button>
			{#if !readonly}
				<button class="btn btn-sm preset-tonal-error" onclick={remove}>
					<Icons.Trash2 size={14} /> Delete
				</button>
			{/if}
		</div>
	</div>
{/if}

<style>
	.form-max {
		max-width: 64rem;
	}
</style>
