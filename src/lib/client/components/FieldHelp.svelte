<!--
	@component
	FieldHelp — the one sentence under a field or a settings section that says
	what it does: 13px (`text-chip`), muted (`text-surface-600-400`). It replaced
	the hand-written `text-xs` and `text-sm` help paragraphs, which drew the same
	job at two sizes (STYLE-GUIDE §6.4 "Field help"; L13, 2026-10-24).

	Give it the `id` the control's `aria-describedby` names. `class` adds layout
	only (`mt-1`, a grid span) — never another size or colour. Not an empty
	state ("No rows."), a loading line or a status: those keep their own words
	and roles. An error under a field is `InlineError`.
-->
<script lang="ts">
	import type { Snippet } from "svelte"
	import type { HTMLAttributes } from "svelte/elements"

	let {
		class: className = "",
		children,
		...rest
	}: {
		class?: string
		children?: Snippet
	} & Omit<HTMLAttributes<HTMLParagraphElement>, "class" | "children"> =
		$props()
</script>

<p class="text-surface-600-400 text-chip {className}" {...rest}>
	{@render children?.()}
</p>
