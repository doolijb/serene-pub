<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import type { PoolSource } from "./types"
	import { getLorePoolCtx } from "./poolContext"

	/**
	 * Compile, from the list.
	 *
	 * Opening an entry to compile it is a click nobody needs: the scenes are
	 * already counted on the row, so the action belongs beside the row too.
	 */
	interface Props {
		source: PoolSource
		close: () => void
	}

	let { source, close }: Props = $props()

	const pool = getLorePoolCtx()

	let scenes = $derived(pool.scenesOf(source.id))
	/** Scenes not yet compiled that a compile of this entry would take in. */
	let unfiled = $derived(Number(source?.unfiledSceneCount) || 0)
	let canCompile = $derived(scenes.length > 0 || unfiled > 0)
	let activity = $derived(
		// This reading's compile, never another line's of the same entry.
		pool.compileActivityOf(source.id)
	)
</script>

<button
	class="btn btn-sm preset-tonal-surface w-full justify-start"
	disabled={!canCompile}
	title={canCompile ? undefined : "Capture scenes first"}
	onclick={(e) => {
		e.stopPropagation()
		close()
		pool.openCompile(source)
	}}
>
	<Icons.Wand size={14} />
	{activity?.status === "review"
		? "Review compile"
		: activity?.status === "running"
			? "View progress"
			: "Compile to Entry"}
</button>
