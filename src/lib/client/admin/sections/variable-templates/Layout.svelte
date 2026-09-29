<script lang="ts">
	/** Variable templates as a list beside the template it opens (`TemplateChangelist`). */
	import TemplateChangelist from "$lib/client/components/admin/TemplateChangelist.svelte"

	let { children } = $props()
</script>

<TemplateChangelist
	kind="variable"
	title="Variable templates"
	description="How each context variable renders: the layout a variable's data takes when a context template references it."
	basePath="/admin/variable-templates"
>
	{@render children?.()}
</TemplateChangelist>
