<script lang="ts">
	/** Test fixture: draws `declaredIconOf(name, fallback)` as a 16px icon. */
	import type { Component } from "svelte"
	import { declaredIconOf } from "./declaredIcon.svelte"

	let { name, fallback }: { name: string | null; fallback: Component<any> } =
		$props()
	const Icon = $derived(declaredIconOf(name, fallback))
</script>

<Icon size={16} aria-label="drawn" />
