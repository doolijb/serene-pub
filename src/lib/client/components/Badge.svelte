<!--
	@component
	Badge — a short label in a pill: a count, a status word, a kind, a "Default".
	The one recipe for the pills that were spelled by hand in 14 ways
	(STYLE-GUIDE §6.4, "Badges"; L13, 2026-10-24).

	- `tone` is a Skeleton colour role, always tonal: `surface` (the default,
	  one step off the ground), `primary`, `success`, `warning`, `error`. A
	  badge is never filled — a filled fill is a button (§2.4).
	- `size`: `sm` is 11px (`text-meta`, `px-1.5`), for counts and tags beside a
	  row's name; `md` is 12px (`text-xs`, `px-2`), for a badge that stands alone.
	- `class` adds layout (`shrink-0`, `truncate`, `font-mono`, a muted text
	  colour) — never another size, padding or fill.

	Not the `sp-badge` host element (widget markup, its `tone` a skin hook) and
	not a toggle chip (pressed state is `preset-pressed`, §2.4).
-->
<script lang="ts" module>
	export type BadgeTone = "surface" | "primary" | "success" | "warning" | "error"
	export type BadgeSize = "sm" | "md"
</script>

<script lang="ts">
	import type { Snippet } from "svelte"
	import type { HTMLAttributes } from "svelte/elements"

	const TONE: Record<BadgeTone, string> = {
		surface: "preset-tonal-surface",
		primary: "preset-tonal-primary",
		success: "preset-tonal-success",
		warning: "preset-tonal-warning",
		error: "preset-tonal-error"
	}

	const SIZE: Record<BadgeSize, string> = {
		sm: "px-1.5 py-0.5 text-meta",
		md: "px-2 py-0.5 text-xs"
	}

	let {
		tone = "surface",
		size = "md",
		class: className = "",
		children,
		...rest
	}: {
		tone?: BadgeTone
		size?: BadgeSize
		class?: string
		children?: Snippet
	} & Omit<HTMLAttributes<HTMLSpanElement>, "class" | "children"> = $props()
</script>

<span
	class="rounded-full {SIZE[size]} {TONE[tone]} {className}"
	data-badge={tone}
	{...rest}>{@render children?.()}</span
>
