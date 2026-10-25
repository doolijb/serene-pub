<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { getContext } from "svelte"
	import RowMenu from "$lib/client/components/menus/RowMenu.svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { loreRoute } from "../loreRoute.svelte"
	import type { PoolSource } from "./types"
	import SceneCastChips from "./SceneCastChips.svelte"
	import { getLorePoolCtx } from "./poolContext"

	/**
	 * The scenes compiled into one history entry.
	 *
	 * Editing a scene opens it in the Scenes door rather than in a form nested
	 * here: a scene has one address, and a second editor for it would be a
	 * second place for its unsaved changes to hide.
	 */
	interface Props {
		entry: PoolSource
	}

	let { entry }: Props = $props()

	const socket = useTypedSocket()
	const pool = getLorePoolCtx()
	const sceneSummarizesCtx: SceneSummarizesCtx =
		getContext("sceneSummarizesCtx")

	let scenes = $derived(pool.scenesOf(entry.id))
	let readyToGraph = $derived(scenes.filter((s) => !s.graphed && s.summary))

	function activityOf(sceneId: number) {
		return sceneSummarizesCtx?.activities?.find(
			(a) => a.sceneId === sceneId
		)
	}

	function openScene(sceneId: number) {
		void loreRoute.navigate({
			type: "openEntry",
			scope: "scenes",
			entryId: entry.id,
			sceneId
		})
	}

	function processScene(sceneId: number) {
		pool.openProcess(sceneId, null)
		socket.emit("scenes:process", {
			sceneId
		} satisfies Sockets.Scenes.Process.Params)
	}

	function deleteScene(sceneId: number) {
		socket.emit("scenes:delete", {
			id: sceneId
		} satisfies Sockets.Scenes.Delete.Params)
	}
</script>

<div class="flex flex-col gap-2">
	{#if readyToGraph.length > 0 && pool.onNavigateToGraph}
		<button
			class="btn btn-sm preset-tonal-primary w-full"
			type="button"
			onclick={pool.onNavigateToGraph}
		>
			<Icons.GitGraph size={13} /> Build graph ({readyToGraph.length} ready)
		</button>
	{/if}
	{#if scenes.length === 0}
		<p class="text-surface-700-300 py-4 text-center text-xs italic">
			No scenes captured for this entry yet. Capture scenes from the
			session page.
		</p>
	{:else}
		{#each scenes as scene, sceneIdx (scene.id)}
			{@const activity = activityOf(scene.id)}
			{@const isProcessing = activity?.status === "running"}
			{@const pending =
				activity?.status === "review" ? activity : undefined}
			{@const hasMessages = (scene.selectedMessageIds?.length ?? 0) > 0}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div
				role="button"
				tabindex="0"
				data-scene-id={scene.id}
				class="bg-surface-200-800 hover:bg-surface-300-700 flex cursor-pointer flex-col gap-1.5 rounded-md p-2 text-sm transition-colors"
				onclick={() => openScene(scene.id)}
			>
				<div class="flex min-w-0 items-center gap-1.5">
					<span class="flex-1 truncate text-sm font-medium">
						<span class="text-surface-600-400 mr-1 font-normal">
							{sceneIdx + 1}.
						</span>
						{scene.name ?? "Unnamed scene"}
					</span>
					{#if scene.graphed}
						<Icons.GitGraph
							size={12}
							class="text-success-500 shrink-0"
							aria-label="Added to graph"
						/>
					{/if}
					{#if isProcessing}
						<Icons.Loader2
							size={13}
							class="text-primary-500 shrink-0 animate-spin"
							aria-label="Processing"
						/>
					{:else if pending}
						<button
							class="btn btn-sm preset-tonal-surface shrink-0 p-1"
							type="button"
							title="Review pending summary"
							aria-label="Review pending summary"
							onclick={(e) => {
								e.stopPropagation()
								pool.openProcess(scene.id, pending.activityId)
							}}
						>
							<Icons.Eye size={11} />
						</button>
					{/if}
					<RowMenu
						label={scene.name ?? "Unnamed scene"}
						triggerLabel="More actions for {scene.name ??
							'Unnamed scene'}"
						triggerTitle="More actions"
						triggerClass="btn btn-sm preset-tonal-surface shrink-0 p-1"
						horizontal
						width={180}
						items={[
							pending
								? {
										label: "Review",
										icon: Icons.Eye,
										onSelect: () =>
											pool.openProcess(
												scene.id,
												pending.activityId
											)
									}
								: hasMessages && {
										label: scene.summary
											? "Reprocess"
											: "Process",
										icon: scene.summary
											? Icons.RefreshCw
											: Icons.Sparkles,
										disabled: isProcessing,
										onSelect: () => processScene(scene.id)
									},
							{
								label: "Edit",
								icon: Icons.Pencil,
								onSelect: () => openScene(scene.id)
							},
							{ separator: true },
							{
								label: "Delete",
								icon: Icons.Trash2,
								destructive: true,
								onSelect: () => deleteScene(scene.id)
							}
						]}
					/>
				</div>
				{#if scene.summary}
					<p
						class="text-surface-600-400 line-clamp-3 text-xs leading-relaxed whitespace-pre-wrap"
					>
						{scene.summary}
					</p>
				{:else}
					<p class="text-surface-700-300 text-xs italic">
						No summary.
					</p>
				{/if}
				<SceneCastChips {scene} />
			</div>
		{/each}
		<button
			class="btn btn-sm preset-filled-primary-500 w-full"
			type="button"
			onclick={() => pool.openCompile(entry)}
		>
			<Icons.Wand size={14} /> Compile to Entry
		</button>
	{/if}
</div>
