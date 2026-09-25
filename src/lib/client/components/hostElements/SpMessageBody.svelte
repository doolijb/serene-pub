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
	import DOMPurify from "dompurify"
	import { hostAttributeValueFinding } from "@serene-pub/sdk"
	import { renderMarkdownWithQuotedText } from "$lib/client/utils/markdownToHTML"
	import { ownerOf } from "./context.svelte"
	import { flag, type SpElementProps } from "./spElement.svelte"

	let { attrs, host, emit }: SpElementProps = $props()
	const streaming = $derived(flag(attrs.streaming))
	const owner = $derived(ownerOf(host))

	const STRICT = {
		FORBID_TAGS: [
			"style", "form", "input", "button", "textarea", "select", "option", "iframe", "frame",
			"object", "embed", "link", "meta", "base", "svg", "math", "template", "video", "audio", "source"
		],
		FORBID_ATTR: ["id", "name", "style", "target", "rel", "srcset", "formaction", "action"]
	}

	function strict(html: string): string {
		const frag = DOMPurify.sanitize(html, { ...STRICT, RETURN_DOM_FRAGMENT: true }) as DocumentFragment
		for (const a of Array.from(frag.querySelectorAll("a"))) {
			const href = a.getAttribute("href") ?? ""
			if (hostAttributeValueFinding("a", "href", href)) a.removeAttribute("href")
			else if (!href.startsWith("#")) {
				a.setAttribute("target", "_blank")
				a.setAttribute("rel", "noopener noreferrer")
			}
		}
		for (const img of Array.from(frag.querySelectorAll("img")))
			if (hostAttributeValueFinding("img", "src", img.getAttribute("src") ?? "")) img.remove()
		const box = document.createElement("div")
		box.appendChild(frag)
		return box.innerHTML
	}

	const html = $derived.by(() => {
		const rendered = renderMarkdownWithQuotedText(attrs.text ?? "")
		return owner && owner !== "core" ? strict(rendered) : rendered
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
