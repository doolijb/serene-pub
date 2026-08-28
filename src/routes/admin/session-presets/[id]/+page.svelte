<script lang="ts">
	/**
	 * One preset's change page — the admin's mirror of the modder's
	 * `preset()` (24 §7, admin IA 2026-08-28). A preset populates its genre's
	 * event slots: for each non-open slot, a pipeline whose input lock
	 * answers it, and optionally a named configuration of that pipeline.
	 * Required slots must be bound for the preset to be enabled — rendered
	 * live here, enforced again by the server with the same sentences.
	 *
	 * Everything is a draft behind an explicit Save (the standing rule);
	 * built-ins accept availability flags only — duplicate to change what
	 * they bind.
	 */
	import { getContext, onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import { page } from "$app/state"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()
	let id = $derived(Number(page.params.id))

	type Row = Sockets.SessionAdmin.PresetRow
	type Slot = Sockets.SessionAdmin.GenreDetail.Slot
	type ConfigRow = Sockets.Pipelines.ConfigsIndex.Row

	let presets: Row[] = $state([])
	let slots: Slot[] = $state([])
	let configs: ConfigRow[] = $state([])
	let loading = $state(true)
	let row = $derived(presets.find((p) => p.id === id))
	let readonly = $derived(!!row?.isImmutable)

	/* ── draft ──────────────────────────────────────────────────────── */

	let name = $state("")
	let description = $state("")
	let enabled = $state(true)
	let isDefault = $state(false)
	let bindings = $state<Record<string, { spec: string; config?: number }>>({})
	let seeded = $state(false)
	let detailRequested = $state(false)

	$effect(() => {
		if (seeded || loading || !row) return
		name = row.name
		description = row.description ?? ""
		enabled = row.enabled
		isDefault = row.isDefault
		bindings = structuredClone($state.snapshot(row.bindings) ?? {})
		seeded = true
	})

	// The genre's event surface arrives once the row names the genre.
	$effect(() => {
		if (!row || detailRequested) return
		detailRequested = true
		socket.emit("sessionGenres:detail", { genreId: row.genreId })
	})

	let dirty = $derived(
		seeded &&
			!!row &&
			(name !== row.name ||
				description !== (row.description ?? "") ||
				enabled !== row.enabled ||
				isDefault !== row.isDefault ||
				JSON.stringify(bindings) !== JSON.stringify(row.bindings))
	)

	/** Non-open slots are the bindable ones; open slots are the action list. */
	const bindableSlots = $derived(slots.filter((s) => !s.open))
	const missingRequired = $derived(
		bindableSlots
			.filter((s) => s.required && !bindings[s.event]?.spec)
			.map((s) => s.event)
	)

	const configsOf = (specSlug: string) =>
		configs.filter((c) => c.specSlug === specSlug)

	function setSlotSpec(event: string, spec: string) {
		if (!spec) {
			const next = { ...bindings }
			delete next[event]
			bindings = next
			return
		}
		// A new pipeline means its configs — the old selection is meaningless.
		bindings = { ...bindings, [event]: { spec } }
	}

	function setSlotConfig(event: string, raw: string) {
		const b = bindings[event]
		if (!b) return
		bindings = {
			...bindings,
			[event]: raw ? { spec: b.spec, config: Number(raw) } : { spec: b.spec }
		}
	}

	/* ── wiring ─────────────────────────────────────────────────────── */

	const onPresets = (res: Sockets.SessionAdmin.Presets.Response) => {
		presets = res.presets
		loading = false
	}
	const onDetail = (res: Sockets.SessionAdmin.GenreDetail.Response) => {
		slots = res.slots
	}
	const onConfigs = (res: Sockets.Pipelines.ConfigsIndex.Response) => {
		configs = res.configs
	}
	const onError = (res: { error?: string }) => {
		if (res.error) toaster.error({ title: res.error })
	}

	onMount(() => {
		if (!userCtx.user?.isAdmin) {
			goto("/")
			return
		}
		socket.on("sessionPresets:list", onPresets)
		socket.on("sessionGenres:detail", onDetail)
		socket.on("pipelines:configsIndex", onConfigs)
		socket.on("sessionPresets:update:error", onError)
		socket.on("sessionPresets:delete:error", onError)
		socket.emit("sessionPresets:list", {})
		socket.emit("pipelines:configsIndex", {})
	})
	onDestroy(() => {
		socket.off("sessionPresets:list", onPresets)
		socket.off("sessionGenres:detail", onDetail)
		socket.off("pipelines:configsIndex", onConfigs)
		socket.off("sessionPresets:update:error", onError)
		socket.off("sessionPresets:delete:error", onError)
	})

	function save() {
		if (!row || !dirty) return
		socket.emit("sessionPresets:update", {
			id,
			name,
			description: description || null,
			enabled,
			isDefault,
			...(readonly ? {} : { bindings })
		})
		toaster.success({ title: "Preset saved" })
	}
	function duplicate() {
		if (!row) return
		socket.emit("sessionPresets:create", {
			name: `${row.name} copy`,
			genreId: row.genreId,
			description: row.description ?? undefined,
			fromPresetId: row.id
		})
		toaster.success({ title: "Preset duplicated" })
		goto("/admin/session-presets")
	}
	function remove() {
		if (!row || readonly) return
		if (
			!confirm(
				`Delete "${row.name}"? Sessions born from it keep running; they simply reference nothing.`
			)
		)
			return
		socket.emit("sessionPresets:delete", { id })
		goto("/admin/session-presets")
	}
</script>

<div class="mb-4 flex flex-wrap items-center gap-3">
	<div class="min-w-0 flex-1">
		<p class="text-surface-600-400 text-xs">
			<a href="/admin/session-presets" class="hover:underline">Presets</a>
			/ <strong>{row?.name ?? "…"}</strong>
		</p>
		<h2 class="flex items-center gap-2 text-lg font-semibold">
			<Icons.Ticket size={20} />
			{row?.name ?? "Preset"}
			{#if readonly}
				<span
					class="preset-tonal-surface rounded-full px-2 py-0.5 text-xs font-normal"
					>built-in · availability only</span
				>
			{/if}
		</h2>
	</div>
	<a class="btn btn-sm preset-tonal-surface" href="/admin/session-presets">
		<Icons.ArrowLeft size={16} /> Back to list
	</a>
</div>

{#if loading}
	<p class="text-surface-600-400 text-sm">Loading…</p>
{:else if !row}
	<div
		class="card preset-tonal text-surface-600-400 px-3 py-8 text-center text-sm"
	>
		This preset no longer exists.
		<a class="underline" href="/admin/session-presets">Back to the list</a>.
	</div>
{:else}
	<div class="form-max flex flex-col gap-4">
		<div class="card preset-tonal flex flex-col gap-3 p-4 shadow-sm">
			<div class="field-row">
				<label class="flex flex-col gap-1 text-sm">
					<span class="font-medium">Name</span>
					<input class="input" bind:value={name} readonly={readonly} />
				</label>
				<div class="flex flex-col gap-1 text-sm">
					<span class="font-medium">Genre</span>
					<a
						class="input flex items-center font-mono text-xs hover:underline"
						href="/admin/session-genres/{encodeURIComponent(
							row.genreId
						)}"
						title="Open the genre dashboard"
					>
						{row.genreId}
					</a>
				</div>
			</div>
			<label class="flex flex-col gap-1 text-sm">
				<span class="font-medium">Description</span>
				<textarea
					class="textarea w-full"
					rows={2}
					readonly={readonly}
					bind:value={description}
				></textarea>
			</label>
			<div class="flex flex-wrap gap-4">
				<label class="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						class="checkbox"
						bind:checked={enabled}
					/>
					Available to users
				</label>
				<label class="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						class="checkbox"
						bind:checked={isDefault}
					/>
					Default for its genre
				</label>
			</div>
		</div>

		<!-- ── the bindings: the genre's event slots, filled ─────────── -->
		<section class="card preset-tonal flex flex-col gap-3 p-4 shadow-sm">
			<div>
				<h3 class="text-sm font-semibold">Event bindings</h3>
				<p class="text-surface-600-400 text-xs">
					For each event the genre declares: which pipeline answers,
					with which configuration. Only pipelines whose declared lock
					matches the slot are offered — the same rule the authoring
					kit enforces.
				</p>
			</div>

			{#if !bindableSlots.length}
				<p class="text-surface-600-400 text-sm italic">
					Waiting for the genre's event surface…
				</p>
			{/if}

			{#each bindableSlots as slot (slot.event)}
				{@const bound = bindings[slot.event]}
				<div
					class="border-surface-300-700 flex flex-col gap-2 rounded-md border p-3"
				>
					<div class="flex items-center gap-2">
						<span class="font-mono text-xs font-semibold">
							{slot.event}
						</span>
						{#if slot.required}
							<span
								class="preset-tonal-primary rounded-full px-1.5 py-0.5 text-[0.65rem]"
								>required</span
							>
						{:else}
							<span
								class="preset-tonal-surface rounded-full px-1.5 py-0.5 text-[0.65rem]"
								>optional</span
							>
						{/if}
						{#if slot.required && !bound?.spec}
							<span class="text-warning-500 text-xs">
								<Icons.TriangleAlert
									size={12}
									class="mr-0.5 inline"
								/>unbound
							</span>
						{/if}
					</div>
					<div class="field-row">
						<label class="flex flex-col gap-1 text-xs">
							<span class="text-surface-600-400">Pipeline</span>
							<select
								class="select"
								disabled={readonly}
								value={bound?.spec ?? ""}
								onchange={(e) =>
									setSlotSpec(
										slot.event,
										e.currentTarget.value
									)}
							>
								{#if !slot.required}
									<option value="">— unbound —</option>
								{:else if !bound?.spec}
									<option value="">— choose —</option>
								{/if}
								{#each slot.candidates as c (c.slug)}
									<option value={c.slug}>{c.name}</option>
								{/each}
							</select>
						</label>
						<label class="flex flex-col gap-1 text-xs">
							<span class="text-surface-600-400">
								Configuration
							</span>
							<select
								class="select"
								disabled={readonly || !bound?.spec}
								value={bound?.config != null
									? String(bound.config)
									: ""}
								onchange={(e) =>
									setSlotConfig(
										slot.event,
										e.currentTarget.value
									)}
							>
								<option value="">shipped default</option>
								{#if bound?.spec}
									{#each configsOf(bound.spec) as c (c.id)}
										<option value={String(c.id)}>
											{c.isDefault ? "★ " : ""}{c.name}
										</option>
									{/each}
								{/if}
							</select>
						</label>
					</div>
					{#if bound?.spec}
						<a
							class="text-surface-600-400 self-start text-[11px] underline"
							href="/admin/pipelines/{encodeURIComponent(
								bound.spec
							)}{bound.config != null
								? `?config=${bound.config}`
								: ''}"
						>
							Open in workspace
						</a>
					{/if}
				</div>
			{/each}

			{#if readonly}
				<p class="text-surface-600-400 text-xs italic">
					This preset is shipped with Serene Pub — its bindings are
					never edited in place. Duplicate it to change them.
				</p>
			{/if}
		</section>

		{#if enabled && missingRequired.length}
			<div class="card preset-tonal-warning flex items-start gap-2 p-3">
				<Icons.TriangleAlert size={16} class="mt-0.5 shrink-0" />
				<p class="text-sm">
					An enabled preset must bind its required slots — missing:
					<span class="font-mono text-xs">
						{missingRequired.join(", ")}</span
					>. The server will refuse this save.
				</p>
			</div>
		{/if}

		<div class="flex flex-wrap items-center gap-2">
			<button
				class="btn btn-sm preset-filled-primary-500"
				disabled={!dirty}
				onclick={save}
			>
				<Icons.Save size={14} /> Save
			</button>
			<div class="flex-1"></div>
			<button class="btn btn-sm preset-tonal-surface" onclick={duplicate}>
				<Icons.Copy size={14} /> Duplicate
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
		max-width: 52rem;
	}
	.field-row {
		display: grid;
		gap: 1rem;
		grid-template-columns: 1fr;
	}
	@container content (min-width: 640px) {
		.field-row {
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
