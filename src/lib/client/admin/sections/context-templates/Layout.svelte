<script lang="ts">
	/** Context templates as a list beside the template it opens (`TemplateChangelist`). */
	import TemplateChangelist from "$lib/client/components/admin/TemplateChangelist.svelte"

	let { children } = $props()
</script>

<TemplateChangelist
	kind="context"
	title="Context templates"
	description="How each pipeline step renders its context. Shared across pipelines: a template belongs to a step, not to the pipeline using it."
	basePath="/admin/context-templates"
>
	{@render children?.()}
</TemplateChangelist>
