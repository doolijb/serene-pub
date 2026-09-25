<script lang="ts">
	/**
	 * A test's native mount of core's messages widget (C30 parity): the
	 * native widget context a `WidgetHost` would provide, handed in whole.
	 */
	import { setContext } from "svelte"
	import { WIDGET_CONTEXT_KEY, type WidgetContextRef } from "$lib/shared/widgets/context"
	import MessagesWidget from "../MessagesWidget.svelte"

	let { widget }: { widget: WidgetContextRef } = $props()
	// svelte-ignore state_referenced_locally
	setContext(WIDGET_CONTEXT_KEY, widget)
</script>

<MessagesWidget />
