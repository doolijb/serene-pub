<script lang="ts">
	import type { EntryEditorProps } from "./types"
	import EntryCoreFields from "./EntryCoreFields.svelte"
	import { kindLabel } from "./kinds"

	/**
	 * The editor a kind nobody has curated falls back to.
	 *
	 * Name, content and keywords, and it says so: a bootstrap that looks like
	 * one, so a shape reaching it reads as a door still to be written rather
	 * than as a finished screen. Every kind this build ships has a door of its
	 * own, so nothing should land here.
	 */
	let {
		draft = $bindable(),
		bindings = $bindable(),
		vectorizationEnabled
	}: EntryEditorProps = $props()
</script>

<p class="text-surface-700-300 text-xs italic">
	{kindLabel(draft.typeId ?? "")} has no editor of its own yet, so this shows the
	fields every entry has.
</p>
<EntryCoreFields
	bind:draft
	bind:bindings
	idPrefix="gen"
	{vectorizationEnabled}
/>
