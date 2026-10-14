<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import EmptyState from "$lib/client/components/EmptyState.svelte"
	import { formatDate } from "../sections/historyDates"
	import type { MemberScene } from "./memberScenes"

	/**
	 * A member's Timeline tab: the scenes they are in, on the line being
	 * read, oldest first (`memberScenes`). A scene dated after the moment
	 * being read is drawn dimmed and says "later", as a relationship that has
	 * not happened yet does. Picking one opens it under Scenes.
	 */
	interface Props {
		rows: MemberScene[]
		memberName: string
		onOpenScene: (row: MemberScene) => void
	}

	let { rows, memberName, onOpenScene }: Props = $props()

	function lineOf(row: MemberScene): string {
		const parts = [row.date ? formatDate(row.date) : "Undated"]
		if (row.note) parts.push(row.note)
		if (row.later) parts.push("later")
		return parts.join(" · ")
	}
</script>

{#if rows.length === 0}
	<EmptyState
		icon={Icons.Film}
		message="{memberName} is in no scene on this line yet. A scene lists who was there once a stretch of a session is captured."
	/>
{:else}
	<ul class="flex flex-col gap-2" data-cast-timeline>
		{#each rows as row (row.id)}
			<li>
				<button
					type="button"
					class="preset-filled-surface-100-900 hover:bg-surface-200-800 flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors"
					class:opacity-50={row.later}
					data-cast-scene={row.id}
					title="Open {row.label} in Scenes"
					onclick={() => onOpenScene(row)}
				>
					<Icons.Film
						size={16}
						class="text-surface-600-400 shrink-0"
						aria-hidden="true"
					/>
					<span class="flex min-w-0 flex-1 flex-col gap-0.5">
						<span class="truncate text-sm font-semibold">
							{row.label}
						</span>
						<span class="text-surface-600-400 truncate text-xs">
							{lineOf(row)}
						</span>
					</span>
				</button>
			</li>
		{/each}
	</ul>
{/if}
