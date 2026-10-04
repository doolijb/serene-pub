<script lang="ts">
	/**
	 * The breadcrumb trail every admin page opens with (Django admin's
	 * breadcrumbs): Admin › <group> › <section> › … › <this page>. Drawn by
	 * `AdminPageHeader`, so a page never builds its own; the trail comes from
	 * the address and the section list (`breadcrumbs.ts`). Nothing on the
	 * Overview, the root.
	 *
	 * 13px muted, one line; the steps before the last two drop out under
	 * 36rem of pane (the dock) so the trail never wraps to three lines — the
	 * section and the page are what the reader needs there.
	 */
	import * as Icons from "@lucide/svelte"
	import { adminRouter } from "$lib/client/admin/adminRouter.svelte"
	import { ADMIN_NAV } from "$lib/client/shell/adminNav"
	import { adminCrumbs, type AdminCrumb } from "./breadcrumbs"

	interface Props {
		/** The page on screen, when it is not the section's own list. */
		current?: string
		trail?: readonly AdminCrumb[]
		/** A step that is not an address ("Delete"): always last. */
		leaf?: string
		/** With `leaf` on the section's own address: the section crumb's action. */
		sectionOnclick?: () => void
	}
	let { current, trail, leaf, sectionOnclick }: Props = $props()

	const crumbs = $derived(
		adminCrumbs(adminRouter.path, ADMIN_NAV, { current, trail, leaf, sectionOnclick })
	)
</script>

{#if crumbs.length}
	<nav aria-label="Breadcrumb" class="mb-2 text-[13px]">
		<ol class="text-surface-600-400 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
			{#each crumbs as crumb, i (i)}
				{@const last = i === crumbs.length - 1}
				{@const early = i < crumbs.length - 2}
				<li
					class="flex min-w-0 items-center gap-1.5 {early
						? 'hidden @min-[36rem]/content:flex'
						: ''}"
					aria-current={last ? "page" : undefined}
				>
					{#if crumb.href && !last}
						<a
							href={crumb.href}
							class="hover:text-surface-950-50 inline-flex min-h-8 items-center underline-offset-2 hover:underline"
						>
							{crumb.label}
						</a>
					{:else if crumb.onclick && !last}
						<button
							type="button"
							class="hover:text-surface-950-50 inline-flex min-h-8 items-center underline-offset-2 hover:underline"
							onclick={crumb.onclick}
						>
							{crumb.label}
						</button>
					{:else}
						<span class="truncate {last ? 'text-surface-950-50' : ''}">{crumb.label}</span>
					{/if}
					{#if !last}
						<Icons.ChevronRight size={12} class="shrink-0" aria-hidden="true" />
					{/if}
				</li>
			{/each}
		</ol>
	</nav>
{/if}
