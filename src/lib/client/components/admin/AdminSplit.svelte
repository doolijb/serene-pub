<script lang="ts">
	/**
	 * An admin section as a list beside what it opens — the admin form of
	 * `PanelSplit`, used from a section's `+layout.svelte`:
	 *
	 * ```svelte
	 * <AdminSplit hasDetail={!!page.params.id} emptyMessage="Pick a prompt.">
	 *   {#snippet list()} <AdminList compact … /> {/snippet}
	 *   {@render children?.()}
	 * </AdminSplit>
	 * ```
	 *
	 * The detail is the section's own `[id]/+page.svelte`, rendered as the
	 * layout's children, so the address (`/admin/prompts/12`) is the
	 * selection and Back walks the rows you opened. Desk width shows both
	 * panes; below `DESK_MIN_PX` the list and the detail take turns, exactly
	 * as the sidebar views do.
	 */
	import { setContext, type Snippet } from "svelte"
	import PanelSplit from "$lib/client/components/panels/PanelSplit.svelte"
	import { ViewModeTracker } from "$lib/client/shell/viewMode.svelte"

	interface Props {
		hasDetail: boolean
		list: Snippet
		children?: Snippet
		emptyMessage?: string
		listWidth?: string
	}

	let {
		hasDetail,
		list: listPane,
		children,
		emptyMessage = "Pick one from the list.",
		listWidth = "360px"
	}: Props = $props()

	const vm = new ViewModeTracker()

	/**
	 * The detail reads this to decide whether it needs its own way back:
	 * beside the list (desk) it does not; alone (compact) it shows
	 * "Back to <section>". `getContext(ADMIN_SPLIT)?.mode`.
	 */
	setContext(ADMIN_SPLIT, {
		get mode() {
			return vm.mode
		}
	})
</script>

<script lang="ts" module>
	/** Context key: `{ mode: "desk" | "compact" }` for an AdminSplit's detail. */
	export const ADMIN_SPLIT = Symbol("adminSplit")
</script>

<div
	use:vm.observe
	class="border-surface-200-800 flex min-h-[480px] flex-1 flex-col overflow-hidden rounded-xl border"
>
	<PanelSplit mode={vm.mode} {hasDetail} {emptyMessage} {listWidth}>
		{#snippet list()}
			{@render listPane()}
		{/snippet}
		{#snippet detail()}
			{@render children?.()}
		{/snippet}
	</PanelSplit>
</div>
