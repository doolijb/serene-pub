<script lang="ts">
	import { onDestroy, onMount } from "svelte"
	import LorebooksWorkspace from "$lib/client/lorebooks/LorebooksWorkspace.svelte"
	import { loreRoute } from "$lib/client/lorebooks/loreRoute.svelte"

	/**
	 * The panel's host for the lorebook workspace. It owns nothing but the
	 * close gate: leaving by the panel's X asks the same question, of the same
	 * guard, as moving inside the workspace does.
	 */
	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}

	let { onclose = $bindable() }: Props = $props()

	onMount(() => {
		onclose = () => loreRoute.confirmLeave()
	})

	onDestroy(() => {
		onclose = undefined
	})
</script>

<LorebooksWorkspace />
