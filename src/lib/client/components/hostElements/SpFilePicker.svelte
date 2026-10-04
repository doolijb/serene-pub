<script lang="ts">
	/**
	 * `sp-file-picker` (vocabulary 1.3) — opens the device's file picker
	 * when its body is clicked. The body is the widget's own control (a
	 * button it draws and names), so the widget's look and label hold; the
	 * picker is this element's. `files` carries `{ files: File[] }`.
	 *
	 * The one way a widget reaches a file: a file `input` is not in the
	 * vocabulary, so the input here is the host's own, hidden, and opened in
	 * the person's own click — a browser opens a picker only inside a
	 * gesture, which a message round trip would lose.
	 */
	import { flag, type SpElementProps } from "./spElement.svelte"

	let { attrs, emit, slot }: SpElementProps = $props()
	let input: HTMLInputElement | null = $state(null)

	function open(e: MouseEvent) {
		if (flag(attrs.disabled)) return
		// Only a press of the control itself (or what it holds), never the
		// input's own synthetic click bubbling back.
		if (e.target === input) return
		input?.click()
	}

	function picked() {
		const files = input?.files ? [...input.files] : []
		// Cleared, so choosing the same file again is a change again.
		if (input) input.value = ""
		if (files.length) emit("files", { files })
	}
</script>

<!-- The click is the body's control's — a real button the widget drew and
     named; this wrapper only hears it bubble. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<span class="sp-file-picker" style="display: contents" onclick={open} {@attach slot()}></span>
<input
	bind:this={input}
	type="file"
	hidden
	tabindex="-1"
	accept={attrs.accept ?? undefined}
	multiple={flag(attrs.multiple)}
	onchange={picked}
/>
