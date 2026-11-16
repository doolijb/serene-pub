<script lang="ts">
	import { bookTimeline } from "./bookData.svelte"
	let { out }: { out: { value: boolean | null } } = $props()
	const t = bookTimeline()
	out.value = t.value
</script>
