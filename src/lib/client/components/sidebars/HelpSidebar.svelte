<script lang="ts">
	/**
	 * The **Help** sidebar view — the documentation, read beside the thing it
	 * is about (NOMENCLATURE §27). It is the only reading of the docs in the
	 * standard interface (ruled 2026-09-27: the `/docs` page is gone), docked,
	 * at half width or in Focus; Document View keeps its own mirror.
	 *
	 * **The view navigates itself.** The page being read lives in
	 * `helpRouter` rather than the URL, links inside an article are
	 * intercepted (see `helpLinks.ts`), and nothing here calls `goto` — a tab
	 * that sits open beside a session must not take the window away from the
	 * work the reader opened it about. Only in Focus does the page reach the
	 * address bar (`/docs/<slug>`), which the router writes.
	 *
	 * The nav comes from the manifest, the dialect's styling from `docs.css`
	 * (scoped to `.docs-article`), and the outline from `DocPageOutline`,
	 * which queries the column it is in rather than the window.
	 *
	 * **Search** is one state with two boxes onto it: the filter box at the
	 * head of the index, and Jump, which this view registers its scope with so
	 * Ctrl K over an open Help searches the documentation with the chip reading
	 * *Documentation* (STYLE-GUIDE §6.9). Both read and write `searchQuery`.
	 *
	 * No close gate: like Admin, this view holds no unsaved work.
	 */
	import { getContext, tick, untrack } from "svelte"
	import * as Icons from "@lucide/svelte"
	import {
		docsManifest,
		getDocMeta,
		loadDocHtml
	} from "$lib/shared/utils/docsIndex"
	import DocPageOutline from "$lib/client/components/docs/DocPageOutline.svelte"
	import EmptyState from "$lib/client/components/EmptyState.svelte"
	import SidebarListItem from "$lib/client/components/SidebarListItem.svelte"
	import PanelFilterInput from "$lib/client/components/panels/PanelFilterInput.svelte"
	import PanelNavHeader from "$lib/client/components/panels/PanelNavHeader.svelte"
	import PanelSplit from "$lib/client/components/panels/PanelSplit.svelte"
	import { ViewModeTracker } from "$lib/client/shell/viewMode.svelte"
	import {
		docsSearch,
		highlightParts,
		queryWords,
		type DocMatch
	} from "$lib/client/shell/docsJump"
	import { helpRouter } from "$lib/client/shell/helpRouter.svelte"
	import {
		JUMP_CONTEXT,
		KIND_SCOPE_LABELS,
		type JumpCtx
	} from "$lib/client/shell/jump.svelte"
	import { JUMP_MIN_QUERY_LENGTH } from "$lib/shared/sockets/jump"
	import {
		docsPlayground,
		documentTheme
	} from "$lib/client/components/docs/docsPlayground"
	import { helpAnchorId, resolveInViewLink } from "./helpLinks"

	/**
	 * The dock/desk switch every list-with-detail view shares: one pane at
	 * 400px, the index beside the page once the view is shown full page.
	 */
	const viewMode = new ViewModeTracker()

	/** The page being read, or null for the index. */
	let slug = $derived(helpRouter.slug)

	// Reopen on the page last read, unless something already chose one.
	helpRouter.resume((s) => !!getDocMeta(s))

	/**
	 * The page before and after this one in reading order, within its own
	 * group — the guides read on into the guides, the reference into the
	 * reference, never across.
	 */
	let neighbours = $derived.by(() => {
		if (!slug) return { prev: null, next: null }
		for (const group of docsManifest.nav) {
			const at = group.pages.indexOf(slug)
			if (at === -1) continue
			const meta = (s: string | undefined) => (s ? getDocMeta(s) ?? null : null)
			return { prev: meta(group.pages[at - 1]), next: meta(group.pages[at + 1]) }
		}
		return { prev: null, next: null }
	})
	let html = $state<string | null>(null)
	let loading = $state(false)
	let articleRef = $state<HTMLElement | null>(null)

	/**
	 * Bumped by every navigation, so a page's chunk that lands after the reader
	 * has already moved on is dropped rather than rendered over the newer one.
	 */
	let loadToken = 0

	let meta = $derived(slug ? getDocMeta(slug) : undefined)

	/**
	 * The nav as the compiler wrote it — groups in reading order, pages in
	 * order within each group. Nothing here decides an order; that lives in the
	 * build, which is what keeps this view, Document View and serenepub.com listing
	 * the same documentation.
	 */
	let groups = $derived(
		docsManifest.nav.map((group) => ({
			...group,
			meta: docsManifest.sources[group.source],
			pages: group.pages
				.map((pageSlug) => docsManifest.pages[pageSlug])
				.filter((doc) => !!doc)
		}))
	)

	/**
	 * The element the reader actually scrolls — `PanelSplit`'s pane, which is
	 * PanelSplit's element and not ours, so it is found rather than bound.
	 * Anchors are spent on it directly instead of through `scrollIntoView`,
	 * which would also scroll every ancestor up to the window: the view's
	 * scrolling is the view's business.
	 */
	function scrollPane(): HTMLElement | null {
		let node = articleRef?.parentElement ?? null
		while (node) {
			const overflowY = getComputedStyle(node).overflowY
			if (overflowY === "auto" || overflowY === "scroll") return node
			node = node.parentElement
		}
		return null
	}

	function scrollToAnchor(anchor: string) {
		const pane = scrollPane()
		if (!pane) return
		if (!anchor) {
			pane.scrollTop = 0
			return
		}
		// Scoped to this article AND to the ids this view renamed
		// (`scopeArticleAnchors`), never `document.getElementById`: the app
		// around this view has ids of its own, and a heading called
		// "sessions" must not find one of them.
		const target = articleRef?.querySelector<HTMLElement>(
			`[id="${CSS.escape(helpAnchorId(anchor))}"]`
		)
		if (!target) return
		pane.scrollTop +=
			target.getBoundingClientRect().top -
			pane.getBoundingClientRect().top
	}

	/**
	 * Rename every id the compiled body carries, and rebase the links that point
	 * at them, so a page's ids cannot collide with the app's own around it.
	 *
	 * A pass over the DOM once the body is rendered, never a rewrite of the HTML
	 * string: the markup the compiler emits is the same markup Document View and
	 * serenepub.com are served, and there is exactly one build of it. What
	 * differs is that this view shares its document with the whole app, so it
	 * is this view that renames — see `helpAnchorId` for why the prefix is what
	 * it is.
	 *
	 * The hrefs move with the ids because they are the same fact written twice: a
	 * `#x` left standing here would address an element outside the article. Cross-page links (`/docs/other#x`) keep the
	 * compiler's fragment — the anchor is spent against the NEXT body, which this
	 * pass renames in its turn. `handleDocClick` reads whatever ends up in the
	 * href and `helpAnchorId` takes either spelling.
	 *
	 * Idempotent, so a second run over a body already renamed is a no-op.
	 */
	function scopeArticleAnchors() {
		const article = articleRef
		if (!article) return
		for (const el of article.querySelectorAll<HTMLElement>("[id]")) {
			el.id = helpAnchorId(el.id)
		}
		for (const link of article.querySelectorAll<HTMLAnchorElement>(
			'a[href^="#"]'
		)) {
			const anchor = (link.getAttribute("href") ?? "").slice(1)
			if (anchor) link.setAttribute("href", `#${helpAnchorId(anchor)}`)
		}
	}

	/** Show a page (or the index), landing where the link pointed. */
	function show(next: string | null, anchor = "") {
		helpRouter.go(next, anchor)
	}

	/**
	 * Load whatever page the router is on. Declared before the anchor effect
	 * below so a move to a new page marks it loading before that effect asks
	 * to land on an anchor the new body does not have yet.
	 */
	$effect(() => {
		const next = slug
		untrack(() => void load(next))
	})

	async function load(next: string | null) {
		const token = ++loadToken
		html = null
		if (next === null) {
			loading = false
			return
		}
		loading = true
		const loaded = await loadDocHtml(next)
		if (token !== loadToken) return
		html = loaded
		loading = false
		await tick()
		// Before the anchor is spent: it is looked up by the renamed id.
		scopeArticleAnchors()
		scrollToAnchor(helpRouter.anchor.anchor)
	}

	// An anchor asked for on the page already open (an outline row, a
	// same-page link, a jump to another heading of this page).
	$effect(() => {
		const { anchor } = helpRouter.anchor
		untrack(() => {
			if (!loading && html) scrollToAnchor(anchor)
		})
	})

	/* ── Jump ───────────────────────────────────────────────────────────── */

	/**
	 * The search text, drawn by the box at the head of the index and by Jump
	 * (the registry's contract is a two-way binding onto the view's own search
	 * state). It survives the overlay closing and a page being opened, exactly
	 * as the Characters filter does: Back from a page returns to the results.
	 */
	let searchQuery = $state("")

	/**
	 * The in-view list shows more than a Jump lane does: it is the whole
	 * answer here, not one lane of several.
	 */
	const IN_VIEW_HITS = 40

	/** Below Jump's minimum a query is not a search yet, and the index stays. */
	let searching = $derived(
		searchQuery.trim().length >= JUMP_MIN_QUERY_LENGTH
	)

	/**
	 * The matching sections, kept in view state because `getHits` is
	 * synchronous and the index is fetched. `docsSearch` loads the index on
	 * the first real query and never before, and `loadSearchIndex` memoises
	 * the rest. Null while a first answer is still on its way.
	 */
	let matches = $state<DocMatch[] | null>([])

	$effect(() => {
		const q = searchQuery.trim()
		if (q.length < JUMP_MIN_QUERY_LENGTH) {
			matches = []
			return
		}
		// Earlier results stay up while the next keystroke's answer comes
		// back; only an empty list gives way to the spinner, so the first
		// search does not flash "nothing matches" while the index loads.
		if (untrack(() => matches?.length === 0)) matches = null
		let alive = true
		void docsSearch(q, IN_VIEW_HITS).then((next) => {
			// A query the reader has already typed past must not draw over the
			// answer to the one they are on.
			if (alive) matches = next
		})
		return () => {
			alive = false
		}
	})

	let words = $derived(queryWords(searchQuery))
	/**
	 * The app's own pages, then the SDK reference under its own heading. The
	 * first is headed "Using Serene Pub", not "Guides": Guides is one of the
	 * nav groups (NOMENCLATURE §27), and these results span all five.
	 */
	let guideMatches = $derived((matches ?? []).filter((m) => !m.reference))
	let referenceMatches = $derived((matches ?? []).filter((m) => m.reference))

	/**
	 * Arrow keys walk from the box into the results and between them; Up from
	 * the first result goes back to the box.
	 */
	let resultsEl = $state<HTMLElement | null>(null)
	function rows(): HTMLElement[] {
		return [...(resultsEl?.querySelectorAll<HTMLElement>("[data-result]") ?? [])]
	}
	function onSearchKeydown(event: KeyboardEvent) {
		if (event.key !== "ArrowDown") return
		const first = rows()[0]
		if (!first) return
		event.preventDefault()
		first.focus()
	}
	function onResultsKeydown(event: KeyboardEvent) {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
		const list = rows()
		const at = list.indexOf(document.activeElement as HTMLElement)
		if (at === -1) return
		event.preventDefault()
		const next = at + (event.key === "ArrowDown" ? 1 : -1)
		if (next < 0)
			resultsEl?.ownerDocument
				.querySelector<HTMLElement>("[data-help-search]")
				?.focus()
		else list[Math.min(next, list.length - 1)]?.focus()
	}

	/**
	 * The effect reads nothing reactive (the registration is closures over
	 * state, not state), so it registers once and its return value is the
	 * unregister Svelte calls on destroy.
	 */
	const jumpCtx = getContext<JumpCtx | undefined>(JUMP_CONTEXT)
	$effect(() =>
		jumpCtx?.registerScope("help", {
			label: KIND_SCOPE_LABELS.doc,
			placeholder: "Search the documentation…",
			getQuery: () => searchQuery,
			setQuery: (next) => (searchQuery = next),
			getHits: () => (matches ?? []).map((m) => m.hit),
			// In-view, like every other link here: the reader stays beside the
			// work they opened the documentation about. The query stays too —
			// it is in the box, and the list behind is still narrowed by it.
			onPick: (hit) => show(String(hit.id), hit.anchor ?? "")
		})
	)

	/**
	 * One delegated handler over the page, rather than a pass that rewrites the
	 * compiled HTML: the hrefs stay exactly what the build emitted, so the same
	 * markup is served to Document View and to here, and there is one place
	 * that decides what a click means.
	 *
	 * Modified clicks are left alone on purpose — ctrl/cmd/middle-click opens
	 * the page in a new tab, where its address opens this view in Focus.
	 */
	function handleDocClick(event: MouseEvent) {
		if (event.defaultPrevented) return
		if (
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey
		)
			return
		const anchorEl = (event.target as Element | null)?.closest?.("a")
		if (!anchorEl) return
		const target = anchorEl.getAttribute("target")
		if (target && target !== "_self") return

		const link = resolveInViewLink(
			anchorEl.getAttribute("href") ?? "",
			slug
		)
		if (!link) return
		// A `/docs/…` URL this build has no page for — a converted asset, or a
		// guide that left the manifest — is left to the browser.
		if (link.slug !== null && !getDocMeta(link.slug)) return

		event.preventDefault()
		show(link.slug, link.anchor)
	}
