<script lang="ts">
	// Test-only: gives `createSessionLayoutData` the component context its
	// `onDestroy` needs (sessionLayoutData.dom.test.svelte.ts).
	import {
		createSessionLayoutData,
		type SessionLayoutData,
		type SessionLayoutDataDeps
	} from "./sessionLayoutData.svelte"

	let {
		deps,
		out
	}: { deps: SessionLayoutDataDeps; out: { api?: SessionLayoutData } } =
		$props()
	// svelte-ignore state_referenced_locally
	out.api = createSessionLayoutData(deps)
</script>
