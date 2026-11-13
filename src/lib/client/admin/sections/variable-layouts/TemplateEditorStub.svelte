<script lang="ts">
	/** Test stand-in for `TemplateEditor` (CodeMirror is too heavy for happy-dom). */
	let {
		value,
		oninput,
		label = "Source",
		readonly = false
	}: {
		value: string
		oninput: (v: string) => void
		label?: string
		readonly?: boolean
		[k: string]: unknown
	} = $props()
</script>

<textarea
	aria-label={label}
	{readonly}
	{value}
	oninput={(e) => oninput(e.currentTarget.value)}
></textarea>
