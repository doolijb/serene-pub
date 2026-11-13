<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import ListGroupLabel from "$lib/client/components/panels/ListGroupLabel.svelte"
	import CompileHistoryEntryModal from "$lib/client/components/modals/CompileHistoryEntryModal.svelte"
	import { getBookData } from "../bookData.svelte"
	import { loreRoute } from "../loreRoute.svelte"
	import { parseMoment } from "../time/moment"
	import { formatDate, type StoryDate } from "./historyDates"
	import { takeUnfiledFocus } from "./unfiledFocus.svelte"
	import { unfiledScenesByDay } from "./unfiledScenes"
	import type { PoolSource } from "./types"

	/**
	 * 🚧 *Not yet compiled* (S-B2): the line's scenes that no history entry
	 * holds yet, by day, with one Compile per day. The press makes the day's
	 * entry when there is none; this group only asks (`scenes:compile` by
	 * date) and shows the run through the Compile window.
	 */
	interface Props {
		/** The History rows, to read an entry the press made. */
		sources: PoolSource[]
	}

	let { sources }: Props = $props()

	const book = getBookData()
	const route = $derived(loreRoute.route)
	const line = $derived(route.branch ?? null)
	const days = $derived(unfiledScenesByDay(book.scenes, line))
	const total = $derived(days.reduce((n, d) => n + d.scenes.length, 0))

	const countOf = (n: number) => `${n} ${n === 1 ? "scene" : "scenes"}`
	const nameOf = (scene: PoolSource) => scene.name?.trim() || "Unnamed Scene"

	let compiling = $state<{ date: StoryDate | null } | null>(null)
	let compileOpen = $state(false)
	/** The scene the Time lens or the graph sent the reader to. */
	let marked = $state<number | null>(null)
	let blocks: Record<string, HTMLElement | undefined> = {}

	// The handoff is taken once the scenes have arrived, so a group that
	// mounts before the list loads does not eat it.
	$effect(() => {
		const lorebookId = book.lorebookId
		if (lorebookId == null || total === 0) return
		const sceneId = takeUnfiledFocus(lorebookId)
		if (sceneId == null) return
		const day = days.find((d) => d.scenes.some((s) => s.id === sceneId))
		if (!day) return
		marked = sceneId
		queueMicrotask(() => {
			const block = blocks[day.key]
			if (block && typeof block.scrollIntoView === "function")
				block.scrollIntoView({ block: "nearest" })
		})
	})

	function openScene(scene: PoolSource) {
		marked = null
		void loreRoute.navigate({
			type: "openEntry",
			scope: "scenes",
			entryId: scene.id,
			sceneId: scene.id
		})
	}

	function compile(date: StoryDate | null) {
		marked = null
		compiling = { date }
		compileOpen = true
	}
</script>

{#if total > 0}
	<div data-unfiled-group>
		<ListGroupLabel label="Not yet compiled" trailing={String(total)} />
		{#each days as day (day.key)}
			<div
				class="flex flex-col gap-1 px-3 py-2"
				data-unfiled-day={day.key}
				bind:this={blocks[day.key]}
			>
				<div class="flex min-w-0 items-center gap-2">
					<span class="min-w-0 flex-1 truncate text-sm font-medium">
						{day.date ? formatDate(day.date) : "Undated"}
					</span>
					<span class="text-surface-600-400 text-xs">
						{countOf(day.scenes.length)}
					</span>
					{#if !book.readOnly}
						<button
							type="button"
							class="btn btn-sm preset-tonal-primary"
							title={day.date
								? `Compile these scenes into the history entry of ${formatDate(day.date)}, making it if there is none`
								: "Compile these scenes into the newest dated history entry, making one if there is none"}
							onclick={() => compile(day.date)}
						>
							<Icons.Wand size={14} />
							Compile
						</button>
					{/if}
				</div>
				<ul class="flex flex-col">
					{#each day.scenes as scene (scene.id)}
						<li>
							<button
								type="button"
								class={[
									"w-full truncate rounded px-2 py-1 text-left text-sm",
									marked === scene.id
										? "preset-tonal-primary"
										: "hover:preset-tonal-surface"
								]}
								aria-current={marked === scene.id
									? "true"
									: undefined}
								data-scene-id={scene.id}
								onclick={() => openScene(scene)}
							>
								{nameOf(scene)}
							</button>
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	</div>
{/if}

{#if compiling && book.lorebookId != null}
	<CompileHistoryEntryModal
		open={compileOpen}
		onOpenChange={(e) => {
			compileOpen = e.open
			if (!e.open) compiling = null
		}}
		byDate={{ lorebookId: book.lorebookId, date: compiling.date }}
		entryOf={(id) => sources.find((s) => s.id === id) as any}
		moment={parseMoment(route.moment)}
		branchId={line}
	/>
{/if}
