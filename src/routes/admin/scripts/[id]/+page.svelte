<script lang="ts">
	/**
	 * One script's dedicated change page (18 §4d, §6a). Everything is a draft —
	 * name, source, enabled, and the declared I/O — landing in one explicit
	 * Save; nothing on this page writes to the database on its own.
	 *
	 * The in/out declarations are chosen from a **fixed** set, never typed
	 * (ruled 2026-08-23): reads offer the type's in-ports plus the extras some
	 * hook actually supplies; rewrites offer the out-ports. What a script reads
	 * and may rewrite is the audit surface — a person checking a chain reads
	 * the declarations, not the source. In-but-not-out is read-only; a verdict
	 * type has no outs at all, because its return is consumed by the hook.
	 */
	import { getContext, onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import { page } from "$app/state"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"
	import { downloadBlob } from "$lib/client/utils/downloadBlob"

	type Script = Sockets.Pipelines.Scripts.Script
	type ScriptType = Sockets.Pipelines.Scripts.ScriptType

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()
	let id = $derived(Number(page.params.id))

	let view = $state<Sockets.Pipelines.Scripts.Response>({})
	let loading = $state(true)

	let row = $derived((view.scripts ?? []).find((s) => s.id === id))
	let type = $derived<ScriptType | undefined>(
		(view.types ?? []).find((t) => t.typeId === row?.typeId)
	)
	let readonly = $derived(!!row?.isImmutable)

	// ── the draft: seeded once, saved explicitly ────────────────────
	let name = $state("")
	let source = $state("")
	let enabled = $state(true)
	let varsIn = $state<string[]>([])
	let varsOut = $state<string[]>([])
	let seeded = $state(false)

	$effect(() => {
		if (seeded || loading || !row) return
		name = row.name
		source = row.source
		enabled = row.enabled
		varsIn = [...row.varsIn]
		varsOut = [...row.varsOut]
		seeded = true
	})

	const sameVars = (a: string[], b: string[]) =>
		a.length === b.length && a.every((v) => b.includes(v))

	let dirty = $derived(
		seeded &&
			!!row &&
			(name !== row.name ||
				source !== row.source ||
				enabled !== row.enabled ||
				!sameVars(varsIn, row.varsIn) ||
				!sameVars(varsOut, row.varsOut))
	)

	/** Reads: the type's in-ports plus supplied extras. Writes: out-ports. */
	let readChoices = $derived(
		type
			? [
					...type.varsIn,
					...type.extras.filter((e) => !type!.varsIn.includes(e))
				]
			: []
	)

	function toggleVar(which: "in" | "out", value: string) {
		if (readonly) return
		if (which === "in")
			varsIn = varsIn.includes(value)
				? varsIn.filter((v) => v !== value)
				: [...varsIn, value]
		else
			varsOut = varsOut.includes(value)
				? varsOut.filter((v) => v !== value)
				: [...varsOut, value]
	}

	/* --- socket wiring ------------------------------------------------ */

	const WRITE_EVENTS = [
		"pipelines:updateScript",
		"pipelines:cloneScript",
		"pipelines:deleteScript"
	] as const

	onMount(() => {
		if (!userCtx.user?.isAdmin) {
			goto("/")
			return
		}
		socket.on(
			"pipelines:scripts",
			(res: Sockets.Pipelines.Scripts.Response) => {
				view = res
				loading = false
			}
		)
		for (const ev of WRITE_EVENTS) {
			socket.on(ev, (res: Sockets.Pipelines.ScriptWrite.Response) => {
				if (res.scripts) view = res.scripts
			})
			socket.on(`${ev}:error` as any, (res: { error?: string }) => {
				if (res.error) toaster.error({ title: res.error })
			})
		}
		socket.on(
			"pipelines:exportScripts",
			(res: Sockets.Pipelines.ScriptShare.ExportResponse) => {
				if (res.blob && res.filename)
					downloadBlob(res as { blob: unknown; filename: string })
			}
		)
		socket.emit("pipelines:scripts", {})
	})

	onDestroy(() => {
		socket.off("pipelines:scripts")
		for (const ev of WRITE_EVENTS) {
			socket.off(ev)
			socket.off(`${ev}:error` as any)
		}
		socket.off("pipelines:exportScripts")
	})

	function save() {
		if (!row || !dirty) return
		socket.emit("pipelines:updateScript", {
			id,
			name,
			source,
			enabled,
			varsIn,
			varsOut
		})
		toaster.success({ title: "Script saved" })
	}

	function revert() {
		if (!row) return
		name = row.name
		source = row.source
		enabled = row.enabled
		varsIn = [...row.varsIn]
		varsOut = [...row.varsOut]
	}

	function clone() {
		socket.emit("pipelines:cloneScript", { id })
		toaster.success({ title: "Script cloned" })
		goto("/admin/scripts")
	}

	function remove() {
		if (!row) return
		if (
			!confirm(
				row.usedBy.length
					? `'${row.name}' is still in a chain — ${row.usedBy.join(", ")}. ` +
							`The server will refuse until it is removed there. Try anyway?`
					: `Delete '${row.name}'? Nothing is using it.`
			)
		)
			return
		socket.emit("pipelines:deleteScript", { id })
		goto("/admin/scripts")
	}
</script>

<div class="mb-4 flex flex-wrap items-center gap-3">
	<div class="min-w-0 flex-1">
		<p class="text-surface-600-400 text-xs">
			<a href="/admin/scripts" class="hover:underline">Scripts</a>
			/ <strong>{row?.name ?? "…"}</strong>
		</p>
		<h2 class="flex items-center gap-2 text-lg font-semibold">
			<Icons.SquareCode size={20} />
			{row?.name ?? "Script"}
			{#if readonly}
				<span
					class="preset-tonal-surface rounded-full px-2 py-0.5 text-xs font-normal"
					>built-in · read-only</span
				>
			{/if}
		</h2>
		{#if type}
			<p class="text-surface-600-400 text-sm">
				{type.name}
				<span class="font-mono text-xs">({type.typeId})</span>
				<span
					class="preset-tonal-warning ml-1 rounded-full px-1.5 py-0.5 text-[0.68rem]"
					title="What a script of this type is able to do"
					>{type.blastRadius}</span
				>
			</p>
		{/if}
	</div>
	<a class="btn btn-sm preset-tonal-surface" href="/admin/scripts">
		<Icons.ArrowLeft size={16} /> Back to list
	</a>
</div>

{#if loading}
	<p class="text-surface-600-400 text-sm">Loading…</p>
{:else if !row}
	<div
		class="card preset-filled-surface-100-900 text-surface-600-400 px-3 py-8 text-center text-sm"
	>
		This script no longer exists.
		<a class="underline" href="/admin/scripts">Back to the list</a>.
	</div>
{:else}
	<div class="form-max card preset-filled-surface-100-900 flex flex-col gap-3 p-4 shadow-sm">
		{#if type?.description}
			<p class="text-surface-600-400 text-xs">{type.description}</p>
		{/if}

		<div class="flex flex-wrap items-end gap-3">
			<label class="flex min-w-56 flex-1 flex-col gap-1 text-sm">
				<span class="font-medium">Name</span>
				<input class="input" bind:value={name} readonly={readonly} />
			</label>
			<label
				class="flex items-center gap-2 pb-2 text-sm"
				title="A disabled script keeps its place in every chain and does nothing. Saved with the rest of the draft."
			>
				<input
					type="checkbox"
					class="checkbox"
					bind:checked={enabled}
					disabled={readonly}
				/>
				Enabled
			</label>
		</div>

		{#if type}
			<div class="flex flex-col gap-1 text-sm">
				<span class="font-medium">Reads</span>
				<div class="flex flex-wrap gap-1.5">
					{#each readChoices as v (v)}
						<button
							class="chip rounded-full px-2 py-0.5 text-xs {varsIn.includes(
								v
							)
								? 'preset-filled-primary-500'
								: 'preset-tonal-surface'}"
							disabled={readonly}
							onclick={() => toggleVar("in", v)}
						>
							{v}
						</button>
					{/each}
				</div>
			</div>
			{#if type.varsOut.length}
				<div class="flex flex-col gap-1 text-sm">
					<span class="font-medium">Rewrites</span>
					<div class="flex flex-wrap gap-1.5">
						{#each type.varsOut as v (v)}
							<button
								class="chip rounded-full px-2 py-0.5 text-xs {varsOut.includes(
									v
								)
									? 'preset-filled-primary-500'
									: 'preset-tonal-surface'}"
								disabled={readonly}
								onclick={() => toggleVar("out", v)}
							>
								{v}
							</button>
						{/each}
					</div>
				</div>
			{:else}
				<p class="text-surface-600-400 text-xs">
					A verdict type rewrites nothing — its return is consumed by
					the hook.
				</p>
			{/if}
		{/if}

		<label class="flex flex-col gap-1 text-sm">
			<span class="font-medium">Source</span>
			<textarea
				class="textarea w-full font-mono text-xs"
				rows={16}
				readonly={readonly}
				spellcheck="false"
				bind:value={source}
			></textarea>
		</label>

		{#if row.usedBy.length}
			<p class="text-surface-600-400 text-xs">
				In chains: {row.usedBy.join(", ")}
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
				<button
					class="btn btn-sm preset-tonal-surface"
					disabled={!dirty}
					onclick={revert}
				>
					<Icons.Undo2 size={14} /> Revert
				</button>
			{/if}
			<div class="flex-1"></div>
			<button
				class="btn btn-sm preset-tonal-surface"
				title="Export"
				onclick={() =>
					socket.emit("pipelines:exportScripts", { ids: [id] })}
			>
				<Icons.Download size={14} /> Export
			</button>
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
