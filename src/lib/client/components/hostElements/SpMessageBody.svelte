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
	import { ownerOf } from "./context.svelte"
	import { flag, type SpElementProps } from "./spElement.svelte"

	let { attrs, host, emit }: SpElementProps = $props()
	const streaming = $derived(flag(attrs.streaming))
	const owner = $derived(ownerOf(host))

	const html = $derived.by(() => {
		const rendered = renderMarkdownWithQuotedText(attrs.text ?? "")
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
