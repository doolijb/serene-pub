<script lang="ts">
	import EntryCoreFields from "./EntryCoreFields.svelte"
	import EntryAdvancedFields from "./EntryAdvancedFields.svelte"
	import { setLorePoolCtx, type LorePoolCtx } from "./poolContext"
	import { setVersionZones, type VersionZones } from "../time/versionZones"

	/**
	 * Test fixture for the entry form's two zones; never mounted by the app.
	 * Sets the lore pool context and, when given, the version-zones context,
	 * then mounts both field sections.
	 */
	interface Props {
		draft: Record<string, any>
		zones?: VersionZones
	}
	let { draft = $bindable(), zones }: Props = $props()

	setLorePoolCtx({
		pool: [],
		links: [],
		newRowBranchId: null,
		reading: { sessionId: null, sessionName: null },
		historyEntries: []
	} as unknown as LorePoolCtx)
	// svelte-ignore state_referenced_locally
	if (zones) setVersionZones(zones)
	let bindings: any[] = $state([])
</script>

<EntryCoreFields
	bind:draft
	bind:bindings
	idPrefix="t"
	vectorizationEnabled={false}
/>
<EntryAdvancedFields bind:draft idPrefix="t" vectorizationEnabled={false} />
