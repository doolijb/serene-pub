<script lang="ts">
	import { adminPage as page } from "$lib/client/admin/adminRouter.svelte"
	import TemplateChangeForm from "$lib/client/components/admin/TemplateChangeForm.svelte"

	let id = $derived(Number(page.params.id))
</script>

{#key id}
	<TemplateChangeForm kind="context" basePath="/admin/context-templates" {id} />
{/key}
