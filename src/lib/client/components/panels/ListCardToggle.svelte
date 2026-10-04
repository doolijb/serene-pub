<script lang="ts">
	/**
	 * The list/card pair at the end of a view toolbar's find row (STYLE-GUIDE
	 * §6.3). Characters had it; Sessions has it since notes 36 (2026-10-02),
	 * and a third list wanting one takes this rather than a fourth copy.
	 *
	 * Two icon buttons in a group, the chosen one tonal primary and
	 * `aria-pressed` — never filled: "you are already looking at this" is not a
	 * call to action. Bound to a `createViewMode` store, which remembers the
	 * choice per list.
	 */
	import * as Icons from "@lucide/svelte"
	import type { ViewMode } from "$lib/client/utils/viewMode.svelte"
	import { toolbarButtonClass } from "./toolbarButton"

	interface Props {
		mode: { value: ViewMode }
		/** The list's noun, for the group's name, eg. "Sessions". */
		label: string
	}

	let { mode, label }: Props = $props()
</script>

<div class="flex shrink-0 gap-1" role="group" aria-label="{label} view mode">
	<button
		type="button"
		class={toolbarButtonClass(mode.value === "list")}
		onclick={() => (mode.value = "list")}
		title="List view"
		aria-label="List view"
		aria-pressed={mode.value === "list"}
	>
		<Icons.List size={16} aria-hidden="true" />
	</button>
	<button
		type="button"
		class={toolbarButtonClass(mode.value === "cards")}
		onclick={() => (mode.value = "cards")}
		title="Card view"
		aria-label="Card view"
		aria-pressed={mode.value === "cards"}
	>
		<Icons.LayoutGrid size={16} aria-hidden="true" />
	</button>
</div>
