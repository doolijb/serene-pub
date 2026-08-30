<script lang="ts">
	/**
	 * One genre's whole world (admin IA 2026-08-28) — the hub where the
	 * ladder is visible for a single genre: identity and shape, the event
	 * surface (event → standing → serving pipelines), its presets, its
	 * session count. Every fact here is a SELECT made elsewhere; this page is
	 * where they meet, with a link out along every edge.
	 */
	import { getContext, onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import { page } from "$app/state"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import AdminList, {
		type AdminColumn
	} from "$lib/client/components/admin/AdminList.svelte"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()
	const genreId = $derived(decodeURIComponent(page.params.id ?? ""))

	let detail = $state<Sockets.SessionAdmin.GenreDetail.Response | null>(null)
	let loading = $state(true)

	const onDetail = (res: Sockets.SessionAdmin.GenreDetail.Response) => {
		detail = res
		loading = false
	}

	onMount(() => {
		if (!userCtx.user?.isAdmin) {
			goto("/")
			return
		}
		socket.on("sessionGenres:detail", onDetail)
		socket.on("sessionGenres:detail:error", onDetail)
		socket.emit("sessionGenres:detail", { genreId })
	})
	onDestroy(() => {
		socket.off("sessionGenres:detail", onDetail)
		socket.off("sessionGenres:detail:error", onDetail)
	})

	type Slot = Sockets.SessionAdmin.GenreDetail.Slot
	const slotColumns: AdminColumn<Slot>[] = [
		{ key: "event", label: "Event", value: (s) => s.event },
		{
			key: "standing",
			label: "Standing",
			value: (s) => (s.required ? 0 : s.open ? 2 : 1)
		},
		{ key: "candidates", label: "Serving pipelines" }
	]

	type Preset = Sockets.SessionAdmin.PresetRow
	const presetColumns: AdminColumn<Preset>[] = [
		{ key: "name", label: "Preset", value: (p) => p.name },
		{ key: "bindings", label: "Bindings" },
		{ key: "enabled", label: "Status", value: (p) => (p.enabled ? 0 : 1) },
		{ key: "actions", label: "", class: "w-px text-right" }
	]

	const LEGEND =
		"text-surface-600-400 text-[10px] font-bold tracking-[.15em] uppercase"
</script>

<div class="mb-4 flex flex-wrap items-center gap-3">
	<div class="min-w-0 flex-1">
		<p class="text-surface-600-400 text-xs">
			<a href="/admin/session-genres" class="hover:underline">Genres</a>
			/ <strong>{detail?.genre?.name ?? genreId}</strong>
		</p>
		<h2 class="flex items-center gap-2 text-lg font-semibold">
			<Icons.Shapes size={20} />
			{detail?.genre?.name ?? genreId}
			{#if detail?.genre?.family}
				<span
					class="preset-tonal-surface rounded-full px-2 py-0.5 text-xs font-normal"
					>{detail.genre.family}</span
				>
			{/if}
		</h2>
		<p class="text-surface-600-400 font-mono text-xs">{genreId}</p>
	</div>
	<div class="flex flex-wrap gap-1.5">
		{#if detail?.genre?.createSpecSlug}
			<a
				class="btn btn-sm preset-tonal-surface"
				href="/admin/pipelines/{encodeURIComponent(
					detail.genre.createSpecSlug
				)}"
			>
				<Icons.Workflow size={14} /> Create pipeline
			</a>
		{/if}
		<a
			class="btn btn-sm preset-tonal-surface"
			href="/admin/session-genres"
		>
			<Icons.ArrowLeft size={14} /> Genres
		</a>
	</div>
</div>

{#if loading}
	<p class="text-surface-600-400 text-sm">Loading…</p>
{:else if !detail?.genre}
	<div
		class="card preset-filled-surface-100-900 text-surface-600-400 px-3 py-8 text-center text-sm"
	>
		{detail?.error ?? "This genre no longer exists."}
	</div>
{:else}
	<div class="flex flex-col gap-5">
		{#if detail.genre.description}
			<p class="text-surface-700-300 max-w-[70ch] text-sm">
				{detail.genre.description}
			</p>
		{/if}

		<div class="stat-row">
			<div class="card preset-filled-surface-100-900 p-3">
				<p class={LEGEND}>Presets</p>
				<p class="text-xl font-semibold">{detail.presets.length}</p>
			</div>
			<div class="card preset-filled-surface-100-900 p-3">
				<p class={LEGEND}>Sessions</p>
				<p class="text-xl font-semibold">{detail.sessionCount}</p>
			</div>
			<div class="card preset-filled-surface-100-900 p-3">
				<p class={LEGEND}>Event slots</p>
				<p class="text-xl font-semibold">{detail.slots.length}</p>
			</div>
		</div>

		<section class="flex flex-col gap-2">
			<h3 class="text-base font-semibold">Event surface</h3>
			<p class="text-surface-600-400 text-sm">
				What this genre declares, and which published pipelines' input
				locks answer each slot. A preset binds the non-open slots;
				required ones must be bound for a preset to be enabled.
			</p>
			<AdminList
				rows={detail.slots}
				columns={slotColumns}
				searchText={(s) => s.event}
				searchPlaceholder="Search events…"
				defaultSort="standing"
				storageKey="serene-pub:adminView:genreSlots"
				emptyMessage="This genre declares no events — its declaration predates the event surface."
			>
				{#snippet cell(slot, col)}
					{#if col.key === "event"}
						<span class="font-mono text-xs font-semibold">
							{slot.event}
						</span>
					{:else if col.key === "standing"}
						{#if slot.required}
							<span
								class="preset-tonal-primary rounded-full px-2 py-0.5 text-xs"
								>required</span
							>
						{:else if slot.open}
							<span
								class="preset-tonal-secondary rounded-full px-2 py-0.5 text-xs"
								>open</span
							>
						{:else}
							<span
								class="preset-tonal-surface rounded-full px-2 py-0.5 text-xs"
								>optional</span
							>
						{/if}
					{:else if col.key === "candidates"}
						{#if slot.candidates.length}
							<span class="flex flex-wrap gap-1.5">
								{#each slot.candidates as c (c.slug)}
									<a
										class="preset-tonal-surface rounded-full px-2 py-0.5 text-xs hover:underline"
										href="/admin/pipelines/{encodeURIComponent(
											c.slug
										)}"
										title={c.slug}
									>
										{c.name}
									</a>
								{/each}
							</span>
						{:else}
							<span class="text-surface-600-400 text-xs">
								nothing serves this yet
							</span>
						{/if}
					{/if}
				{/snippet}
			</AdminList>
		</section>

		<section class="flex flex-col gap-2">
			<div class="flex items-center gap-2">
				<h3 class="flex-1 text-base font-semibold">Presets</h3>
				<a
					class="btn btn-sm preset-filled-primary-500"
					href="/admin/session-presets/new"
				>
					<Icons.Plus size={14} /> New preset
				</a>
			</div>
			<AdminList
				rows={detail.presets}
				columns={presetColumns}
				searchText={(p) => p.name}
				searchPlaceholder="Search presets…"
				defaultSort="name"
				storageKey="serene-pub:adminView:genrePresets"
				emptyMessage="No presets for this genre yet."
				onRowClick={(p) => goto(`/admin/session-presets/${p.id}`)}
			>
				{#snippet cell(p, col)}
					{#if col.key === "name"}
						<span class="font-semibold">{p.name}</span>
						{#if p.isDefault}
							<span
								class="preset-tonal-primary ml-1.5 rounded-full px-1.5 py-0.5 text-[0.68rem] font-semibold"
								>default</span
							>
						{/if}
						{#if p.isImmutable}
							<span
								class="preset-tonal-surface ml-1 rounded-full px-1.5 py-0.5 text-[0.68rem]"
								>built-in</span
							>
						{/if}
					{:else if col.key === "bindings"}
						<span class="flex flex-wrap gap-1">
							{#each Object.entries(p.bindings) as [event, b] (event)}
								<span
									class="preset-tonal-surface rounded px-1.5 py-0.5 font-mono text-[10px]"
									title="{event} ← {b.spec}{b.config
										? ` @ config #${b.config}`
										: ''}"
								>
									{event.replace("session-", "").replace(
										"message-",
										""
									)}
								</span>
							{/each}
						</span>
					{:else if col.key === "enabled"}
						{#if p.enabled}
							<span
								class="preset-tonal-success rounded-full px-2 py-0.5 text-xs"
								>enabled</span
							>
						{:else}
							<span
								class="preset-tonal-surface rounded-full px-2 py-0.5 text-xs"
								>hidden</span
							>
						{/if}
					{:else if col.key === "actions"}
						<a
							class="btn btn-sm preset-tonal-surface"
							href="/admin/session-presets/{p.id}"
							onclick={(e) => e.stopPropagation()}
						>
							<Icons.Pencil size={13} /> Edit
						</a>
					{/if}
				{/snippet}
			</AdminList>
		</section>

		<section class="card preset-filled-surface-100-900 p-3">
			<p class={LEGEND}>Shape</p>
			<pre
				class="bg-surface-200-800 mt-2 overflow-x-auto rounded p-2 font-mono text-[11px]">{JSON.stringify(
					detail.genre.shape,
					null,
					2
				)}</pre>
		</section>
	</div>
{/if}

<style>
	.stat-row {
		display: grid;
		gap: 0.8rem;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
	}
</style>
