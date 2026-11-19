<script lang="ts">
	/** Test fixture: the keyword chips under a book's data, as the workspace mounts them. Never mounted by the app. */
	import KeywordChips from "./KeywordChips.svelte"
	import { setBookData, staticBookData } from "../bookData.svelte"

	let { bookAccess, keys }: { bookAccess: "owner" | "shared"; keys: string[] } =
		$props()

	// svelte-ignore state_referenced_locally
	setBookData(staticBookData(() => ({ lorebookId: 1, bookAccess })))
</script>

<KeywordChips {keys} idPrefix="t" />
