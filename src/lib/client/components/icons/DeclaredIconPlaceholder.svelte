<script lang="ts">
	/**
	 * The stand-in drawn while a lazily loaded icon arrives: an empty `<svg>`
	 * in lucide's own box, so nothing shifts when the icon replaces it. No
	 * children, no animation. Hidden from assistive tech — it labels nothing.
	 */
	import type { SVGAttributes } from "svelte/elements"

	interface Props extends SVGAttributes<SVGSVGElement> {
		/** Square box in px, as lucide's `size`. */
		size?: number | string
		/** Lucide's paint props: taken so they never land on the DOM. */
		color?: string
		strokeWidth?: number | string
		absoluteStrokeWidth?: boolean
		/** A site may pass lucide's `title`; the box has nothing to title. */
		title?: string
	}

	let {
		size = 24,
		color: _color,
		strokeWidth: _strokeWidth,
		absoluteStrokeWidth: _absoluteStrokeWidth,
		"aria-label": _label,
		title: _title,
		role: _role,
		class: className,
		...rest
	}: Props = $props()
</script>

<!-- The order is lucide's own (`Icon.svelte`): the caller's attributes, then
     `size` as the box, then its classes, so the box is the icon's exactly. -->
<svg
	xmlns="http://www.w3.org/2000/svg"
	viewBox="0 0 24 24"
	{...rest}
	width={size}
	height={size}
	class={["lucide-icon lucide", className]}
	aria-hidden="true"
></svg>
