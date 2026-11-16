<script lang="ts">
	/**
	 * Test fixture: the entry list and editor under the workspace's book data
	 * (`setBookData`), as `LorebooksWorkspace` mounts it. Never mounted by the
	 * app.
	 */
	import EntryWorkspace from "./EntryWorkspace.svelte"
	import { setBookData, type BookData } from "./bookData.svelte"

	let {
		data,
		...props
	}: { data: BookData } & Record<string, any> = $props()

	// svelte-ignore state_referenced_locally
	setBookData(data)
</script>

<EntryWorkspace {...props as any} />
