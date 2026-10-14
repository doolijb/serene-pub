<script lang="ts">
	/**
	 * Test fixture: a `SectionList` in `PanelSplit kind="sections"`'s list
	 * snippet, the way a section view writes it — one list for both widths,
	 * no `flush` switching. Never mounted by the app.
	 */
	import type { ViewMode } from "$lib/client/shell/viewMode.svelte"
	import PanelSplit from "./PanelSplit.svelte"
	import SectionList from "./SectionList.svelte"
	import type { SectionGroup } from "./sectionList"

	let {
		mode,
		hasDetail = false,
		groups,
		value = null
	}: {
		mode: ViewMode
		hasDetail?: boolean
		groups: SectionGroup[]
		value?: string | null
	} = $props()
</script>

<PanelSplit {mode} {hasDetail} kind="sections">
	{#snippet list()}
		<SectionList {groups} {value} ariaLabel="Fixture sections" />
	{/snippet}
	{#snippet detail()}
		<p>Section body</p>
	{/snippet}
</PanelSplit>
