<script lang="ts">
	/** `sp-dialog` — a modal the host focus-traps; Escape and the backdrop close it. */
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { flag, portalScope, type SpElementProps } from "./spElement.svelte"

	let { attrs, writes, emit, slot, host }: SpElementProps = $props()
	let open = $state(false)
	$effect(() => {
		void writes.open
		open = flag(attrs.open)
	})
	const scope = $derived(portalScope(host))
</script>

<Dialog
	{open}
	onOpenChange={(e) => {
		open = e.open
		emit("open-change", { open: e.open })
	}}
>
	<Portal>
		<Dialog.Backdrop class="sp-dialog-backdrop fixed inset-0 z-50" {...scope} />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4" {...scope}>
			<Dialog.Content class="sp-dialog-panel" aria-label={attrs.label ?? undefined}>
				<header class="sp-dialog-header">
					<Dialog.Title class="sp-dialog-title">
						{#snippet element(attributes)}
							<h2 {...attributes as Record<string, unknown>} class="sp-dialog-title" {@attach slot("title")}></h2>
						{/snippet}
					</Dialog.Title>
					<Dialog.CloseTrigger class="sp-dialog-close" aria-label="Close">
						<Icons.X size={16} aria-hidden="true" />
					</Dialog.CloseTrigger>
				</header>
				<div class="sp-dialog-body" {@attach slot()}></div>
				<footer class="sp-dialog-footer" {@attach slot("footer")}></footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
