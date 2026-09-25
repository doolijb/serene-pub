<script lang="ts">
	/**
	 * The **Jump overlay** — one search, whatever you are looking at.
	 *
	 * The layout owns this component and the VIEW owns the input's state: when
	 * the overlay is scoped to a sidebar view that registered a filter box
	 * (`jumpCtx.registerScope`), typing here writes that view's own filter, so
	 * the list behind the backdrop narrows as you type and is still narrowed
	 * when you close. A view that registered nothing gets the shell's own
	 * Everywhere search over `jump:search`.
	 *
	 * ## What the list is made of
	 *
	 * The scoped group first — the view's own filtered rows, or the matching
	 * kind from the server, or the documentation, or the admin pages — and
	 * then an **Everywhere** tail from the same `jump:search` reply, capped,
	 * so a scope that finds nothing never dead-ends: the thing you were
	 * looking for is on screen anyway, one group down.
	 *
	 * Two of those lanes never touch the wire: the admin pages are a table
	 * this bundle already carries, and so is the documentation's search index
	 * (`doc`, a CLIENT jump kind — see `shared/sockets/jump.ts`).
	 *
	 * ⚠ **One request, split here.** A scoped search asks `jump:search` for
	 * EVERY kind and files the reply into "the scoped kind" and "everything
	 * else", rather than sending a second, narrowed request for the scoped
	 * group. Two requests would be two replies distinguishable only by the
	 * `query` they echo — which is the same string in both — so the second
	 * would overwrite the first at random. The rendered result is identical.
	 *
	 * ## Interest
	 *
	 * `jump:search` is a gated event: the server runs no query for a socket
	 * that has not declared interest. This component mounts only while the
	 * overlay is open, so the ordinary `useInterest` (declare on mount, release
	 * on destroy) is exactly "declare on open, release on close".
	 */
	import { getContext, onMount, untrack } from "svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { KeyboardNavigationManager } from "$lib/client/utils/keyboardNavigation"
	import { openJumpHit } from "$lib/client/shell/openJumpHit"
	import { matchDocSections } from "$lib/client/shell/docsJump"
	import { adminNavItems } from "$lib/client/shell/adminNav"
	import {
		ADMIN_SCOPE_KEY,
		EVERYWHERE_LABEL,
		KIND_SCOPE_LABELS,
		kindOfScope,
		parseKindPrefix,
		type JumpCtx
	} from "$lib/client/shell/jump.svelte"
	import {
		loadSearchIndex,
		type DocSection
	} from "$lib/shared/utils/docsIndex"
	import {
		JUMP_MIN_QUERY_LENGTH,
		type AnyJumpKind,
		type JumpGroup,
		type JumpHit,
		type JumpSearchResponse
	} from "$lib/shared/sockets/jump"

	interface Props {
		jumpCtx: JumpCtx
	}

	let { jumpCtx }: Props = $props()

	const socket = useTypedSocket()
	const panelsCtx: PanelsCtx = getContext("panelsCtx")
	const userCtx: UserCtx = getContext("userCtx")
	const systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")

	/** How many rows a single group ever shows. */
	const GROUP_CAP = 8
	/** The Everywhere tail's cap, across every group it draws from. */
	const TAIL_CAP = 8
	/** Long enough that a fast typist sends one request, not six. */
	const DEBOUNCE_MS = 150

	/** One icon per kind, each the one that kind's rail item already uses. */
	const KIND_ICONS: Record<AnyJumpKind, any> = {
		session: Icons.MessageSquare,
		character: Icons.UsersRound,
		lorebook: Icons.BookMarked,
		entry: Icons.FileText,
		tag: Icons.Tag,
		connection: Icons.Cable,
		user: Icons.Users,
		// `BookOpen` is documentation (NOMENCLATURE §22) — the same glyph the
		// Help rail item carries.
		doc: Icons.BookOpen
	}

	interface JumpRow {
		/** Unique within the list; becomes the option's DOM id. */
		id: string
		title: string
		subtitle?: string
		icon: any
		/**
		 * The hit's one-word qualifier, drawn as a small glyph AFTER the name —
		 * the same place the character row puts its persona badge. A qualifier
		 * on the kind, never a second icon for it: the leading glyph still says
		 * "character".
		 */
		hint?: JumpHit["hint"]
		action: () => void | Promise<void>
	}

	interface JumpRowGroup {
		label: string
		rows: JumpRow[]
	}

	let response = $state<JumpSearchResponse | null>(null)
	let highlight = $state(0)
	let inputEl = $state<HTMLInputElement | null>(null)
	let listEl = $state<HTMLElement | null>(null)

	const scope = $derived(jumpCtx.scope)
	const query = $derived(jumpCtx.query)
	const trimmed = $derived(query.trim())
	const ready = $derived(trimmed.length >= JUMP_MIN_QUERY_LENGTH)
	const scopedKind = $derived(kindOfScope(scope.key))
	const isAdminScope = $derived(scope.key === ADMIN_SCOPE_KEY)
	const isDocScope = $derived(scope.key === "doc")
	const isAdmin = $derived(!!userCtx.user?.isAdmin)
	const accountsEnabled = $derived(
		systemSettingsCtx?.settings?.isAccountsEnabled !== false
	)

	/* ── the wire ───────────────────────────────────────────────────────── */

	function handleJumpSearch(msg: JumpSearchResponse) {
		// The reply echoes the query it answers, and a reply reaches every
		// socket of this user that declared interest — so this is how a reply
		// to the letter before last is told apart from an answer to what is
		// typed now.
		if (msg.query !== trimmed) return
		response = msg
	}

	useInterest<"jump:search">("jump:search", handleJumpSearch)

	// One debounced request per settled query. The cleanup IS the debounce:
	// a keystroke cancels the pending emit, and so does closing the overlay.
	$effect(() => {
		const q = trimmed
		if (q.length < JUMP_MIN_QUERY_LENGTH) {
			response = null
			return
		}
		const timer = setTimeout(() => {
			socket.emit("jump:search", { query: q })
		}, DEBOUNCE_MS)
		return () => clearTimeout(timer)
	})

	/* ── the rows ───────────────────────────────────────────────────────── */

	function hitRow(
		hit: JumpHit,
		id: string,
		onPick?: (h: JumpHit) => void | Promise<void>
	): JumpRow {
		return {
			id,
			title: hit.title,
			subtitle: hit.subtitle,
			icon: KIND_ICONS[hit.kind] ?? Icons.CornerDownRight,
			hint: hit.hint,
			action: async () => {
				jumpCtx.close()
				// A row that came from a view is opened the way that view
				// opens its own rows; anything else goes through the one
				// resolver that knows where each kind lives.
				if (onPick) await onPick(hit)
				else await openJumpHit(panelsCtx, hit)
			}
		}
	}

	/** Only the reply that answers what is typed NOW is allowed to draw. */
	const replyGroups = $derived<JumpGroup[]>(
		response && response.query === trimmed ? response.groups : []
	)

	/** The scoped view's own filtered rows — the list behind the backdrop. */
	const viewRows = $derived.by<JumpRow[]>(() => {
		const reg = jumpCtx.registration
		if (!ready || !reg) return []
		return reg
			.getHits()
			.slice(0, GROUP_CAP)
			.map((hit, i) => hitRow(hit, `view-${i}`, reg.onPick))
	})

	/** A `kind:` scope's group, taken out of the one unrestricted reply. */
	const scopedKindRows = $derived.by<JumpRow[]>(() => {
		if (!ready || !scopedKind) return []
		const group = replyGroups.find((g) => g.kind === scopedKind)
		return (group?.hits ?? [])
			.slice(0, GROUP_CAP)
			.map((hit, i) => hitRow(hit, `scoped-${i}`))
	})

	/**
	 * Admin pages, matched on their label — the same table the admin rail
	 * draws, so a page renamed there is renamed here.
	 */
	const adminRows = $derived.by<JumpRow[]>(() => {
		if (!ready || !isAdmin) return []
		if (!isAdminScope && scope.key !== null) return []
		const needle = trimmed.toLowerCase()
		return adminNavItems(accountsEnabled)
			.filter((item) => item.label.toLowerCase().includes(needle))
			.slice(0, GROUP_CAP)
			.map((item, i) => ({
				id: `admin-${i}`,
				title: item.label,
				subtitle: item.href,
				icon: (Icons as any)[item.icon] ?? Icons.ShieldCheck,
				action: async () => {
					jumpCtx.close()
					await goto(item.href)
				}
			}))
	})

	/**
	 * The documentation — the one lane that answers without the wire.
	 *
	 * A `doc` is a CLIENT jump kind: the search index is already a chunk of
	 * this bundle, so there is nothing to ask the server for (`docsJump.ts`).
	 * It draws under Everywhere and under its own `doc:` chip; while the Help
	 * view is open that view's registration serves the same hits through
	 * `viewRows` instead, which is how the list behind the overlay stays the
	 * list the overlay is showing.
	 */
	let docSections = $state<DocSection[] | null>(null)
	/** Plain, not `$state`: the request is a fact about this component, not a value it draws. */
	let docsRequested = false

	const docsLane = $derived(ready && (scope.key === null || isDocScope))

	// The index carries every heading AND its opening prose — most of the
	// documentation a second time — so it is fetched on the first search that
	// could use it and never before. `loadSearchIndex` memoises, so this costs
	// one fetch per session however often the overlay is opened.
	$effect(() => {
		if (!docsLane || docsRequested) return
		docsRequested = true
		void loadSearchIndex().then((sections) => {
			docSections = sections
		})
	})

	/** Nothing until the index has landed — an empty lane, never a wrong one. */
	const docHits = $derived.by<JumpHit[]>(() =>
		docsLane && docSections
			? matchDocSections(docSections, trimmed, GROUP_CAP)
			: []
	)

	const docRows = $derived<JumpRow[]>(
		docHits.map((hit, i) => hitRow(hit, `doc-${i}`))
	)

	/**
	 * Everything the scoped group did not claim, capped across kinds — the
	 * reason a scoped search never dead-ends.
	 */
	const tailRows = $derived.by<JumpRow[]>(() => {
		if (!ready || scope.key === null) return []
		// A row already on screen in the scoped group must not appear a second
		// time three rows further down.
		const seen = new Set<string>()
		const reg = jumpCtx.registration
		if (reg)
			for (const hit of reg.getHits().slice(0, GROUP_CAP))
				seen.add(`${hit.kind}:${hit.id}`)
		for (const hit of docHits) seen.add(`${hit.kind}:${hit.id}`)
		const out: JumpRow[] = []
		for (const group of replyGroups) {
			if (group.kind === scopedKind) continue
			for (const hit of group.hits) {
				const key = `${hit.kind}:${hit.id}`
				if (seen.has(key)) continue
				seen.add(key)
				out.push(hitRow(hit, `tail-${out.length}`))
				if (out.length >= TAIL_CAP) return out
			}
		}
		return out
	})

	/** Everywhere: the reply's own groups, one per kind, in the reply's order. */
	const everywhereGroups = $derived.by<JumpRowGroup[]>(() => {
		if (!ready || scope.key !== null) return []
		return replyGroups
			.filter((group) => group.hits.length > 0)
			.map((group) => ({
				label: KIND_SCOPE_LABELS[group.kind] ?? group.kind,
				rows: group.hits.map((hit, i) =>
					hitRow(hit, `all-${group.kind}-${i}`)
				)
			}))
	})

	const groups = $derived.by<JumpRowGroup[]>(() => {
		if (!ready) return []
		const out: JumpRowGroup[] = []
		if (scope.key === null) {
			out.push(...everywhereGroups)
			// Documentation before Admin pages: the docs are everyone's, and
			// the admin lane is drawn for an administrator only.
			if (docRows.length)
				out.push({ label: KIND_SCOPE_LABELS.doc, rows: docRows })
			if (adminRows.length)
				out.push({ label: "Admin pages", rows: adminRows })
			return out
		}
		if (isAdminScope) {
			if (adminRows.length)
				out.push({ label: "Admin pages", rows: adminRows })
		} else if (isDocScope) {
			if (docRows.length)
				out.push({ label: KIND_SCOPE_LABELS.doc, rows: docRows })
		} else if (jumpCtx.registration) {
			if (viewRows.length)
				out.push({ label: scope.label, rows: viewRows })
		} else if (scopedKindRows.length) {
			out.push({ label: scope.label, rows: scopedKindRows })
		}
		if (tailRows.length)
			out.push({ label: EVERYWHERE_LABEL, rows: tailRows })
		return out
	})

	/**
	 * "Nothing matches" is an ANSWER, and an index still in flight has not
	 * given one — without this the first docs search of a session says the
	 * documentation has nothing in it for as long as the fetch takes.
	 */
	const docsPending = $derived(docsLane && docSections === null)

	const nothingMatches = $derived(
		ready && groups.length === 0 && !docsPending
	)

	/**
	 * The way out of a scope that found nothing — a row, not a hint, so it is
	 * one Enter away from wherever the cursor already is.
	 */
	const escapeRow = $derived<JumpRow | null>(
		nothingMatches && scope.key !== null
			? {
					id: "everywhere",
					title: "Search everywhere instead",
					icon: Icons.Globe,
					action: () => dropScope()
				}
			: null
	)

	const flatRows = $derived<JumpRow[]>([
		...groups.flatMap((group) => group.rows),
		...(escapeRow ? [escapeRow] : [])
	])

	const activeRow = $derived<JumpRow | undefined>(flatRows[highlight])

	// The highlight belongs to the list that is on screen: a new query, or a
	// list that shrank under it, starts back at the top rather than pointing
	// past the end. `untrack` around the write so this depends on the COUNT
	// only — reading the cursor it also assigns would make the effect its own
	// trigger.
	$effect(() => {
		const count = flatRows.length
		untrack(() => {
			if (highlight >= count) highlight = 0
		})
	})

	// Keep the highlighted row in the scroll box — Down past the fold has to
	// move the list, not the cursor off the bottom of it.
	$effect(() => {
		void activeRow
		listEl
			?.querySelector('[data-jump-active="true"]')
			?.scrollIntoView({ block: "nearest" })
	})

	/* ── the input ──────────────────────────────────────────────────────── */

	/**
	 * Leave the current scope, carrying what is typed with you.
	 *
	 * The text belongs to the person, not the scope: dropping to Everywhere
	 * with an empty box would make them type it again. The view's own filter
	 * keeps its text too — the list behind is still narrowed, which is what
	 * they can see.
	 */
	function dropScope() {
		const carried = jumpCtx.query
		jumpCtx.setScope(null)
		jumpCtx.query = carried
	}

	function handleInput(event: Event & { currentTarget: HTMLInputElement }) {
		const raw = event.currentTarget.value
		const parsed = parseKindPrefix(raw)
		if (parsed) {
			// The prefix was an instruction, never a filter. A view that has
			// been taking these keystrokes as its own filter gets them back off
			// it, or its list would sit narrowed to "tag:" behind the overlay.
			jumpCtx.registration?.setQuery("")
			jumpCtx.setScope(parsed.key)
			jumpCtx.query = parsed.rest
			// `value` is not bound, and the new query may equal the old one —
			// in which case Svelte has nothing to re-render and the DOM would
			// keep the prefix.
			event.currentTarget.value = parsed.rest
			return
		}
		jumpCtx.query = raw
	}

	function move(delta: number) {
		const count = flatRows.length
		if (count === 0) return
		highlight = (highlight + delta + count) % count
	}

	function handleKeydown(event: KeyboardEvent) {
		switch (event.key) {
			case "ArrowDown":
				event.preventDefault()
				move(1)
				return
			case "ArrowUp":
				event.preventDefault()
				move(-1)
				return
			case "Home":
				if (!flatRows.length) return
				event.preventDefault()
				highlight = 0
				return
			case "End":
				if (!flatRows.length) return
				event.preventDefault()
				highlight = flatRows.length - 1
				return
			case "Enter": {
				const row = activeRow
				if (!row) return
				event.preventDefault()
				void row.action()
				return
			}
			case "Backspace":
				// Only on an EMPTY box: otherwise this is an ordinary delete.
				if (jumpCtx.query !== "" || scope.key === null) return
				event.preventDefault()
				dropScope()
				return
		}
	}

	onMount(() => {
		KeyboardNavigationManager.announceToScreenReader(
			scope.key === null
				? "Jump, searching everywhere"
				: `Jump, scoped to ${scope.label}`
		)
		// After the dialog has taken focus for itself: the scope chip's × comes
		// first in the DOM, so left alone the trap lands there rather than on
		// the box you opened this to type in.
		const frame = requestAnimationFrame(() => inputEl?.focus())
		return () => cancelAnimationFrame(frame)
	})
