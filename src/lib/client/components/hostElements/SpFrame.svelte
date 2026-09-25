<script lang="ts">
	/**
	 * `sp-frame` — a real document inside the widget (R24), through the
	 * existing frame machinery: opaque origin, CSP, a MessageChannel port.
	 * `src` is a document the owning plugin ships; `props` is JSON. The
	 * frame's actions and invokes are raised as this element's events.
	 */
	import PluginFrame from "$lib/client/components/frames/PluginFrame.svelte"
	import { isServableEntry } from "@serene-pub/sdk"
	import { ownerOf } from "./context.svelte"
	import { vouchFor } from "./activation"
	import type { SpElementProps } from "./spElement.svelte"

	let { attrs, emit, host }: SpElementProps = $props()
	const owner = $derived(ownerOf(host))
	const src = $derived(
		owner && owner !== "core" && attrs.src && isServableEntry(attrs.src)
			? `/plugin-ui/${owner}/${attrs.src}`
			: null
	)
	const frameProps = $derived.by(() => {
		try {
			const v = attrs.props ? JSON.parse(attrs.props) : undefined
			return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
		} catch {
			return undefined
		}
	})
	// A document its plugin does not serve is the component's mistake: say so.
	$effect(() => {
		if (attrs.src && !src) emit("error", { message: `'${attrs.src}' is not a document this widget's plugin serves` })
	})
</script>

{#if src}
	<!-- The frame's presses are the widget's own: `invoke` is raised
	     unresolved, and the component invokes through its widget (its
	     actions, its gate — which a person pressing inside the document
	     satisfies through `vouchFor`, and nothing else does). -->
	<PluginFrame
		{src}
		title={attrs.title ?? "Embedded document"}
		surface="panel"
		props={frameProps}
		onInvoke={(key, args, personBehind) => {
			// A person pressing inside the document vouches for the press at the
			// component's own gate — host-side, never a field the worker sees.
			if (personBehind) vouchFor(host)
			emit("invoke", { key, ...args })
		}}
		onAction={(fn, _messageId, payload, action, blockId) => emit("action", { fn, payload, action, blockId })}
		class="sp-frame-document"
	/>
{:else}
	<p class="sp-frame-missing">
		{attrs.src ? "This document is not one its plugin serves." : "No document to show."}
	</p>
{/if}
