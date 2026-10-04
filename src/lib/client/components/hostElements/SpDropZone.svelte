<script lang="ts">
	/**
	 * `sp-drop-zone` (vocabulary 1.3) — a region files can be dropped onto
	 * or pasted into; its body is the region. While files are dragged over
	 * it, the overlay (`sp-drop-zone-overlay`) says `label` (STYLE-GUIDE
	 * §6.7: "Drop to attach"). `files` carries `{ files, via }`.
	 *
	 * Only FILES are taken: a drag of text, or a paste of text into the
	 * field inside, stays the field's. `disabled` takes nothing and shows
	 * nothing — the field's own paste then works as it always did.
	 */
	import { flag, type SpElementProps } from "./spElement.svelte"

	let { attrs, emit, slot }: SpElementProps = $props()
	const disabled = $derived(flag(attrs.disabled))
	/** Enter/leave pairs, so a drag over a child does not flicker the overlay. */
	let depth = $state(0)
	const over = $derived(depth > 0 && !disabled)

	const carriesFiles = (e: DragEvent) =>
		!!e.dataTransfer && [...e.dataTransfer.types].includes("Files")

	function enter(e: DragEvent) {
		if (disabled || !carriesFiles(e)) return
		e.preventDefault()
		depth++
	}
	function leave(e: DragEvent) {
		if (disabled || !carriesFiles(e)) return
		depth = Math.max(0, depth - 1)
	}
	function dragOver(e: DragEvent) {
		if (disabled || !carriesFiles(e)) return
		e.preventDefault()
		if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"
	}
	function drop(e: DragEvent) {
		if (disabled || !carriesFiles(e)) return
		e.preventDefault()
		depth = 0
		const files = [...(e.dataTransfer?.files ?? [])]
		if (files.length) emit("files", { files, via: "drop" })
	}
	function paste(e: ClipboardEvent) {
		if (disabled) return
		const files = [...(e.clipboardData?.files ?? [])]
		if (!files.length) return
		e.preventDefault()
		emit("files", { files, via: "paste" })
	}
</script>

<div
	class="sp-drop-zone-region"
	role="group"
	aria-label={attrs.label ?? undefined}
	data-over={over ? "" : undefined}
	ondragenter={enter}
	ondragleave={leave}
	ondragover={dragOver}
	ondrop={drop}
	onpaste={paste}
>
	<div class="sp-drop-zone-body" {@attach slot()}></div>
	{#if over}
		<div class="sp-drop-zone-overlay" aria-hidden="true">
			<span>{attrs.label ?? "Drop to attach"}</span>
		</div>
	{/if}
</div>
