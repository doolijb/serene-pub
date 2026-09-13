<script lang="ts">
	import type { EntryEditorProps } from "./types"
	import EntryAdvancedFields from "./EntryAdvancedFields.svelte"
	import EntryCoreFields from "./EntryCoreFields.svelte"

	/** World lore is four fields plus Advanced, and stays four fields. */
	let {
		draft = $bindable(),
		bindings = $bindable(),
		vectorizationEnabled
	}: EntryEditorProps = $props()
</script>

<EntryCoreFields
	bind:draft
	bind:bindings
	idPrefix="wle"
	{vectorizationEnabled}
	namePlaceholder="Umber City"
/>
<EntryAdvancedFields bind:draft idPrefix="wle" {vectorizationEnabled} />
