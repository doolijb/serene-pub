<script lang="ts">
	// Test-only: gives `createSessionPageData` the component context its
	// `onMount` needs (sessionStoryTimeline.dom.test.svelte.ts).
	import {
		createSessionPageData,
		type SessionPageDataDeps
	} from "./sessionPageData.svelte"

	let {
		deps,
		out
	}: {
		deps: SessionPageDataDeps
		out: { api?: ReturnType<typeof createSessionPageData> }
	} = $props()
	// svelte-ignore state_referenced_locally
	out.api = createSessionPageData(deps)
</script>