</script>

<div
	class="text-foreground flex min-h-0 flex-1 flex-col"
	data-view-links
	use:viewMode.observe
>
	<PanelSplit
		mode={viewMode.mode}
		hasDetail={slug !== null}
		listWidth="320px"
		emptyMessage="Pick a page to read it."
		list={indexPane}
		detail={pagePane}
	/>
</div>

{#snippet indexPane()}
	{#if groups.length === 0}
		<!-- The docs-dist is build output, so a checkout that has not compiled
		     it has no pages at all. Say so rather than showing an empty column. -->
		<EmptyState
			icon={Icons.BookOpen}
			message="The documentation has not been built for this copy of Serene Pub."
		/>
	{:else}
		<div class="mb-4">
			<PanelFilterInput
				bind:value={searchQuery}
				placeholder="Search the documentation"
				data-help-search
				onkeydown={onSearchKeydown}
			/>
		</div>
		{#if searching}
			{@render resultsList()}
		{:else}
			{@render pageIndex()}
		{/if}
	{/if}
{/snippet}

<!-- A result is a heading, not a page: the row names the section and, under
     it, the page it is on, and opening it lands on that heading. -->
{#snippet resultsList()}
	{#if matches === null}
		<div class="text-surface-600-400 flex justify-center py-8">
			<Icons.Loader2 class="animate-spin" size={20} />
		</div>
	{:else if matches.length === 0}
		<EmptyState
			icon={Icons.SearchX}
			message={`Nothing in the documentation matches "${searchQuery.trim()}".`}
		/>
	{:else}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="flex flex-col gap-5"
			bind:this={resultsEl}
			onkeydown={onResultsKeydown}
		>
			{#if guideMatches.length}
				{@render resultGroup("Using Serene Pub", guideMatches)}
			{/if}
			{#if referenceMatches.length}
				{@render resultGroup("Reference", referenceMatches)}
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet marked(text: string)}
	{#each highlightParts(text, words) as part, i (i)}
		{#if part.match}<mark class="search-mark">{part.text}</mark>{:else}{part.text}{/if}
	{/each}
{/snippet}

<!-- A result is a heading, not a page: the row names the section, the page
     it is on and why it matched, and opening it lands on that heading. -->
{#snippet resultGroup(label: string, group: DocMatch[])}
	<section class="flex flex-col gap-1" aria-label={label}>
		<h3 class="text-surface-600-400 mb-1 text-xs font-semibold">
			{label} · {group.length}
		</h3>
		{#each group as { hit, snippet } (`${hit.id}#${hit.anchor ?? ""}`)}
			{@const pageLevel = !hit.anchor || hit.subtitle === hit.title}
			<button
				type="button"
				data-result
				class="hover:bg-surface-200-800 focus-visible:ring-primary-500 flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left focus-visible:ring-2 focus-visible:outline-none {hit.id ===
					slug && (hit.anchor ?? '') === helpRouter.anchor.anchor
					? 'sidebar-row-active'
					: ''}"
				onclick={() => show(String(hit.id), hit.anchor ?? "")}
			>
				<span class="flex min-w-0 items-center gap-1.5 text-[15px] font-medium">
					{#if pageLevel}
						<Icons.FileText size={14} class="text-surface-600-400 shrink-0" aria-hidden="true" />
					{:else}
						<Icons.Hash size={14} class="text-surface-600-400 shrink-0" aria-hidden="true" />
					{/if}
					<span class="truncate">{@render marked(hit.title)}</span>
				</span>
				{#if !pageLevel}
					<span class="text-surface-600-400 truncate text-xs">{hit.subtitle}</span>
				{/if}
				{#if snippet}
					<span class="text-surface-700-300 line-clamp-2 text-xs">
						{@render marked(snippet)}
					</span>
				{/if}
			</button>
		{/each}
	</section>
{/snippet}

{#snippet pageIndex()}
		<div class="flex flex-col gap-5">
			<!-- Keyed by source AND group: the guides are one source that fills
			     several groups (Start here, Guides, How-to, …), so a source
			     alone repeats. The headings stay the §3.3 section heading —
			     no eyebrow, no numbering (STYLE-GUIDE §1.8). -->
			{#each groups as group (group.source + ":" + group.group)}
				<section class="flex flex-col gap-2">
					<div class="flex items-center gap-2">
						<h3 class="text-sm font-semibold">{group.group}</h3>
						{#if group.source !== "app"}
							<!-- Reference pages are rendered from the SDK's own
							     declarations rather than written by anyone.
							     Marking the group says so before a reader opens
							     one and wonders why it reads like a spec. -->
							<span
								class="badge preset-tonal-tertiary text-[11px]"
							>
								Reference
							</span>
						{/if}
					</div>
					{#if group.meta?.banner}
						<!-- Once, above the group. The compiler also prepends it
						     to every page of the source, so a reader meets it
						     whichever way in they come. -->
						<p class="doc-banner">{group.meta.banner}</p>
					{/if}
					<div role="list" class="flex flex-col gap-1">
						{#each group.pages as doc (doc.slug)}
							<SidebarListItem
								itemType="Documentation page"
								contentTitle={doc.title}
								showIndex={false}
								active={doc.slug === slug}
								onclick={() => show(doc.slug)}
							>
								{#snippet content()}
									<span
										class="bg-surface-200-800 text-surface-600-400 grid size-10 shrink-0 place-items-center rounded-[9px]"
									>
										<Icons.FileText
											size={18}
											aria-hidden="true"
										/>
									</span>
									<span
										class="flex min-w-0 flex-1 flex-col text-left"
									>
										<span
											class="truncate text-[15px] font-medium"
										>
											{doc.title}
										</span>
										{#if doc.description}
											<span
												class="text-surface-600-400 line-clamp-2 text-xs"
											>
												{doc.description}
											</span>
										{/if}
									</span>
								{/snippet}
							</SidebarListItem>
						{/each}
					</div>
				</section>
			{/each}
		</div>
{/snippet}

{#snippet pagePane()}
	<!-- `@container/docs` is the column the outline queries: hidden beside
	     a 400px dock, shown once this
	     view has the page to itself (STYLE-GUIDE §5.3 — the column, never the
	     window). -->
	<div class="@container/docs flex min-h-0 flex-col">
		<div class="mb-3">
			<PanelNavHeader
				title={meta?.title ?? "Documentation"}
				onBack={() => show(null)}
				backLabel="Documentation"
			/>
		</div>
		{#if loading}
			<div class="text-surface-600-400 flex justify-center py-12">
				<Icons.Loader2 class="animate-spin" size={24} />
			</div>
		{:else if html}
			<!-- The click handler sits on the wrapper rather than the article so
			     the outline's rows go through the same rule; every target of it
			     is a real <a>, which is keyboard-operable on its own and fires
			     this same click event from Enter. -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div
				class="grid grid-cols-1 items-start gap-0 @min-[48rem]/docs:grid-cols-[minmax(0,1fr)_14rem] @min-[48rem]/docs:gap-8"
				onclick={handleDocClick}
			>
				<!-- The compiler emits the article body only, already
				     link-rewritten and anchored; `prose` styles the ordinary
				     markdown and `docs.css` the dialect on top of it, which is
				     what `.docs-article` switches on. In the dock the column is
				     narrower than any measure, so `prose-sm` and prose's own
				     cap cost nothing; given the page (from 40rem of column, a step before
				     the outline appears at 48rem) it reads like a page: regular size,
				     no cap — the outline column is what bounds the line, and a
                     65ch column beside a 360px list and a 14rem outline is the
                     "too narrow" the owner reported (2026-09-17). -->
				<!-- Playground blocks get their button here too, from the same
				     action Document View uses — one upgrade, so the two readings
				     of a page can never offer different controls. It re-scans on its
				     own when this view navigates and swaps the body. -->
				<article
					bind:this={articleRef}
					class="docs-article prose prose-sm dark:prose-invert @min-[40rem]/docs:prose-base @min-[40rem]/docs:max-w-none"
					use:docsPlayground={{ theme: documentTheme }}
				>
					{@html html}
				</article>
				<DocPageOutline headings={meta?.headings ?? []} />
			</div>
			{#if neighbours.prev || neighbours.next}
				<nav
					class="border-surface-200-800 mt-8 grid grid-cols-2 gap-3 border-t pt-4"
					aria-label="More pages"
				>
					{#if neighbours.prev}
						{@const prev = neighbours.prev}
						<button
							type="button"
							class="hover:bg-surface-200-800 flex flex-col items-start gap-0.5 rounded-lg p-3 text-left"
							onclick={() => show(prev.slug)}
						>
							<span class="text-surface-600-400 flex items-center gap-1 text-xs">
								<Icons.ArrowLeft size={12} aria-hidden="true" /> Previous
							</span>
							<span class="text-sm font-medium">{prev.title}</span>
						</button>
					{:else}
						<span></span>
					{/if}
					{#if neighbours.next}
						{@const next = neighbours.next}
						<button
							type="button"
							class="hover:bg-surface-200-800 flex flex-col items-end gap-0.5 rounded-lg p-3 text-right"
							onclick={() => show(next.slug)}
						>
							<span class="text-surface-600-400 flex items-center gap-1 text-xs">
								Next <Icons.ArrowRight size={12} aria-hidden="true" />
							</span>
							<span class="text-sm font-medium">{next.title}</span>
						</button>
					{/if}
				</nav>
			{/if}
		{:else}
			<EmptyState
				icon={Icons.FileText}
				message="That documentation page is not in this build."
			/>
		{/if}
	</div>
{/snippet}

<style>
	/* The matched words: a tint behind the text, never a colour change of
	   the text itself, so contrast is whatever the row already had. */
	.search-mark {
		background: color-mix(in oklab, var(--color-primary-500) 28%, transparent);
		color: inherit;
		border-radius: 3px;
		padding: 0 1px;
	}
</style>
