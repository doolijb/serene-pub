<script lang="ts">
	/**
	 * **New loadout** — the loadout editor opened empty (`LoadoutSheet` with
	 * no loadout): a name, what it is for, then the same three cards. Create
	 * makes the row and sends the rest in one go, so a new loadout is filled
	 * where every other one is.
	 */
	import type { CapabilityConnection } from "$lib/client/components/connections/jobPicker"
	import LoadoutSheet from "./LoadoutSheet.svelte"

	interface Props {
		open: boolean
		jobs: readonly { id: string; label: string }[]
		list: Sockets.Loadouts.List.Response
		connections: readonly CapabilityConnection[]
		onClose: () => void
	}
	let { open, jobs, list, connections, onClose }: Props = $props()
</script>

<LoadoutSheet loadout={null} {open} {jobs} {list} {connections} {onClose} />
