<script lang="ts">
	import TemplateChangelist from "$lib/client/components/admin/TemplateChangelist.svelte"
</script>

<TemplateChangelist
	kind="variable"
	title="Variable templates"
	description="How each context variable renders — the layout a variable's data takes when a context template references it."
	basePath="/admin/variable-templates"
	storageKey="serene-pub:adminView:variableTemplates"
/>
