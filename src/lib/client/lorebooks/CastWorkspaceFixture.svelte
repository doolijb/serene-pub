<script lang="ts">
	/**
	 * Test fixture: the Cast board under the workspace's ONE relationships
	 * store (`setBookRelationships`) and its book data (`setBookData`, plan
	 * B4), as `LorebooksWorkspace` mounts it — so a DOM test reads the member
	 * page a person reads. Never mounted by the app.
	 */
	import CastWorkspace from "./CastWorkspace.svelte"
	import {
		setBookRelationships,
		type BookRelationships
	} from "./relationships.svelte"
	import { setBookData, type BookData } from "./bookData.svelte"

	let {
		store,
		data,
		...props
	}: { store: BookRelationships; data: BookData } & Record<string, any> =
		$props()

	// svelte-ignore state_referenced_locally
	setBookRelationships(store)
	// svelte-ignore state_referenced_locally
	setBookData(data)
</script>

<CastWorkspace {...props as any} />
