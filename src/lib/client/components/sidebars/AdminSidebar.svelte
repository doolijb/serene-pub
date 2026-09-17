<script lang="ts">
	/**
	 * The **Admin** sidebar view — the administration area's section list,
	 * lifted out of the admin route's own rail and into the shell's one
	 * sidebar (phase S3).
	 *
	 * It is a list of destinations and nothing else. Every list, change form
	 * and confirm still happens in the page: the view navigates and the page
	 * draws, which is why the foot says so out loud rather than leaving a
	 * person to work out why a section opened somewhere other than here.
	 *
	 * The sections come from `$lib/client/shell/adminNav` — the same table the
	 * Jump overlay offers as **Admin pages** — so a section renamed, added or
	 * hidden (Users, when accounts are off) moves in all three places at once.
	 * `icon` is a lucide name resolved here, which is what keeps that module
	 * free of component imports.
	 */
	import { getContext } from "svelte"
	import { page } from "$app/state"
	import * as Icons from "@lucide/svelte"
	import { adminNavFor } from "$lib/client/shell/adminNav"

	const panelsCtx: PanelsCtx = getContext("panelsCtx")
	const systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")

	let nav = $derived(
		adminNavFor(systemSettingsCtx?.settings?.isAccountsEnabled !== false)
	)

	let path = $derived(page.url.pathname)
	/** The same rule the admin route's rail used, so the selected row cannot drift. */
	const isActive = (href: string) =>
		path === href || path.startsWith(href + "/")

	/**
	 * A row is an `<a>`, so it keeps middle-click and "open in new tab" and
	 * SvelteKit's router does the navigating. All this adds is the shell's
	 * own housekeeping, in the order `SessionsSidebar` already does it when
	 * one of its rows navigates: drop out of full page, and COLLAPSE the
	 * mobile sheet rather than closing the tab — closing would forget the
	 * view, and on desktop `mobilePanel` is null so this is a no-op and the
	 * sidebar stays open beside the page it just opened.
	 */
	function handleRowClick() {
		panelsCtx.fullPageView = null
		if (panelsCtx.isMobileMenuOpen) panelsCtx.isMobileMenuOpen = false
		if (panelsCtx.mobilePanel) panelsCtx.mobilePanel = null
	}
</script>

<div class="text-foreground flex h-full min-h-0 flex-col">
	<nav
		class="min-h-0 flex-1 overflow-y-auto pb-2"
		aria-label="Admin sections"
	>
		{#each nav as section (section.group)}
			<h3 class="text-surface-500 px-3 pt-4 pb-1 text-[11px]">
				{section.group}
			</h3>
			<ul>
				{#each section.items as item (item.href)}
					{@const IconCmp = Icons[item.icon] as any}
					{@const selected = isActive(item.href)}
					<li>
						<a
							href={item.href}
							aria-current={selected ? "page" : undefined}
							class="focus-visible:outline-primary-500 flex min-h-[44px] items-center gap-3 rounded-[10px] px-3 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 {selected
								? 'bg-surface-900'
								: 'hover:bg-surface-900'}"
							style={selected
								? "box-shadow: inset 3px 0 0 var(--color-primary-500);"
								: undefined}
							onclick={handleRowClick}
						>
							<IconCmp
								size={18}
								class="text-surface-400 shrink-0"
								aria-hidden="true"
							/>
							<span
								class="min-w-0 flex-1 truncate text-[15px] font-medium"
							>
								{item.label}
							</span>
							<Icons.ChevronRight
								size={16}
								class="text-surface-500 shrink-0"
								aria-hidden="true"
							/>
						</a>
					</li>
				{/each}
			</ul>
		{/each}
	</nav>

	<p
		class="border-surface-900 text-surface-500 shrink-0 border-t px-4 py-3 text-xs"
	>
		Lists and change forms open in the page
	</p>
</div>
