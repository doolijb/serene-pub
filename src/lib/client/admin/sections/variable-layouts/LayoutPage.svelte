<script lang="ts">
	import { adminPage as page } from "$lib/client/admin/adminRouter.svelte"
	import VariableLayoutForm from "./VariableLayoutForm.svelte"

	let variableId = $derived(page.params.variable ?? "")
	let id = $derived(Number(page.params.id))
</script>

{#key `${variableId}|${id}`}
	<VariableLayoutForm {variableId} {id} />
{/key}
