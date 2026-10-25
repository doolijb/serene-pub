<!--
	@component
	InlineError — one line under a field or a form saying what went wrong:
	`role="alert"`, `text-error-600-400` (the one error shade, §2.3), 13px like
	`FieldHelp`, a 14px alert icon before the words. It replaced three shades
	(`error-500`, `600-400`, `700-300`) and the per-site sizes
	(STYLE-GUIDE §6.4 "Field help"; L13, 2026-10-24).

	Give it the `id` the control's `aria-describedby` names when it belongs to
	one control, and mount it only while there is an error.
-->
<script lang="ts">
	import type { Snippet } from "svelte"
	import type { HTMLAttributes } from "svelte/elements"
	import * as Icons from "@lucide/svelte"

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

<p
	role="alert"
	class="text-error-600-400 flex items-start gap-1.5 text-chip {className}"
	{...rest}
>
	<Icons.CircleAlert size={14} class="mt-0.5 shrink-0" aria-hidden="true" />
	<span class="min-w-0">{@render children?.()}</span>
</p>
