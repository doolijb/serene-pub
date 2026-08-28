<script lang="ts">
	import TemplateChangelist from "$lib/client/components/admin/TemplateChangelist.svelte"
</script>

<TemplateChangelist
	kind="context"
	title="Context templates"
	description="How each pipeline step renders its context. Shared across pipelines — a template belongs to a step, not to the pipeline using it."
	basePath="/admin/context-templates"
	storageKey="serene-pub:adminView:contextTemplates"
/>
