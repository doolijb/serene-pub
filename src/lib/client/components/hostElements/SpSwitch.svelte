<script lang="ts">
	/** `sp-switch` — host-owned; `change` carries `{ checked }`. */
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import { flag, type SpElementProps } from "./spElement.svelte"

	let { attrs, writes, emit }: SpElementProps = $props()
	let checked = $state(false)
	$effect(() => {
		void writes.checked
		checked = flag(attrs.checked)
	})
</script>

<Switch
	{checked}
	disabled={flag(attrs.disabled)}
	onCheckedChange={(e) => {
		checked = e.checked
		emit("change", { checked: e.checked })
	}}
>
	<Switch.Control class="sp-switch-control">
		<Switch.Thumb />
	</Switch.Control>
	{#if attrs.label}<Switch.Label class="sp-switch-label">{attrs.label}</Switch.Label>{/if}
	<Switch.HiddenInput />
</Switch>
