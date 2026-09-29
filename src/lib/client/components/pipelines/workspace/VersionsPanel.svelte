<script lang="ts">
	/**
	 * What is actually published (22): every version, the active pointer
	 * marked. Publishing moves a pointer; it never overwrites — a run in
	 * flight keeps the version it started on, so a receipt's claim to describe
	 * a particular version stays true.
	 */
	import * as Icons from "@lucide/svelte"
	import { toaster } from "$lib/client/utils/toaster"

	type Version = NonNullable<
		Sockets.Pipelines.Detail.Response["spec"]
	>["versions"][number]

	interface Props {
		versions: Version[]
	}

	let { versions }: Props = $props()

	const when = (iso: string | null) =>
		iso ? new Date(iso).toLocaleString() : "—"

	async function copyHash(hash: string) {
		try {
			await navigator.clipboard.writeText(hash)
			toaster.success({ title: "Hash copied" })
		} catch {
			toaster.error({ title: "Clipboard unavailable" })
		}
	}
</script>

<section class="panel-card flex flex-col gap-2" aria-label="Published versions">
	<h3 class="text-sm font-semibold">
		Published versions ({versions.length})
	</h3>
	<p class="text-surface-600-400 text-sm">
		Publishing moves a pointer; it never overwrites. A run in flight keeps
		the version it started on, so a receipt's claim to describe a
		particular version stays true.
	</p>
	<!-- One row per version rather than a table, so the list reads the same
	     in a 400px column and in Focus. -->
	<ul class="flex flex-col gap-1.5">
		{#each versions as v (v.id)}
			<li class="bg-surface-50-950 flex flex-col gap-1 rounded-[10px] px-3 py-2 text-sm">
				<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
					<span class="font-mono font-semibold">{v.semver}</span>
					{#if v.isActive}
						<span class="preset-tonal-success rounded-full px-2 py-0.5 text-xs">
							active
						</span>
					{/if}
					<span class="text-surface-700-300">{v.status}</span>
					<span class="text-surface-600-400 text-xs">
						{v.nodeCount}
						{v.nodeCount === 1 ? "node" : "nodes"}
					</span>
					<span class="text-surface-600-400 ml-auto text-xs whitespace-nowrap">
						{when(v.publishedAt)}
					</span>
				</div>
				<span class="flex min-w-0 items-center gap-1">
					<span
						class="text-surface-600-400 min-w-0 truncate font-mono text-xs"
						title={v.canonicalHash}
					>
						{v.canonicalHash}
					</span>
					<button
						class="shrink-0 opacity-50 hover:opacity-100"
						title="Copy the full hash"
						aria-label="Copy the canonical hash of {v.semver}"
						onclick={() => copyHash(v.canonicalHash)}
					>
						<Icons.Copy size={12} />
					</button>
				</span>
			</li>
		{/each}
	</ul>
</section>
