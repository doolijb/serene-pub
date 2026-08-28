<script lang="ts">
	import { page } from "$app/state"
	import TemplateChangeForm from "$lib/client/components/admin/TemplateChangeForm.svelte"

	let id = $derived(Number(page.params.id))
</script>

{#key id}
	<TemplateChangeForm kind="context" basePath="/admin/context-templates" {id} />
{/key}
