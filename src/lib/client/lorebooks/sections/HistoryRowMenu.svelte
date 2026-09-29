<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { getContext } from "svelte"
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
	const compileEntriesCtx: CompileEntriesCtx = getContext("compileEntriesCtx")

	let scenes = $derived(pool.scenesOf(source.id))
	let activity = $derived(
		compileEntriesCtx?.activities?.find(
			(a) => a.historyEntryId === source.id
		)
	)
</script>

<button
	class="btn btn-sm preset-filled-surface-400-600 w-full justify-start"
	disabled={scenes.length === 0}
	title={scenes.length === 0 ? "Capture scenes first" : undefined}
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