</script>

<Dialog
	open={true}
	initialFocusEl={() => inputEl}
	onOpenChange={(e: OpenChangeDetails) => {
		if (!e.open) jumpCtx.close()
	}}
>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-950/60 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<!-- Below `lg` the panel is a sheet off the top edge; at `lg` it is the
		     command palette proper, 12vh down and centred. The Positioner's
		     flexbox does the centring the design calls `left-1/2
		     -translate-x-1/2` — one mechanism instead of two, and the sheet
		     needs no translate to undo. -->
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-start justify-center"
		>
			<Dialog.Content
				class="bg-surface-950 border-surface-800 flex max-h-[80vh] w-full flex-col overflow-hidden rounded-b-2xl border shadow-2xl lg:mt-[12vh] lg:max-h-[64vh] lg:w-[min(640px,92vw)] lg:rounded-2xl"
				role="dialog"
				aria-modal="true"
				aria-label="Jump to anything"
				onkeydown={handleKeydown}
			>
				<!-- ══ the input row ═══════════════════════════════════════ -->
				<div
					class="border-surface-800 flex h-14 shrink-0 items-center gap-2 border-b px-3"
				>
					<Icons.Search
						class="text-surface-500 size-4 shrink-0"
						aria-hidden="true"
					/>
					{#if scope.key !== null}
						<!-- The scope chip. Its × is the same thing Backspace
						     on an empty box does. -->
						<span
							class="bg-surface-800 text-surface-100 flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs"
						>
							{scope.label}
							<button
								type="button"
								class="hover:text-surface-50 text-surface-400 focus-visible:outline-primary-500 -mr-0.5 flex items-center rounded transition-colors focus-visible:outline-1"
								aria-label="Search everywhere instead of {scope.label}"
								onmousedown={(e) => e.preventDefault()}
								onclick={dropScope}
							>
								<Icons.X class="size-3" aria-hidden="true" />
							</button>
						</span>
					{/if}
					<!-- Every one of `border-0 p-0 bg-transparent shadow-none`
					     is undoing @tailwindcss/forms, which styles a bare
					     `[type="text"]` itself: a 1px grey border, square
					     corners (`border-radius: 0`), 0.5rem/0.75rem of
					     padding and a white background. Unopposed, that drew a
					     boxed, square, white field inside the overlay's own
					     search row — a control within a control. The row
					     supplies the box; the input is only the text in it.

					     The focus ring is spelled out for the same reason: the
					     plugin's focus state is a hard-coded BLUE (#2563eb)
					     ring, and `outline-none` does not touch it because the
					     plugin draws it as a box-shadow ring, not an outline.
					     Primary-500 is what the app's own inputs focus to
					     (Skeleton's `input` utility sets `--tw-ring-color:
					     var(--color-primary-500)`), and this one is not an
					     `.input` only because it is the borderless box inside
					     the overlay's search row. -->
					<input
						bind:this={inputEl}
						type="text"
						role="combobox"
						class="text-surface-50 placeholder:text-surface-500 focus:ring-primary-500 min-w-0 flex-1 border-0 bg-transparent p-0 text-base shadow-none outline-none focus:ring-2"
						placeholder={jumpCtx.placeholder}
						aria-label={jumpCtx.placeholder}
						aria-expanded={flatRows.length > 0}
						aria-controls="jump-results"
						aria-activedescendant={activeRow
							? `jump-row-${activeRow.id}`
							: undefined}
						autocomplete="off"
						autocorrect="off"
						autocapitalize="off"
						spellcheck="false"
						value={query}
						oninput={handleInput}
					/>
					<kbd
						class="border-surface-300-700 text-surface-600-400 shrink-0 rounded border px-1 py-px font-mono text-[11px]"
					>
						Esc
					</kbd>
				</div>

				<!-- ══ the results ═════════════════════════════════════════ -->
				<div
					bind:this={listEl}
					id="jump-results"
					role="listbox"
					aria-label="Jump results"
					class="min-h-0 flex-1 overflow-y-auto pb-2"
					tabindex="-1"
				>
					{#if !ready}
						<p class="text-surface-500 px-3 py-4 text-sm">
							{scope.key === null
								? "Type to jump anywhere"
								: `Type to search ${scope.label}`}
						</p>
					{:else}
						{#each groups as group (group.label)}
							<div role="group" aria-label={group.label}>
								<div
									class="text-surface-500 px-3 pt-3 pb-1 text-[11px]"
									aria-hidden="true"
								>
									{group.label}
								</div>
								{#each group.rows as row (row.id)}
									{@render resultRow(row)}
								{/each}
							</div>
						{/each}

						{#if nothingMatches}
							<p class="text-surface-500 px-3 py-4 text-sm">
								Nothing matches
							</p>
						{/if}
						{#if escapeRow}
							{@render resultRow(escapeRow)}
						{/if}
					{/if}
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>

<!-- One row. The selected convention is tonal surface plus a 3px inset
     `primary-500` bar — never a filled primary background. -->
{#snippet resultRow(row: JumpRow)}
	{@const isActive = activeRow?.id === row.id}
	<button
		type="button"
		id="jump-row-{row.id}"
		role="option"
		aria-selected={isActive}
		tabindex="-1"
		data-jump-active={isActive ? "true" : undefined}
		class="flex h-11 w-full items-center gap-3 px-3 text-left transition-colors {isActive
			? 'bg-surface-900 shadow-[inset_3px_0_0_0_var(--color-primary-500)]'
			: ''}"
		onmouseenter={() => {
			const index = flatRows.findIndex((r) => r.id === row.id)
			if (index >= 0) highlight = index
		}}
		onmousedown={(e) => e.preventDefault()}
		onclick={() => void row.action()}
	>
		<row.icon class="text-surface-400 size-4 shrink-0" aria-hidden="true" />
		<span class="min-w-0 flex-1">
			<span
				class="text-surface-50 flex min-w-0 items-center gap-1 text-sm"
			>
				<span class="truncate">{row.title}</span>
				{#if row.hint === "persona"}
					<Icons.UserRound
						size={14}
						class="text-primary-500 shrink-0"
						aria-hidden="true"
					/>
					<span class="sr-only">Persona</span>
				{/if}
			</span>
			{#if row.subtitle}
				<span class="text-surface-400 block truncate text-xs">
					{row.subtitle}
				</span>
			{/if}
		</span>
	</button>
{/snippet}
