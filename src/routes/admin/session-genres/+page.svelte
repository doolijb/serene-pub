<script lang="ts">
	/**
	 * Session genres (24 §3) — genres with their own ids, plus transitional
	 * input-type genres. Availability and the default preset are the admin
	 * levers; a genre's create pipeline is edited in its pipeline
	 * workspace. Both toggles here are discrete admin actions (like plugin
	 * enable), not form fields — the explicit-save rule governs forms.
	 */
	import { getContext, onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import AdminList, {
		type AdminColumn
	} from "$lib/client/components/admin/AdminList.svelte"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()

	type Row = Sockets.SessionAdmin.GenreRow
	let rows: Row[] = $state([])
	let presets: Sockets.SessionAdmin.PresetRow[] = $state([])
	let loading = $state(true)

	const onTypes = (res: Sockets.SessionAdmin.Genres.Response) => {
		rows = res.genres
		loading = false
	}
	const onPresets = (res: Sockets.SessionAdmin.Presets.Response) => {
		presets = res.presets
	}

	onMount(() => {
		if (!userCtx.user?.isAdmin) {
			goto("/")
			return
		}
		socket.on("sessionGenres:list", onTypes)
		socket.on("sessionPresets:list", onPresets)
		socket.emit("sessionGenres:list", {})
		socket.emit("sessionPresets:list", {})
	})
	onDestroy(() => {
		socket.off("sessionGenres:list", onTypes)
		socket.off("sessionPresets:list", onPresets)
	})

	const columns: AdminColumn<Row>[] = [
		{ key: "name", label: "Genre", value: (r) => r.name },
		{ key: "slug", label: "Spec", value: (r) => r.slug },
		{ key: "presets", label: "Presets", value: (r) => r.presetCount },
		{ key: "default", label: "Default preset" },
		{ key: "enabled", label: "Available", value: (r) => (r.enabled ? 0 : 1) },
		{ key: "actions", label: "", class: "w-px text-right" }
	]

	const presetsOf = (slug: string) =>
		presets.filter((p) => p.genreId === slug)

	function setEnabled(r: Row, enabled: boolean) {
		socket.emit("sessionGenres:update", { slug: r.slug, enabled })
	}
	function setDefaultPreset(r: Row, raw: string) {
		socket.emit("sessionGenres:update", {
			slug: r.slug,
			defaultPresetId: raw ? Number(raw) : null
		})
	}
</script>

<div class="mb-4 flex flex-wrap items-start gap-3">
	<div class="flex-1">
		<h2 class="flex items-center gap-2 text-lg font-semibold">
			<Icons.Shapes size={20} /> Session genres
		</h2>
		<p class="text-surface-600-400 text-sm">
			What kinds of session users can start. A genre declares its shape
			and events; its create pipeline is edited in the pipeline
			workspace. New genres arrive with new create pipelines.
		</p>
	</div>
	<a class="btn btn-sm preset-tonal-surface" href="/admin/pipelines">
		<Icons.Workflow size={16} /> Pipelines
	</a>
</div>

<AdminList
	{rows}
	{columns}
	{loading}
	searchText={(r) => `${r.name} ${r.slug} ${r.family}`}
	searchPlaceholder="Search genres…"
	defaultSort="name"
	storageKey="serene-pub:adminView:sessionGenres"
	onRowClick={(r) => goto(`/admin/session-genres/${encodeURIComponent(r.slug)}`)}
	emptyMessage="No session genres — core registers Chat at startup, so an empty list means the bootstrap failed."
>
	{#snippet cell(row, col)}
		{#if col.key === "name"}
			<span class="font-semibold">{row.name}</span>
			{#if row.family}
				<span
					class="preset-tonal-surface ml-1.5 rounded-full px-1.5 py-0.5 text-[0.68rem]"
					>{row.family}</span
				>
			{/if}
		{:else if col.key === "slug"}
			<span class="text-surface-600-400 font-mono text-xs">{row.slug}</span>
			{#if !row.createSpecSlug}
				<span
					class="preset-tonal-warning ml-1 rounded-full px-1.5 py-0.5 text-[0.68rem]"
					title="Declared by an input type, not a genre — the transitional path"
					>input-type</span
				>
			{/if}
		{:else if col.key === "presets"}
			<span class="text-xs">{row.presetCount}</span>
		{:else if col.key === "default"}
			{#if presetsOf(row.slug).length}
				<select
					class="select w-auto py-1 text-xs"
					value={row.defaultPresetId != null
						? String(row.defaultPresetId)
						: ""}
					onchange={(e) => setDefaultPreset(row, e.currentTarget.value)}
					aria-label="Default preset for {row.name}"
				>
					<option value="">—</option>
					{#each presetsOf(row.slug) as p (p.id)}
						<option value={String(p.id)}>{p.name}</option>
					{/each}
				</select>
			{:else}
				<span class="text-surface-600-400 text-xs">no presets</span>
			{/if}
		{:else if col.key === "enabled"}
			<label class="flex items-center gap-1.5 text-xs">
				<input
					type="checkbox"
					class="checkbox"
					checked={row.enabled}
					onchange={(e) => setEnabled(row, e.currentTarget.checked)}
				/>
				{row.enabled ? "available" : "hidden"}
			</label>
		{:else if col.key === "actions"}
			{#if row.createSpecSlug}
				<a
					class="btn btn-sm preset-tonal-surface"
					href="/admin/pipelines/{encodeURIComponent(row.createSpecSlug)}"
				>
					<Icons.Settings2 size={13} /> Open spec
				</a>
			{/if}
		{/if}
	{/snippet}
</AdminList>
