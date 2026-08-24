<script lang="ts">
	/**
	 * Pipeline management — the index.
	 *
	 * A page rather than a panel, because this is where the topology rule stops
	 * applying (05 §0a keeps it out of the *default* view, §1–§6 is the opt-in
	 * depth) and because the things it shows — a version's canonical hash, a run's
	 * halt reason — need more horizontal room than a 212px sidebar has.
	 *
	 * Admin-only, checked here and again in every handler. The check here is for
	 * the person; the check in the handler is the one that matters.
	 */
	import { getContext, onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import EmptyState from "$lib/client/components/EmptyState.svelte"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()

	let list: Sockets.Pipelines.Namespace[] = $state([])
	let runs: Sockets.Pipelines.Runs.Response["runs"] = $state([])
	let loading = $state(true)

	onMount(() => {
		if (!userCtx.user?.isAdmin) {
			goto("/")
			return
		}
		socket.on("pipelines:list", (res: Sockets.Pipelines.List.Response) => {
			list = res.pipelinesList
			loading = false
		})
		socket.on("pipelines:runs", (res: Sockets.Pipelines.Runs.Response) => {
			runs = res.runs
		})
		socket.emit("pipelines:list", {})
		socket.emit("pipelines:runs", { limit: 25 })
	})

	onDestroy(() => {
		socket.off("pipelines:list")
		socket.off("pipelines:runs")
	})

	const when = (iso: string) => new Date(iso).toLocaleString()
</script>

<div class="flex flex-col gap-6 p-4">
	<header class="flex items-center gap-3">
		<Icons.Workflow size={24} />
		<h1 class="flex-1 text-2xl font-semibold">Pipelines</h1>
		<a class="btn btn-sm preset-tonal-surface" href="/pipelines/library">
			<Icons.Library size={16} /> Library
		</a>
		<!-- Temporary home per 18 §4d: scripts get their own page, linked from
		     here until the navigation shell decides where it permanently lives. -->
		<a class="btn btn-sm preset-tonal-surface" href="/pipelines/scripts">
			<Icons.SquareCode size={16} /> Scripts
		</a>
		<a class="btn btn-sm preset-tonal-surface" href="/">
			<Icons.ArrowLeft size={16} /> Back
		</a>
	</header>

	<section class="flex flex-col gap-2">
		<h2 class="text-lg font-semibold">Published</h2>
		{#if loading}
			<p class="text-muted text-sm">Loading…</p>
		{:else if !list.length}
			<EmptyState
				icon={Icons.Workflow}
				message="Nothing is published. Core publishes its own pipelines at startup, so an empty list usually means the type registry refused to sync — check the server log for a bootstrap warning."
			/>
		{:else}
			<div class="flex flex-col gap-1">
				{#each list as ns (ns.slug)}
					<a
						class="hover:preset-tonal-surface flex items-center gap-3 rounded-xl p-3"
						href="/pipelines/{encodeURIComponent(ns.slug)}"
					>
						<span class="min-w-0 flex-1">
							<span class="block truncate font-medium">
								{ns.name}
							</span>
							<span
								class="text-muted block truncate font-mono text-xs"
							>
								{ns.slug} · v{ns.version}{ns.event
									? ` · on ${ns.event}`
									: ""}
							</span>
						</span>
						{#if !ns.enabled}
							<span
								class="preset-tonal-warning rounded-full px-2 py-0.5 text-xs"
							>
								disabled
							</span>
						{/if}
						<Icons.ChevronRight
							size={16}
							class="shrink-0 opacity-60"
						/>
					</a>
				{/each}
			</div>
		{/if}
	</section>

	<section class="flex flex-col gap-2">
		<h2 class="text-lg font-semibold">Recent runs</h2>
		<p class="text-muted text-sm">
			The honest answer to "did that use the pipeline". A session with no
			rows here was answered by the prompt builder — there is no third
			possibility.
		</p>
		{#if !runs.length}
			<EmptyState icon={Icons.History} message="No runs recorded yet." />
		{:else}
			<div class="overflow-x-auto">
				<table class="table w-full text-sm">
					<thead>
						<tr>
							<th class="text-left">When</th>
							<th class="text-left">Pipeline</th>
							<th class="text-left">Outcome</th>
							<th class="text-right">Time</th>
							<th class="text-right">Tokens</th>
						</tr>
					</thead>
					<tbody>
						{#each runs as run (run.id)}
							<tr>
								<td class="whitespace-nowrap">
									{when(run.startedAt)}
								</td>
								<td class="font-mono text-xs">
									{run.specSlug}
								</td>
								<td>
									{#if run.outcome === "ok"}
										<span class="text-success-500">ok</span>
									{:else}
										<!-- A halt is not a failure (05 §2): an
										     aborted generation and an empty
										     completion both halt. Shown with its
										     recorded reason rather than as an
										     error, because conflating the two is
										     how "why did nothing happen" becomes
										     unanswerable. -->
										<span class="text-warning-500">
											{run.outcome}
										</span>
										{#if run.haltReason}
											<span
												class="text-muted block text-xs"
											>
												{run.haltReason}
											</span>
										{/if}
									{/if}
									{#if run.isPreview}
										<span class="text-muted text-xs">
											(preview)
										</span>
									{/if}
								</td>
								<td class="text-right whitespace-nowrap">
									{run.elapsedMs} ms
								</td>
								<td class="text-right">
									{run.tokensSpent || "—"}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</div>
