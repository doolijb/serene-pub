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

<section class="card preset-tonal p-3" aria-label="Published versions">
	<h3 class="text-surface-600-400 text-sm font-semibold">
		Published versions ({versions.length})
	</h3>
	<p class="text-surface-600-400 mt-2 text-sm">
		Publishing moves a pointer; it never overwrites. A run in flight keeps
		the version it started on, so a receipt's claim to describe a
		particular version stays true.
	</p>
	<div class="mt-2 overflow-x-auto">
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
				{#each versions as v (v.id)}
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
						<td class="whitespace-nowrap">{when(v.publishedAt)}</td>
						<td>
							<span class="flex items-center gap-1">
								<span
									class="text-surface-600-400 max-w-[14rem] truncate font-mono text-xs"
									title={v.canonicalHash}
								>
									{v.canonicalHash}
								</span>
								<button
									class="opacity-50 hover:opacity-100"
									title="Copy the full hash"
									aria-label="Copy the canonical hash of {v.semver}"
									onclick={() => copyHash(v.canonicalHash)}
								>
									<Icons.Copy size={12} />
								</button>
							</span>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>
