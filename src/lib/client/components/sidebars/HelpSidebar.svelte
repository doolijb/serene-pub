<script lang="ts">
	/**
	 * The **Help** sidebar view — the documentation, read beside the thing it
	 * is about (NOMENCLATURE §27).
	 *
	 * It is the same rendered docs-dist the `/docs` full page reads, and the
	 * same components, with one difference that decides the whole shape of this
	 * file: **the view navigates itself.** `/docs` keeps its place in the URL,
	 * which is right for a page and wrong for a tab that is meant to sit open
	 * beside a session — following a link would take the window away from the
	 * work the reader opened the documentation about. So the page being read is
	 * this component's own `slug`, links inside an article are intercepted (see
	 * `helpLinks.ts`), and nothing here calls `goto`. `DocsHistoryControls` has
	 * no place here for the same reason: its buttons drive the browser's
	 * history, which this view does not write to.
	 *
	 * Everything else is borrowed rather than rebuilt, so Help and `/docs` can
	 * never drift into two documentations: the nav comes from the manifest, the
	 * dialect's styling from `docs.css` (which is scoped to `.docs-article`,
	 * not to the route), and the outline from `DocPageOutline`, which queries
	 * the column it is in rather than the window so that it answers to this
	 * view as well as to `/docs`.
	 *
	 * **The search is Jump.** This view has no box of its own (STYLE-GUIDE
	 * §6.9): it registers its scope with the shell like every other sidebar
	 * view, so Ctrl K over an open Help searches the documentation with the
	 * chip reading *Documentation*. A second box here would be the two states
	 * over one list that the registry exists to retire.
	 *
	 * No close gate: like Admin, this view holds no unsaved work.
	 */
	import { getContext, tick } from "svelte"
	import * as Icons from "@lucide/svelte"
	import {
		docsManifest,
		getDocMeta,
		loadDocHtml
	} from "$lib/shared/utils/docsIndex"
	import DocPageOutline from "$lib/client/components/docs/DocPageOutline.svelte"
	import EmptyState from "$lib/client/components/EmptyState.svelte"
	import SidebarListItem from "$lib/client/components/SidebarListItem.svelte"
	import PanelNavHeader from "$lib/client/components/panels/PanelNavHeader.svelte"
	import PanelSplit from "$lib/client/components/panels/PanelSplit.svelte"
	import { ViewModeTracker } from "$lib/client/shell/viewMode.svelte"
	import { docsJumpHits } from "$lib/client/shell/docsJump"
	import {
		JUMP_CONTEXT,
		KIND_SCOPE_LABELS,
		type JumpCtx
	} from "$lib/client/shell/jump.svelte"
	import { JUMP_HITS_PER_KIND, type JumpHit } from "$lib/shared/sockets/jump"
	import {
		docsPlayground,
		documentTheme
	} from "$lib/client/components/docs/docsPlayground"
	import { resolveInViewLink } from "./helpLinks"

	/**
	 * The dock/desk switch every list-with-detail view shares: one pane at
	 * 400px, the index beside the page once the view is shown full page.
	 */
	const viewMode = new ViewModeTracker()

	const panelsCtx: PanelsCtx = getContext("panelsCtx")

	/** The page being read, or null for the index. In-view, never the URL. */
	let slug = $state<string | null>(null)
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
	 * build, which is what keeps this view, `/docs` and serenepub.com listing
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
		// Scoped to this article, never `document.getElementById`: the same
		// page can be open on `/docs` behind this view, and the ids the
		// compiler emits are the same ones there.
		const target = articleRef?.querySelector<HTMLElement>(
			`[id="${CSS.escape(anchor)}"]`
		)
		if (!target) return
		pane.scrollTop +=
			target.getBoundingClientRect().top -
			pane.getBoundingClientRect().top
	}

	/** Show a page (or the index), then put the reader where the link pointed. */
	async function show(next: string | null, anchor = "") {
		const token = ++loadToken
		slug = next
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
		scrollToAnchor(anchor)
	}

	/* ── Jump ───────────────────────────────────────────────────────────── */

	/**
	 * The view's "filter box", which this view does not draw.
	 *
	 * The registry's contract is a two-way binding onto the view's own search
	 * state (`getQuery`/`setQuery`), and that contract is honoured here in
	 * full — this view simply has no input rendering it. It is still the
	 * view's state and not a copy of the overlay's: it survives the overlay
	 * closing and reopening, exactly as the Characters filter does.
	 */
	let jumpQuery = $state("")

	/**
	 * The matching sections, kept in view state because `getHits` is
	 * synchronous and the index is fetched.
	 *
	 * `docsJumpHits` is the lazy form — it loads the index on the first
	 * non-empty query and never before, so opening Help costs nothing until
	 * somebody searches it, and `loadSearchIndex` memoises the rest.
	 */
	let jumpHits = $state<JumpHit[]>([])

	$effect(() => {
		const q = jumpQuery.trim()
		if (!q) {
			jumpHits = []
			return
		}
		let alive = true
		void docsJumpHits(q, JUMP_HITS_PER_KIND).then((hits) => {
			// A query the reader has already typed past must not draw over the
			// answer to the one they are on.
			if (alive) jumpHits = hits
		})
		return () => {
			alive = false
		}
	})

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
			getQuery: () => jumpQuery,
			setQuery: (next) => (jumpQuery = next),
			getHits: () => jumpHits,
			// In-view, like every other link here: the reader stays beside the
			// work they opened the documentation about.
			//
			// The query is spent rather than kept, which is the one place this
			// view differs from Characters: there the text is visible in the
			// toolbar and the list behind stays narrowed by it, and here there
			// is no box to see it in — a query left standing would meet the
			// next Ctrl K as results nobody asked for. (The search box this
			// replaced cleared itself on a pick for the same reason.)
			onPick: (hit) => {
				jumpQuery = ""
				void show(String(hit.id), hit.anchor ?? "")
			}
		})
	)

	/**
	 * A jump made from anywhere else arrives as `digest.help`, and this is its
	 * only reader: it takes the address with it, so the same section can be
	 * jumped to twice.
	 *
	 * An `$effect` and not an `onMount`: the view is kept mounted as a tab, so
	 * a second jump while Help is already open would otherwise write a key
	 * nothing reads again (`openJumpHit.ts`, the `connection` branch).
	 */
	$effect(() => {
		const target = panelsCtx.digest.help
		if (!target) return
		delete panelsCtx.digest.help
		void show(target.slug, target.anchor ?? "")
	})

	/**
	 * One delegated handler over the page, rather than a pass that rewrites the
	 * compiled HTML: the hrefs stay exactly what the build emitted, so the same
	 * markup is served to `/docs`, to Document View and to here, and there is
	 * one place that decides what a click means.
	 *
	 * Modified clicks are left alone on purpose — ctrl/cmd/middle-click opens
	 * the full page in a new tab, which is a reasonable thing to want from a
	 * 400px column and costs nothing to allow.
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
		// guide that left the manifest — is left to the browser, which lands on
		// the route and gets a real 404 rather than a blank pane here.
		if (link.slug !== null && !getDocMeta(link.slug)) return

		event.preventDefault()
		if (link.slug === slug) scrollToAnchor(link.anchor)
		else void show(link.slug, link.anchor)
	}
</script>

<div class="text-foreground flex min-h-0 flex-1 flex-col" use:viewMode.observe>
	<!-- No search row: the documentation is searched from Jump, which this
	     view registers itself with above (STYLE-GUIDE §6.9). -->
	<PanelSplit
		mode={viewMode.mode}
		hasDetail={slug !== null}
		listWidth="360px"
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
		<div class="flex flex-col gap-5">
			{#each groups as group (group.source)}
				<section class="flex flex-col gap-2">
					<div class="flex items-center gap-2">
						<h3 class="text-sm font-semibold">{group.group}</h3>
						{#if group.source !== "app"}
							<!-- Reference pages are rendered from the SDK's own
							     declarations rather than written by anyone.
							     Marking the group says so before a reader opens
							     one and wonders why it reads like a spec. -->
							<span
								class="badge preset-tonal-tertiary text-[11px] uppercase"
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
												class="text-muted-foreground line-clamp-2 text-xs"
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
	{/if}
{/snippet}

{#snippet pagePane()}
	<!-- `@container/docs` is the column the outline queries, exactly as the
	     `/docs` layout declares it: hidden beside a 400px dock, shown once this
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
			<div class="text-surface-400 flex justify-center py-12">
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
				     what `.docs-article` switches on. No `max-w-none` here: in
				     the dock the column is narrower than the measure anyway,
				     and full page it is `prose` that keeps the 65ch line
				     STYLE-GUIDE §3.4 asks for. -->
				<!-- Playground blocks get their button here too, from the same
				     action `/docs` uses — one upgrade, so the two readings of a
				     page can never offer different controls. It re-scans on its
				     own when this view navigates and swaps the body. -->
				<article
					bind:this={articleRef}
					class="docs-article prose prose-sm dark:prose-invert"
					use:docsPlayground={{ theme: documentTheme }}
				>
					{@html html}
				</article>
				<DocPageOutline headings={meta?.headings ?? []} />
			</div>
		{:else}
			<EmptyState
				icon={Icons.FileText}
				message="That documentation page is not in this build."
			/>
		{/if}
	</div>
{/snippet}
