<script lang="ts">
	/**
	 * The **Admin** view: the whole administration area, as one sidebar view
	 * (ruled 2026-09-27 — admin is purely the sidebar and Focus, never a
	 * page). It is two things side by side at desk width, the section list
	 * and the section, and one at a time below it: the 400px dock and a
	 * phone's sheet show the list, and a picked section with a way back.
	 *
	 * Sections are addressed like pages (`/admin/prompts/12`) but routed
	 * here, by `adminRouter`; the address reaches the bar only while this
	 * view is in Focus. Links inside the view to admin addresses move the
	 * section instead of loading a page (`interceptAdminLink`).
	 */
	import { getContext, onMount, setContext, type Component } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { adminNavFor } from "$lib/client/shell/adminNav"
	import { adminHealth } from "./adminHealth.svelte"
	import { adminRouter, interceptAdminLink } from "./adminRouter.svelte"
	import { sectionHrefFor } from "./adminRoutes"
	import {
		ADMIN_INTEREST_CONTEXT,
		interestContextValue
	} from "$lib/client/sockets/interest.svelte"
	import { ViewModeTracker } from "$lib/client/shell/viewMode.svelte"
	import { warnBeforeUnload } from "$lib/client/forms/unsavedEdits.svelte"
	import AdminUnsavedChangesModal from "$lib/client/components/modals/AdminUnsavedChangesModal.svelte"

	interface Props {
		/** The shell's close gate for this view (Layout's `viewCloseGates`). */
		onclose?: () => Promise<boolean> | undefined
	}
	let { onclose = $bindable() }: Props = $props()

	const systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")
	const userCtx: { user: SelectUser } = getContext("userCtx")

	/**
	 * The admin-only half of the interest registry, provided HERE and
	 * nowhere else (socket-interest plan, ruling 6b): a restricted key is
	 * declared from inside this tree, which the shell mounts only for
	 * administrators. The server's handlers check again; that check is the
	 * boundary.
	 */
	setContext(ADMIN_INTEREST_CONTEXT, interestContextValue())

	onMount(() => adminHealth.connect(!!userCtx?.user?.isAdmin))

	/**
	 * Keep Needs you current while this view is open: after moving between
	 * sections (the usual moment something was just fixed) and once a minute
	 * while the tab is visible, so a fix made elsewhere — the setup wizard
	 * choosing a chat model, another admin — clears its row without a visit
	 * to Overview.
	 */
	let seenSection: string | null = null
	$effect(() => {
		const path = adminRouter.path
		if (seenSection !== null && seenSection !== path) adminHealth.refresh()
		seenSection = path
	})
	onMount(() => {
		const tick = setInterval(() => {
			if (document.visibilityState === "visible") adminHealth.refresh()
		}, 60_000)
		return () => clearInterval(tick)
	})
	let attention = $derived(adminHealth.attention)

	let nav = $derived(
		adminNavFor(systemSettingsCtx?.settings?.isAccountsEnabled !== false)
	)
	let hrefs = $derived(nav.flatMap((g) => g.items.map((i) => i.href)))
	let activeHref = $derived(sectionHrefFor(adminRouter.path, hrefs))
	let activeLabel = $derived(
		nav.flatMap((g) => g.items).find((i) => i.href === activeHref)?.label ??
			"Admin"
	)

	const vm = new ViewModeTracker()
	/**
	 * Below desk width the list and the section take turns. Opening the view
	 * on the Overview shows the list first (the Needs you card and the rows
	 * ARE the overview at that width); opening it anywhere deeper shows that
	 * section.
	 */
	let showList = $state(adminRouter.path === "/admin")

	async function open(href: string) {
		if (await adminRouter.go(href)) showList = false
	}

	/* ── unsaved edits ─────────────────────────────────────────────────
	 *
	 * A section tells the router it holds unsaved edits
	 * (`adminUnsavedEdits`); this view asks the one question before they
	 * are lost — another section, the view closing, Back, the section list
	 * replacing the section below desk width — and the tab asks before a
	 * reload while anything is unsaved.
	 */
	let discardOpen = $state(false)
	let discardResolve: ((discard: boolean) => void) | null = null
	function askDiscard(): Promise<boolean> {
		discardResolve?.(false)
		discardOpen = true
		return new Promise((resolve) => (discardResolve = resolve))
	}
	function answerDiscard(discard: boolean) {
		discardOpen = false
		discardResolve?.(discard)
		discardResolve = null
	}
	onMount(() => {
		adminRouter.setDiscardPrompt(askDiscard)
		onclose = () => adminRouter.confirmDiscard()
		return () => adminRouter.setDiscardPrompt(async () => true)
	})
	warnBeforeUnload(() => adminRouter.hasUnsavedEdits)

	async function showSectionList() {
		if (await adminRouter.confirmDiscard()) showList = true
	}

	/* ── the section on screen ─────────────────────────────────────────── */

	/* ── landing on a field ────────────────────────────────────────────
	 *
	 * `/admin/general#accounts` opens General and brings the Accounts card
	 * into view with a brief ring, so a "Needs you" fix or a settings search
	 * lands on the thing it named rather than the top of a long page. The
	 * target is an element id or a `data-field` name inside the section;
	 * sections load lazily, so it is looked for over a few frames.
	 */
	let contentEl = $state<HTMLElement | null>(null)
	$effect(() => {
		const { target, seq } = adminRouter.land
		if (!target || !seq) return
		// On a phone-width view the section list may be up; the target is
		// in the section.
		showList = false
		let frames = 0
		let raf = 0
		const seek = () => {
			const root = contentEl
			const found =
				root?.querySelector<HTMLElement>(`[data-field="${CSS.escape(target)}"]`) ??
				root?.querySelector<HTMLElement>(`#${CSS.escape(target)}`) ??
				null
			// A card's heading id names the card: ring the card, not the words.
			const el = found?.matches("h1, h2, h3, h4")
				? (found.closest<HTMLElement>("section, .panel-card") ?? found)
				: found
			if (!el) {
				if (++frames < 180) raf = requestAnimationFrame(seek)
				return
			}
			el.scrollIntoView({ block: "center", behavior: "smooth" })
			el.classList.remove("sp-landed")
			void el.offsetWidth
			el.classList.add("sp-landed")
			setTimeout(() => el.classList.remove("sp-landed"), 1800)
			// A field itself takes the keyboard; a card leaves it where it is.
			if (el.matches("input, select, textarea, button, [tabindex]"))
				el.focus({ preventScroll: true })
		}
		raf = requestAnimationFrame(seek)
		return () => cancelAnimationFrame(raf)
	})

	let LayoutCmp = $state<Component<any> | null>(null)
	let PageCmp = $state<Component<any> | null>(null)
	/**
	 * The address the mounted page was loaded FOR. The page is keyed on this,
	 * never on the router's live path: the next page loads asynchronously, and
	 * keying on the live path would remount the outgoing page under the new
	 * address (with the new params) for the frames in between.
	 */
	let loadedPath = $state<string | null>(null)
	let layoutLoader: unknown = null
	let notFound = $state(false)

	$effect(() => {
		const match = adminRouter.match
		const path = adminRouter.path
		notFound = match.route === null && path !== "/admin"
		const route = match.route
		if (!route) return
		const wantLayout = route.layout ?? null
		Promise.all([wantLayout?.(), route.page()]).then(([l, p]) => {
			// A later click won the race: leave it be.
			if (adminRouter.path !== path) return
			if (wantLayout !== layoutLoader) {
				layoutLoader = wantLayout
				LayoutCmp = l?.default ?? null
			}
			PageCmp = p.default
			loadedPath = path
		})
	})
