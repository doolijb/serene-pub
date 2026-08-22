<script lang="ts">
	/**
	 * One pipeline: its versions, and what each one is.
	 *
	 * This is the structural view, so unlike the sidebar it may name topology —
	 * how many nodes a version has, which version is active, what its canonical
	 * hash is. That difference is the boundary 05 §0a draws, and it is enforced by
	 * these being different handlers rather than one handler with a flag.
	 *
	 * ## Why the hash is on screen
	 *
	 * A canonical hash is what makes an import verifiable rather than trusted
	 * (02 §3): two instances that compiled the same authoring source land on the
	 * same string. Showing it is what lets someone answer "is the pipeline I am
	 * running the one I was sent" without a tool.
	 *
	 * ## What this page does not do yet
	 *
	 * Editing. Publishing a new version, swapping a node, reordering — all of that
	 * is the lens view (05 §1–§5) and none of it is drafted here. A read-only
	 * management page that tells the truth is worth more right now than an editor
	 * that can write a spec version nobody can un-publish.
	 */
	import { getContext, onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import { page } from "$app/state"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()

	const slug = $derived(decodeURIComponent(page.params.slug ?? ""))

	let spec: Sockets.Pipelines.Detail.Response["spec"] | null = $state(null)
	let loading = $state(true)

	onMount(() => {
		if (!userCtx.user?.isAdmin) {
			goto("/")
			return
		}
		socket.on(
			"pipelines:detail",
			(res: Sockets.Pipelines.Detail.Response) => {
				spec = res.spec ?? null
				loading = false
			}
		)
		socket.on("pipelines:detail:error", (res: { error?: string }) => {
			loading = false
			if (res?.error) toaster.error({ title: res.error })
		})
		socket.emit("pipelines:detail", { slug })
	})

	onDestroy(() => {
		socket.off("pipelines:detail")
		socket.off("pipelines:detail:error")
	})

	const when = (iso: string | null) =>
		iso ? new Date(iso).toLocaleString() : "—"
</script>

<div class="mx-auto flex max-w-4xl flex-col gap-6 p-4">
	<header class="flex items-center gap-3">
		<Icons.Workflow size={24} />
		<div class="min-w-0 flex-1">
			<h1 class="truncate text-2xl font-semibold">
				{spec?.name ?? slug}
			</h1>
			<p class="text-muted truncate font-mono text-xs">{slug}</p>
		</div>
		<a class="btn btn-sm preset-tonal-surface" href="/pipelines">
			<Icons.ArrowLeft size={16} /> Pipelines
		</a>
	</header>

	{#if loading}
		<p class="text-muted text-sm">Loading…</p>
	{:else if !spec}
		<p class="text-muted text-sm">
			There is no pipeline called <code class="font-mono">{slug}</code>
			on this instance.
		</p>
	{:else}
		<section class="flex flex-col gap-2">
			<h2 class="text-lg font-semibold">Versions</h2>
			<p class="text-muted text-sm">
				Publishing moves a pointer; it never overwrites. A run in flight
				keeps the version it started on, so a receipt's claim to
				describe a particular version stays true.
			</p>
			<div class="overflow-x-auto">
				<table class="table w-full text-sm">
					<thead>
						<tr>
							<th class="text-left">Version</th>
							<th class="text-left">Status</th>
							<th class="text-right">Nodes</th>
							<th class="text-left">Published</th>
							<th class="text-left">Canonical hash</th>
						</tr>
					</thead>
					<tbody>
						{#each spec.versions as v (v.id)}
							<tr>
								<td class="whitespace-nowrap">
									{v.semver}
									{#if v.isActive}
										<span
											class="preset-tonal-success ml-1 rounded-full px-2 py-0.5 text-xs"
										>
											active
										</span>
									{/if}
								</td>
								<td>{v.status}</td>
								<td class="text-right">{v.nodeCount}</td>
								<td class="whitespace-nowrap">
									{when(v.publishedAt)}
								</td>
								<td
									class="text-muted max-w-[14rem] truncate font-mono text-xs"
									title={v.canonicalHash}
								>
									{v.canonicalHash}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>

		<section class="flex flex-col gap-2">
			<h2 class="text-lg font-semibold">Editing</h2>
			<div
				class="preset-tonal-surface flex items-start gap-2 rounded-xl p-3 text-sm"
			>
				<Icons.Construction size={18} class="mt-0.5 shrink-0" />
				<div>
					<p class="font-medium">Not built yet.</p>
					<p class="mt-1">
						Changing what a pipeline does — swapping a node,
						reordering, publishing a new version — is the lens view,
						and it is not drafted. Until then, the options each
						pipeline exposes are editable from the Pipelines panel,
						and this page is here to say what is actually published.
					</p>
				</div>
			</div>
		</section>
	{/if}
</div>
