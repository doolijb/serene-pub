<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { getContext } from "svelte"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
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

	let openMenuSceneId = $state<number | null>(null)

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
			class="btn btn-sm preset-tonal-secondary w-full"
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
					<div role="none" onclick={(e) => e.stopPropagation()}>
						<Popover
							open={openMenuSceneId === scene.id}
							onOpenChange={(e) =>
								(openMenuSceneId = e.open ? scene.id : null)}
							positioning={{ placement: "bottom-end" }}
						>
							<Popover.Trigger
								class="btn btn-sm preset-filled-surface-400-600 shrink-0 p-1"
								title="More options"
								aria-label="More options for {scene.name ??
									'Unnamed scene'}"
							>
								<Icons.Ellipsis size={14} />
							</Popover.Trigger>
							<Portal>
								<Popover.Positioner class="z-[1000]!">
									<Popover.Content
										class="card bg-surface-100-900 flex min-w-36 flex-col gap-1 p-2 shadow-xl"
									>
										{#if pending}
											<button
												class="btn btn-sm preset-tonal-surface w-full justify-start"
												type="button"
												onclick={() => {
													openMenuSceneId = null
													pool.openProcess(
														scene.id,
														pending.activityId
													)
												}}
											>
												<Icons.Eye size={13} /> Review
											</button>
										{:else if hasMessages}
											<button
												class="btn btn-sm preset-filled-surface-400-600 w-full justify-start"
												type="button"
												disabled={isProcessing}
												onclick={() => {
													openMenuSceneId = null
													processScene(scene.id)
												}}
											>
												{#if scene.summary}
													<Icons.RefreshCw
														size={13}
													/> Reprocess
												{:else}
													<Icons.Sparkles size={13} />
													Process
												{/if}
											</button>
										{/if}
										<button
											class="btn btn-sm preset-filled-surface-400-600 w-full justify-start"
											type="button"
											onclick={() => {
												openMenuSceneId = null
												openScene(scene.id)
											}}
										>
											<Icons.Pencil size={13} /> Edit
										</button>
										<hr class="border-surface-300-700" />
										<button
											class="btn btn-sm preset-filled-error-500 w-full justify-start"
											type="button"
											onclick={() => {
												openMenuSceneId = null
												deleteScene(scene.id)
											}}
										>
											<Icons.Trash2 size={13} /> Delete
										</button>
									</Popover.Content>
								</Popover.Positioner>
							</Portal>
						</Popover>
					</div>
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
			class="btn btn-sm preset-filled-secondary-500 w-full"
			type="button"
			onclick={() => pool.openCompile(entry)}
		>
			<Icons.Wand size={14} /> Compile to Entry
		</button>
	{/if}
</div>
