<script lang="ts">
	/**
	 * The **Admin** view: the whole administration area, as one sidebar view
	 * (ruled 2026-09-27 — admin is purely the sidebar and Focus, never a
	 * page). It is two things side by side at desk width, the section list
	 * (`SectionList`) and the section, and one at a time below it: the 400px
	 * dock and a phone's sheet show the list, and a picked section under a
	 * `PanelNavHeader` whose back returns to it.
	 *
	 * Not `PanelSplit kind="sections"`: the section pane's `px-5 py-6`
	 * scroller is a contract the sections lean on (`AdminChangeForm`'s
	 * sticky save row bleeds `-mx-5 -bottom-6` into it, `AdminDeleteConfirm`
	 * scrolls `.admin-content`), which the split's `p-4` pane and 1120px cap
	 * would break, so the view lays out its own two columns.
	 *
	 * Sections are addressed like pages (`/admin/prompts/12`) but routed
	 * here, by `adminRouter`; the address reaches the bar only while this
	 * view is in Focus. Links inside the view to admin addresses move the
	 * section instead of loading a page (`interceptAdminLink`).
	 */
	import { getContext, onMount, setContext, untrack, type Component } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { page } from "$app/state"
	import { adminNavFor } from "$lib/client/shell/adminNav"
	import { adminHealth } from "./adminHealth.svelte"
	import { adminRouter, interceptAdminLink } from "./adminRouter.svelte"
	import { sectionHrefFor } from "./adminRoutes"
	import {
		ADMIN_INTEREST_CONTEXT,
		interestContextValue
	} from "$lib/client/sockets/interest.svelte"
	import { ViewModeTracker } from "$lib/client/shell/viewMode.svelte"
	import SectionList from "$lib/client/components/panels/SectionList.svelte"
	import type { SectionGroup } from "$lib/client/components/panels/sectionList"
	import PanelNavHeader from "$lib/client/components/panels/PanelNavHeader.svelte"
	import { warnBeforeUnload } from "$lib/client/forms/unsavedEdits.svelte"
	import AdminUnsavedChangesModal from "$lib/client/components/modals/AdminUnsavedChangesModal.svelte"

	interface Props {
		/** The shell's close gate for this view (Layout's `viewCloseGates`). */
		onclose?: () => Promise<boolean> | undefined
		/**
		 * 🚧 The shell's Escape gate for this view (Layout's
		 * `viewEscapeGates`, RF fix 2 item 5): asked before Escape steps the
		 * view down; false keeps it as it is.
		 */
		onescape?: () => Promise<boolean> | undefined
	}
	let { onclose = $bindable(), onescape = $bindable() }: Props = $props()

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
		adminNavFor(
			systemSettingsCtx?.settings?.isAccountsEnabled !== false,
			page.data?.isPrerelease === true
		)
	)
	let hrefs = $derived(nav.flatMap((g) => g.items.map((i) => i.href)))
	let activeHref = $derived(sectionHrefFor(adminRouter.path, hrefs))
	let activeLabel = $derived(
		nav.flatMap((g) => g.items).find((i) => i.href === activeHref)?.label ??
			"Admin"
	)
	/**
	 * The nav as section-list rows, keyed and linked by address (so a
	 * middle click still opens the section in a tab), each carrying its
	 * Needs you dot: red for a problem, gold for something waiting.
	 */
	let sectionGroups = $derived<SectionGroup[]>(
		nav.map((g) => ({
			label: g.group || undefined,
			items: g.items.map((i) => {
				const level = adminHealth.levelFor(i.href)
				return {
					key: i.href,
					label: i.label,
					icon: Icons[i.icon] as Component<any>,
					href: i.href,
					dot: level
						? level === "error"
							? "error"
							: "primary"
						: undefined
				}
			})
		}))
	)

	const vm = new ViewModeTracker()
	/**
	 * Below desk width the list and the section take turns. Opening the view
	 * on the Overview shows the list first (the Needs you card and the rows
	 * ARE the overview at that width); opening it anywhere deeper shows that
	 * section.
	 */
	let showList = $state(adminRouter.path === "/admin")
	// 🚧 A section opened any way (a link inside a section too) is the one
	// shown below desk width: a list left up from the Overview never
	// replaces — and unmounts — the section when the view narrows, so its
	// unsaved edits are never lost to a change of width (RF fix 2, item 5).
	$effect(() => {
		const path = adminRouter.path
		untrack(() => {
			if (path !== "/admin") showList = false
		})
	})

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
	type Answer = "save" | "discard" | "stay"
	let discardOpen = $state(false)
	/** 🚧 The section on screen offers its own Save (RF fix 2, item 5). */
	let discardCanSave = $state(false)
	let discardSaving = $state(false)
	let discardResolve: ((answer: Answer) => void) | null = null
	function ask(): Promise<Answer> {
		discardResolve?.("stay")
		discardCanSave = adminRouter.canSaveUnsaved
		discardOpen = true
		return new Promise((resolve) => (discardResolve = resolve))
	}
	function answer(a: Answer) {
		discardOpen = false
		discardResolve?.(a)
		discardResolve = null
	}
	/** Save, then go on; a Save that did not land keeps the person here, its reason on the form. */
	async function answerSave() {
		discardSaving = true
		const saved = await adminRouter.saveUnsaved()
		discardSaving = false
		answer(saved ? "save" : "stay")
	}
	const askDiscard = async (): Promise<boolean> => (await ask()) !== "stay"
	/**
	 * 🚧 Discarding without leaving (Escape steps the view down, it stays
	 * mounted): the section is mounted afresh, so it reads what is saved.
	 */
	let sectionEpoch = $state(0)
	/**
	 * 🚧 The view's Escape gate: asks only while something is unsaved (owner,
	 * 2026-10-23, RF fix 3) — a clean section steps down at once, unasked.
	 */
	async function escapeGate(): Promise<boolean> {
		if (!adminRouter.hasUnsavedEdits) return true
		const a = await ask()
		if (a === "discard") sectionEpoch++
		return a !== "stay"
	}
	onMount(() => {
		adminRouter.setDiscardPrompt(askDiscard)
		onclose = () => adminRouter.confirmDiscard()
		onescape = escapeGate
		return () => adminRouter.setDiscardPrompt(async () => true)
	})
	warnBeforeUnload(() => adminRouter.hasUnsavedEdits)

	async function backToList() {
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
				root?.querySelector<HTMLElement>(
					`[data-field="${CSS.escape(target)}"]`
				) ??
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
	/**
	 * 🚧 The address whose section did not load (RF fix 6, 2026-10-23) — a tab
	 * still running the build before an update asks for files that are gone.
	 * Said in the section's place: never the section before it, left live
	 * under the new address with the new address's params.
	 */
	let loadFailed = $state<string | null>(null)

	$effect(() => {
		const match = adminRouter.match
		const path = adminRouter.path
		notFound = match.route === null && path !== "/admin"
		const route = match.route
		if (!route) return
		const wantLayout = route.layout ?? null
		Promise.all([wantLayout?.(), route.page()])
			.then(([l, p]) => {
				// A later click won the race: leave it be.
				if (adminRouter.path !== path) return
				if (wantLayout !== layoutLoader) {
					layoutLoader = wantLayout
					LayoutCmp = l?.default ?? null
				}
				loadFailed = null
				PageCmp = p.default
				loadedPath = path
			})
			.catch(() => {
				if (adminRouter.path === path) loadFailed = path
			})
	})
</script>

{#snippet needsYou()}
	<!-- The Overview's Needs you list, counted; passed only when it has
	     something in it. Its links are admin addresses, moved by
	     `interceptAdminLink` on the root. -->
	<section
		class="panel-card mb-1 flex flex-col gap-2"
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
			<h3 id="admin-needs-you" class="text-sm font-medium">Needs you</h3>
			<span class="text-surface-600-400 text-xs">
				{attention.length}
			</span>
		</div>
		<ul class="flex flex-col gap-1">
			{#each attention.slice(0, 3) as item (item.id)}
				<li>
					<a
						href={item.action.href}
						class="text-surface-800-200 hover:text-primary-ink block truncate text-chip underline-offset-2 hover:underline"
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
{/snippet}

<!-- Flush at desk (240px, its own edge and scroller, stretched by the row
     it sits in); below desk it fills the view and scrolls itself. -->
{#snippet sectionList()}
	<SectionList
		ariaLabel="Admin sections"
		groups={sectionGroups}
		value={activeHref}
		onselect={open}
		head={attention.length ? needsYou : undefined}
		flush={vm.mode === "desk"}
		class={vm.mode === "desk" ? "" : "min-h-0 flex-1 overflow-y-auto"}
	/>
{/snippet}

{#snippet pageSnippet()}
	{#if PageCmp}
		{#key `${loadedPath}#${sectionEpoch}`}
			<!-- 🚧 While the next section loads, the one on screen takes no input
			     (RF fix 6): its params are already the next address's. -->
			<div class="contents" inert={loadedPath !== adminRouter.path}>
				<PageCmp />
			</div>
		{/key}
	{/if}
{/snippet}

{#snippet section()}
	<!-- The container the sections measure themselves against (their
	     `@container content` rules), and the reading width they sit in.
	     Below desk the nav header sits above it, so the top is the 12px
	     under a header (STYLE-GUIDE §6.3) rather than the desk's 24px. -->
	<div
		bind:this={contentEl}
		class="admin-content flex min-h-0 flex-1 flex-col overflow-y-auto"
	>
		<!-- The inset is a margin on this wrapper, never padding on the
		     scroller above it (owner ruling 2026-10-11, PanelSplit says why). -->
		<div
			class={[
				"mx-5 mb-6 flex flex-1 flex-col",
				vm.mode === "desk" ? "mt-6" : "mt-3"
			]}
		>
			{#if loadFailed === adminRouter.path}
				<div class="m-auto flex flex-col items-center gap-3 text-center" role="alert" data-admin-load-failed>
					<p class="text-surface-600-400 text-sm">
						This page did not load. If Serene Pub was just updated, reload to get the new version.
					</p>
					<button type="button" class="btn btn-sm preset-tonal-surface" onclick={() => location.reload()}>Reload</button>
				</div>
			{:else if notFound}
				<div
					class="m-auto flex flex-col items-center gap-3 text-center"
				>
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
	</div>
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	use:vm.observe
	data-view-links
	class="flex h-full min-h-0 flex-col"
	onclickcapture={interceptAdminLink}
>
	{#if vm.mode !== "desk" && showList}
		{@render sectionList()}
	{:else}
		<!-- 🚧 One place for the section at every width (RF fix 2, item 5):
		     only its neighbour changes — the flush section list at desk (a
		     row, so the list runs the view's full height), the way back below
		     it — so narrowing or widening the view (Escape out of Focus)
		     never mounts the section afresh and never loses its edits. -->
		<div class={["flex min-h-0 flex-1", vm.mode === "desk" ? "" : "flex-col"]}>
			{#if vm.mode === "desk"}
				{@render sectionList()}
			{:else}
				<!-- The section's own header (breadcrumbs, title) is in the
				     scroller; this one stays put so the way back is always there. -->
				<div class="shrink-0 px-5 pt-4">
					<PanelNavHeader
						title={activeLabel}
						onBack={backToList}
						backLabel="All sections"
					/>
				</div>
			{/if}
			{@render section()}
		</div>
	{/if}
</div>

<AdminUnsavedChangesModal
	open={discardOpen}
	onOpenChange={(e) => {
		if (!e.open && !discardSaving) answer("stay")
	}}
	onConfirm={() => answer("discard")}
	onCancel={() => answer("stay")}
	onSave={discardCanSave ? answerSave : undefined}
	saving={discardSaving}
/>

<style>
	.admin-content {
		container-type: inline-size;
		container-name: content;
	}
</style>
