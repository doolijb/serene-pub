<script lang="ts">
	/**
	 * The palisade in plain words: what a plugin asks for (optional) and what it
	 * can't do on this pub. Drawn from permissions alone, so it serves both a
	 * package not yet uploaded and an installed plugin's live ticks. With the asks
	 * shown, the two lists sit side by side once their own container is wide
	 * enough.
	 */
	import * as Icons from "@lucide/svelte"
	import { groupPermissionRows } from "$lib/shared/plugins/permissionGroups"
	import {
		pluginPalisade,
		type PalisadePermission
	} from "$lib/shared/plugins/palisade"

	let {
		permissions,
		showAsks = false
	}: { permissions: readonly PalisadePermission[]; showAsks?: boolean } =
		$props()

	const palisade = $derived(pluginPalisade(permissions))
	// The asks, headed by group (M2b): session · applet · this pub.
	const groups = $derived(groupPermissionRows(permissions))
</script>

<div class="@container" data-field="plugin-palisade">
	<div class="flex flex-col gap-3 {showAsks ? '@xl:flex-row @xl:gap-6' : ''}">
		{#if showAsks}
			<div class="flex min-w-0 flex-1 flex-col gap-1.5">
				<h4 class="text-surface-600-400 text-xs font-medium">
					Permissions it asks for
				</h4>
				{#if palisade.can.length === 0}
					<p class="text-surface-700-300 text-sm">None.</p>
				{:else}
					{#each groups as g (g.group)}
						<div class="flex flex-col gap-1" data-field="palisade-group-{g.group}">
							<h5 class="text-surface-700-300 text-xs">{g.heading}</h5>
							<ul class="flex flex-col gap-1">
								{#each g.rows as row (row.key)}
									<li class="flex items-start gap-2 text-sm">
										<Icons.Check
											size={14}
											class="text-surface-600-400 mt-0.5 shrink-0"
											aria-hidden="true"
										/>
										<span>{row.label}</span>
									</li>
								{/each}
							</ul>
						</div>
					{/each}
				{/if}
			</div>
		{/if}
		<div class="flex min-w-0 flex-1 flex-col gap-1.5">
			<h4 class="text-surface-600-400 text-xs font-medium">
				What it can't do
			</h4>
			<ul class="flex flex-col gap-1">
				{#each palisade.cannot as line (line)}
					<li class="flex items-start gap-2 text-sm">
						<Icons.Ban
							size={14}
							class="text-surface-600-400 mt-0.5 shrink-0"
							aria-hidden="true"
						/>
						<span>{line}</span>
					</li>
				{/each}
			</ul>
		</div>
	</div>
</div>
