<script lang="ts">
	/**
	 * Core's conversation, mounted as a remote (C7): the same widget the page
	 * mounts natively, built by the component bundler and run in core's UI
	 * worker. It reads the surrounding `WidgetHost`'s projection — the rows,
	 * the settings, the actions, the dossier — and hands exactly that to the
	 * component host, so the two copies are fed the same data by construction.
	 * The C7 gate runs the page this way (`?remote=1`) until the cutover.
	 */
	import ComponentMount from "$lib/client/components/host/ComponentMount.svelte"
	import { useWidgetContext } from "$lib/shared/widgets/context"
	import type { ActionDispatch } from "$lib/shared/widgets/invokeAction"
	import type { WidgetEventSource } from "$lib/shared/widgets/context"

	interface Props {
		actionDispatch?: ActionDispatch
		source?: WidgetEventSource
		onAction?: (
			fn: string,
			messageId?: number,
			payload?: Record<string, unknown>,
			action?: string,
			blockId?: string
		) => void
	}

	let { actionDispatch, source, onAction }: Props = $props()
	const ctx = useWidgetContext()
	const c = $derived(ctx?.current)
</script>

{#if c}
	<ComponentMount
		owner="core"
		src="/core-ui/messages"
		title="Conversation"
		session={c.session.v1}
		messages={c.messages.v1}
		settings={c.settings.v1}
		props={c.props.v1}
		actions={c.actions.v1}
		scoped={c.session_full ? { session_full: c.session_full.v1 } : undefined}
		surfaceId="messages"
		{actionDispatch}
		{source}
		{onAction}
		class="h-full"
	/>
{/if}
