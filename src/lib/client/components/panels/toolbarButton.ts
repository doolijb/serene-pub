/**
 * The classes a view toolbar's icon button wears (STYLE-GUIDE §6.3, the view
 * toolbar; notes 25, 2026-10-02).
 *
 * A function rather than a component because half of these buttons are not
 * `<button>`s this file could render: a filter popout's trigger is Skeleton's
 * `Popover.Trigger`, and a `⋯` is `RowMenu`'s own trigger. Both take a class
 * string, so the one recipe travels as one.
 *
 * 40px square, the filter box's height, so the find row is one even line;
 * tonal surface at rest — never bare, which on the sidebar's ground read as
 * an icon with no button around it — and tonal primary while it is ON (a
 * filter in force, a view mode chosen), the app's active-toggle treatment
 * (§2.4). Filled primary is a call to action and never means "on".
 */
export function toolbarButtonClass(active = false): string {
	return `btn grid size-10 shrink-0 place-items-center p-0 ${
		active ? "preset-tonal-primary" : "preset-tonal-surface"
	}`
}
