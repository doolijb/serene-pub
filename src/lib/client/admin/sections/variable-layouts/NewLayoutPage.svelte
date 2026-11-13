<script lang="ts">
	import { adminPage as page } from "$lib/client/admin/adminRouter.svelte"
	import VariableLayoutForm from "./VariableLayoutForm.svelte"

	let variableId = $derived(page.params.variable ?? "")
	let from = $derived(Number(page.url.searchParams.get("from")) || null)
</script>

{#key `${variableId}|${from}`}
	<VariableLayoutForm {variableId} {from} />
{/key}