</script>

{#snippet sectionList()}
	<nav class="flex flex-col pb-3" aria-label="Admin sections">
		{#if attention.length}
			<!-- The Overview's Needs you list, counted; hidden when empty. -->
			<section
				class="panel-card mx-2 mt-2 mb-1 flex flex-col gap-2"
				aria-labelledby="admin-needs-you"
			>
				<div class="flex items-center gap-2">
					<span
						class="size-2 shrink-0 rounded-full {adminHealth.worst ===
						'error'
							? 'bg-error-500'
							: 'bg-primary-500'}"
						aria-hidden="true"
					></span>
					<h3 id="admin-needs-you" class="text-sm font-medium">
						Needs you
					</h3>
					<span class="text-surface-600-400 text-xs">
						{attention.length}
					</span>
				</div>
				<ul class="flex flex-col gap-1">
					{#each attention.slice(0, 3) as item (item.id)}
						<li>
							<a
								href={item.action.href}
								class="text-surface-800-200 hover:text-primary-600-400 block truncate text-[13px] underline-offset-2 hover:underline"
								onclick={() => (showList = false)}
							>
								{item.title}
							</a>
						</li>
					{/each}
				</ul>
				{#if attention.length > 3}
					<a
						href="/admin"
						class="text-surface-600-400 text-xs hover:underline"
						onclick={() => (showList = false)}
					>
						{attention.length - 3} more on the Overview
					</a>
				{/if}
			</section>
		{/if}
		{#each nav as group (group.group)}
			{#if group.group}
				<h3 class="text-surface-600-400 px-3 pt-4 pb-1 text-xs">
					{group.group}
				</h3>
			{/if}
			<ul class={group.group ? "" : "pt-2"}>
				{#each group.items as item (item.href)}
					{@const IconCmp = Icons[item.icon] as any}
					{@const selected = item.href === activeHref}
					{@const level = adminHealth.levelFor(item.href)}
					<li>
						<a
							href={item.href}
							aria-current={selected ? "page" : undefined}
							class="focus-visible:outline-primary-500 mx-2 flex min-h-10 items-center gap-3 rounded-[10px] px-3 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 {selected
								? 'sidebar-row-active'
								: 'hover:bg-surface-200-800'}"
							onclick={(e) => {
								e.preventDefault()
								open(item.href)
							}}
						>
							<IconCmp
								size={17}
								class="text-surface-600-400 shrink-0"
								aria-hidden="true"
							/>
							<span class="min-w-0 flex-1 truncate text-sm font-medium">
								{item.label}
							</span>
							{#if level}
								<span
									class="size-2 shrink-0 rounded-full {level ===
									'error'
										? 'bg-error-500'
										: 'bg-primary-500'}"
									aria-hidden="true"
								></span>
								<span class="sr-only">
									{level === "error" ? "(has a problem)" : "(needs you)"}
								</span>
							{/if}
						</a>
					</li>
				{/each}
			</ul>
		{/each}
	</nav>
{/snippet}

{#snippet pageSnippet()}
	{#if PageCmp}
		{#key loadedPath}
			<PageCmp />
		{/key}
	{/if}
{/snippet}

{#snippet section()}
	<!-- The container the sections measure themselves against (their
	     `@container content` rules), and the reading width they sit in. -->
	<div
		bind:this={contentEl}
		class="admin-content flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-6"
	>
		{#if notFound}
			<div class="m-auto flex flex-col items-center gap-3 text-center">
				<p class="text-surface-600-400 text-sm">
					There is no admin page at {adminRouter.path}.
				</p>
				<a href="/admin" class="btn btn-sm preset-tonal-surface">
					Open the Overview
				</a>
			</div>
		{:else if LayoutCmp}
			<LayoutCmp children={pageSnippet} />
		{:else}
			{@render pageSnippet()}
		{/if}
	</div>
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	use:vm.observe
	data-view-links
	class="text-foreground flex h-full min-h-0 flex-1"
	onclickcapture={interceptAdminLink}
>
	{#if vm.mode === "desk"}
		<div
			class="border-surface-200-800 w-60 shrink-0 overflow-y-auto border-r"
		>
			{@render sectionList()}
		</div>
		{@render section()}
	{:else if showList}
		<div class="min-h-0 flex-1 overflow-y-auto">
			{@render sectionList()}
		</div>
	{:else}
		<div class="flex min-h-0 flex-1 flex-col">
			<button
				type="button"
				class="text-surface-600-400 hover:text-surface-950-50 focus-visible:outline-primary-500 border-surface-200-800 flex min-h-11 shrink-0 items-center gap-1.5 border-b px-3 text-sm focus-visible:outline-2"
				onclick={showSectionList}
			>
				<Icons.ChevronLeft size={16} aria-hidden="true" />
				All sections
				<span class="text-surface-500 mx-1">·</span>
				<span class="text-surface-950-50 truncate font-medium"
					>{activeLabel}</span
				>
			</button>
			{@render section()}
		</div>
	{/if}
</div>

<AdminUnsavedChangesModal
	open={discardOpen}
	onOpenChange={(e) => {
		if (!e.open) answerDiscard(false)
	}}
	onConfirm={() => answerDiscard(true)}
	onCancel={() => answerDiscard(false)}
/>

<style>
	.admin-content {
		container-type: inline-size;
		container-name: content;
	}
</style>
