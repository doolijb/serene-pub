<script lang="ts">
	/**
	 * The Lives lens's mount: who was in the world, and when. Time draws what
	 * happened; this draws who was there for it — every member placed, against
	 * every dated history entry on the line.
	 */
	import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
	import LivesLens from "../time/LivesLens.svelte"
	import { getBookData } from "../bookData.svelte"
	import type { LensProps } from "./types"

	// Nothing on the Lives lens is an edit: it never sets `hasUnsavedChanges`
	// (declared bindable only because the workspace binds every mount).
	let { bench, hasUnsavedChanges = $bindable(false) }: LensProps = $props()

	const book = getBookData()
</script>

<LivesLens
	members={bench.livesMembers}
	presences={bench.presences as any}
	pins={(book.rows[HISTORY_TYPE_ID] ?? []) as any}
	moment={bench.moment}
	line={bench.line}
	onOpenMember={bench.openMember}
/>
