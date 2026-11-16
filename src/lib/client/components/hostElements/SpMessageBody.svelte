<script lang="ts">
	/**
	 * `sp-message-body` — a message's text rendered as the app renders
	 * messages: the same markdown-with-quotes renderer.
	 *
	 * ⚠ When a PLUGIN's component places it, `text` is whatever that
	 * component wrote, so the rendered HTML is held to the host-element
	 * rules as well (C2 review H1): no `<style>` (it would restyle the whole
	 * page — `contain` does not scope a style element), no forms or
	 * controls, no ids or names, links opened in a new tab without an
	 * opener, and images only from the app's own media or the plugin's own
	 * files — an https image is a request the page makes, a way out for what
	 * the component was shown. Core's own messages keep the app's renderer
	 * as it is.
	 */
	import {
		renderMarkdownWithQuotedText,
		strictSanitize
	} from "$lib/client/utils/markdownToHTML"
	import { untrack } from "svelte"
	import { ownerOf } from "./context.svelte"
	import { flag, type SpElementProps } from "./spElement.svelte"

	let { attrs, host, emit }: SpElementProps = $props()
	const streaming = $derived(flag(attrs.streaming))
	const owner = $derived(ownerOf(host))

	// While a body streams the markdown renders at most every 50 ms — a trailing
	// update always lands, and the same renderer runs. Not streaming, the text
	// renders at once, as it always has.
	const THROTTLE_MS = 50
	let shown = $state(untrack(() => attrs.text ?? ""))
	let lastSet = 0
	$effect(() => {
		const text = attrs.text ?? ""
		if (!streaming) {
			// Kept in step while idle, so a stream that starts on this body
			// renders from its current text, never from the last stream's.
			lastSet = 0
			untrack(() => (shown = text))
			return
		}
		const wait = THROTTLE_MS - (Date.now() - lastSet)
		if (wait <= 0) {
			lastSet = Date.now()
			untrack(() => (shown = text))
			return
		}
		const timer = setTimeout(() => {
			lastSet = Date.now()
			shown = text
		}, wait)
		return () => clearTimeout(timer)
	})
	const source = $derived(streaming ? shown : (attrs.text ?? ""))

	const html = $derived.by(() => {
		const rendered = renderMarkdownWithQuotedText(source)
		return owner && owner !== "core" ? strictSanitize(rendered) : rendered
	})
</script>

<!-- An image in the text is the text's own markup, so its click is heard
     here and raised as `open-image` — the widget decides what opening it means. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="sp-message-text"
	aria-busy={streaming}
	data-streaming={streaming ? "" : undefined}
	onclick={(e) => {
		const img = (e.target as Element | null)?.closest?.("img")
		if (img) emit("open-image", { src: img.getAttribute("src") ?? "" })
	}}
>
	{@html html}
</div>
