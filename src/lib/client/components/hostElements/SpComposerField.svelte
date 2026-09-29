<script lang="ts">
	/**
	 * `sp-composer-field` — the composer's text field, host-owned: the caret
	 * stays on the page. `value` written by the component resets it; the send
	 * key (Enter without Shift, not mid-composition) raises `submit` unless
	 * `submit-on="none"`. The keys named in `keys` are the widget's (its `/`
	 * palette's arrows, Tab and Escape; an edit's Control+Enter): kept from
	 * the field and raised as `key`, with the modifiers held, since a widget
	 * in a worker cannot stop a key itself — read by the SDK's one reading of
	 * `keys` (`hostKeysMatch`), the one a plain `input`'s `keys` meets too.
	 * `autofocus` gives the field the caret as it lands (core's alone: the
	 * receiver drops a plugin's).
	 */
	import { hostKeyEventDetail, hostKeysMatch } from "@serene-pub/sdk"
	import { flag, type SpElementProps } from "./spElement.svelte"

	let { attrs, writes, emit }: SpElementProps = $props()
	let value = $state("")
	// A write resets the field — every write, even `""` onto `""` after
	// the person typed: the value is host-owned between writes.
	$effect(() => {
		void writes.value
		value = attrs.value ?? ""
	})
	const rows = $derived(Number(attrs.rows) > 0 ? Number(attrs.rows) : 3)

	let field: HTMLTextAreaElement | undefined = $state()
	// Once, as the field lands: after this flush, so a value written with
	// it is in the field and the caret goes to its end.
	let focused = false
	$effect(() => {
		if (focused || !field || !flag(attrs.autofocus)) return
		focused = true
		const f = field
		queueMicrotask(() => {
			f.focus({ preventScroll: true })
			f.setSelectionRange(f.value.length, f.value.length)
		})
	})
</script>

<!-- `textarea` is the design system's form control, not a look: without it
     a dark theme draws page-coloured text on a browser-white field. -->
<textarea
	bind:this={field}
	class={attrs["field-class"] ? `sp-composer-input ${attrs["field-class"]}` : "sp-composer-input textarea"}
	{rows}
	placeholder={attrs.placeholder ?? undefined}
	aria-label={attrs.label ?? attrs.placeholder ?? "Message"}
	aria-invalid={attrs["aria-invalid"] === "true" ? true : undefined}
	aria-describedby={attrs["aria-describedby"] ?? undefined}
	aria-controls={attrs["aria-controls"] ?? undefined}
	aria-activedescendant={attrs["aria-activedescendant"] ?? undefined}
	aria-autocomplete={(attrs["aria-autocomplete"] as "list" | null) ?? undefined}
	autocomplete="off"
	spellcheck={attrs.spellcheck === "false" ? false : true}
	disabled={flag(attrs.disabled)}
	bind:value
	oninput={() => emit("input", { value })}
	onchange={() => emit("change", { value })}
	onfocus={() => emit("focus")}
	onkeydown={(e) => {
		if (e.isComposing) return
		if (hostKeysMatch(attrs.keys, e)) {
			e.preventDefault()
			emit("key", hostKeyEventDetail(e))
			return
		}
		if (e.key !== "Enter" || e.shiftKey || attrs["submit-on"] === "none") return
		e.preventDefault()
		emit("submit", { value })
	}}
></textarea>
