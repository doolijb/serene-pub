<script lang="ts">
	/** Test fixture: a plain textarea standing in for the rich content field. */
	let { content = $bindable() }: { content: string } & Record<string, any> =
		$props()
</script>

<textarea aria-label="Content" bind:value={content}></textarea>
