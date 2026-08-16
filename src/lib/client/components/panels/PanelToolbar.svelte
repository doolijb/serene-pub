<script lang="ts">
	import type { Snippet } from "svelte"

	interface Props {
		/** Accessible name for the group. Required — an unlabeled group is
		    worse than no group at all, and every hand-rolled action row in the
		    app that got this right supplied one. */
		label: string
		children: Snippet
		/** Defaults to "group", NOT "toolbar". role="toolbar" carries a
		    keyboard contract (arrow keys move focus between controls, the
		    whole toolbar is a single tab stop) that this app has never
		    implemented — the two sites that used the role were asserting
		    behaviour they didn't have. Only pass "toolbar" once roving focus
		    actually exists. */
		role?: "group" | "toolbar"
		justify?: "start" | "between" | "end"
		class?: string
	}

	// `class` is a reserved word, so it cannot be a binding identifier and has
	// to be renamed on destructure.
	let {
		label,
		children,
		role = "group",
		justify = "start",
		class: className = ""
	}: Props = $props()

	const justifyClass = $derived(
		{
			start: "justify-start",
			between: "justify-between",
			end: "justify-end"
		}[justify]
	)
</script>

<div {role} aria-label={label} class="panel-actions {justifyClass} {className}">
	{@render children()}
</div>
