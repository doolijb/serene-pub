<script lang="ts">
	/**
	 * Test fixture: one lens mounted the way `LorebooksWorkspace` mounts it —
	 * its descriptor's mount, under the workspace's relationship store and
	 * book data, handed a bench. Never mounted by the app.
	 */
	import { setContext } from "svelte"
	import { setBookData, type BookData } from "../bookData.svelte"
	import {
		setBookRelationships,
		type BookRelationships
	} from "../relationships.svelte"
	import { mountFor } from "./mounts"
	import type { LensBench, LensDescriptor } from "./types"

	let {
		store,
		data,
		contexts = {},
		lens,
		lorebookId,
		bench,
		hasUnsavedChanges = $bindable(false)
	}: {
		store: BookRelationships
		data: BookData
		contexts?: Record<string, unknown>
		lens: LensDescriptor
		lorebookId: number
		bench: LensBench
		hasUnsavedChanges?: boolean
	} = $props()

	// svelte-ignore state_referenced_locally
	setBookRelationships(store)
	// svelte-ignore state_referenced_locally
	setBookData(data)
	// svelte-ignore state_referenced_locally
	for (const [key, value] of Object.entries(contexts)) setContext(key, value)

	let LensMount = $derived(mountFor(lens))
</script>

<LensMount {lens} {lorebookId} {bench} bind:hasUnsavedChanges />
