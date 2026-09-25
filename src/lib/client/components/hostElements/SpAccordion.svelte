<script lang="ts">
	/** `sp-accordion` — owns which `sp-accordion-item`s are open; `change` carries `{ value }`. */
	import { flag, type SpElementProps } from "./spElement.svelte"

	let { attrs, emit, slot, state }: SpElementProps = $props()
	$effect(() => {
		state.open = (attrs.value ?? "").split(/\s+/).filter(Boolean)
	})
	// An item asks through the shared state; the answer is the host's.
	$effect.pre(() => {
		state.toggle = (value: string) => {
			const open = (state.open as string[]) ?? []
			const next = open.includes(value)
				? open.filter((v) => v !== value)
				: flag(attrs.multiple)
					? [...open, value]
					: [value]
			state.open = next
			emit("change", { value: next.join(" ") })
		}
	})
</script>

<div class="sp-accordion-items" {@attach slot()}></div>
