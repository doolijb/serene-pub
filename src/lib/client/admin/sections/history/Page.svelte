<script lang="ts">
	/**
	 * Admin › Pub › History — the admin logbook (`admin:logbook`) as Django's
	 * read-only **changelist**: who changed what on this instance, and when.
	 * No Add, no bulk actions; a row opens its record's change view
	 * (`/admin/history/:id`, `IdPage.svelte`).
	 *
	 * The ADDRESS is the server's query. The changelist writes its search
	 * (`q`) and its **changelist filters** — Object (`type`), Who (`actor`),
	 * Action (`action`), When (`when`, Django's `DateFieldListFilter`) — into
	 * the query; this page reads them back and asks the server, which filters
	 * and pages by cursor (newest first, "Load older changes"). So the facets
	 * list their full option sets, uncounted (`counted: false`): the loaded
	 * rows are one page of an already-filtered answer.
	 *
	 * `?type=<logbook object type>&id=<id>` is the contract every change
	 * form's History button links to: `id` rides through untouched
	 * (`keepQuery`), is named by the chip under the header, and drops when the
	 * Object facet changes.
	 */
	import { getContext, untrack } from "svelte"
	import * as Icons from "@lucide/svelte"
	import {
		adminGoto as goto,
		adminPage as page,
		adminReplaceState
	} from "$lib/client/admin/adminRouter.svelte"
	import { getInterestContext } from "$lib/client/sockets/interest.svelte"
	import AdminChangelist from "$lib/client/components/admin/AdminChangelist.svelte"
	import type {
		AdminChangelistColumn,
		AdminChangelistFilter
	} from "$lib/client/components/admin/changelist"
	import {
		LOGBOOK_ACTIONS,
		LOGBOOK_ACTION_LABELS,
		LOGBOOK_OBJECT_TYPES,
		type LogbookAction,
		type LogbookRecordView
	} from "$lib/shared/adminLogbook"
	import {
		ACTION_ICON,
		ACTION_TONE,
		WHEN_OPTIONS,
		capitalize,
		fmtWhen,
		objectName,
		typeLabel,
		whenSince
	} from "./logbookView"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const interest = getInterestContext()

	/** Records a server page; the changelist pages what is loaded. */
	const PAGE = 100

	/* ── the query, read from the address ─────────────────────────────── */

	const qp = (k: string) => page.url.searchParams.get(k) ?? ""
	let type = $derived(qp("type"))
	let objectId = $derived(page.url.searchParams.get("id"))
	let actor = $derived(qp("actor"))
	let action = $derived(qp("action"))
	let when = $derived(qp("when"))
	let q = $derived(qp("q"))

	/** Writes one key into the address; `null` removes it. */
	function setParam(key: string, value: string | null) {
		const next = new URLSearchParams(page.url.searchParams)
		if (value == null || value === "") next.delete(key)
		else next.set(key, value)
		const s = next.toString()
		adminReplaceState(s ? `?${s}` : "?", {} as App.PageState)
	}

	// Choosing another object type drops the one object it was narrowed to.
	let lastType = untrack(() => type)
	$effect(() => {
		const t = type
		if (t === lastType) return
		lastType = t
		if (untrack(() => objectId) != null) untrack(() => setParam("id", null))
	})

	/**
	 * The search, sent after a pause: the changelist writes `q` on every
	 * keystroke, and one request a keystroke is not a search.
	 */
	let text = $state(untrack(() => q.trim()))
	$effect(() => {
		const v = q.trim()
		const timer = setTimeout(() => (text = v), 300)
		return () => clearTimeout(timer)
	})

	/* ── the read ─────────────────────────────────────────────────────── */

	let records: LogbookRecordView[] = $state([])
	let actors: Array<{ id: number | null; name: string }> = $state([])
	let hasMore = $state(false)
	let loading = $state(true)
	let loadingOlder = $state(false)
	/** The request whose reply is current; older replies are dropped. */
	let currentRequest = ""
	/** Replies to "Load older" append; a fresh query replaces. */
	let appendFor = ""

	let query = $derived<Sockets.Admin.Logbook.Params>({
		objectType: type || null,
		objectId: type ? objectId : null,
		actorUserId: actor && /^\d+$/.test(actor) ? Number(actor) : null,
		action: (LOGBOOK_ACTIONS as readonly string[]).includes(action)
			? (action as LogbookAction)
			: null,
		since: whenSince(when),
		text: text || null,
		limit: PAGE
	})

	const onReply = (res: Sockets.Admin.Logbook.Response) => {
		if (res.requestId !== currentRequest) return
		records =
			appendFor === currentRequest ? [...records, ...res.records] : res.records
		actors = res.actors
		hasMore = res.hasMore
		loading = false
		loadingOlder = false
	}

	let seq = 0
	function request(params: Sockets.Admin.Logbook.Params, append: boolean) {
		const requestId = `h${++seq}`
		currentRequest = requestId
		appendFor = append ? requestId : ""
		// Its own handler per request: the registry dedupes by reference, so a
		// shared one would be released by whichever request let go first.
		return interest.requestWithInterest(
			"admin:logbook",
			{ ...params, requestId },
			(res) => onReply(res)
		)
	}

	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const params = query
		return untrack(() => {
			loading = true
			return request(params, false)
		})
	})

	let releaseOlder: (() => void) | null = null
	function loadOlder() {
		const last = records[records.length - 1]
		if (!last || loadingOlder) return
		loadingOlder = true
		releaseOlder?.()
		releaseOlder = request({ ...query, before: last.id }, true)
	}
	$effect(() => () => releaseOlder?.())

	$effect(() => {
		if (userCtx.user && !userCtx.user.isAdmin) goto("/")
	})

	/* ── the changelist ───────────────────────────────────────────────── */

	/** The one object this page is narrowed to, named from its newest record. */
	let narrowedTo = $derived(
		type && objectId != null
			? records.find((r) => (r.objectId ?? "") === objectId)?.objectLabel ||
					(objectId ? `#${objectId}` : typeLabel(type))
			: null
	)

	const columns: AdminChangelistColumn<LogbookRecordView>[] = [
		{
			key: "when",
			label: "When",
			custom: true,
			text: (r) => fmtWhen(r.at),
			// The id is the logbook's order; two records in one second keep it.
			sortValue: (r) => r.id,
			class: "whitespace-nowrap"
		},
		{ key: "who", label: "Who", text: (r) => r.actorName },
		{ key: "action", label: "Action", custom: true },
		{
			key: "object",
			label: "Object",
			custom: true,
			text: (r) => `${typeLabel(r.objectType)} ${r.objectLabel}`
		},
		{ key: "summary", label: "Change", primary: true, text: (r) => r.summary }
	]

	const filters: AdminChangelistFilter<LogbookRecordView>[] = $derived([
		{
			key: "type",
			label: "Object",
			counted: false,
			options: Object.entries(LOGBOOK_OBJECT_TYPES)
				.map(([value, t]) => ({ value, label: capitalize(t.label) }))
				.sort((a, b) => a.label.localeCompare(b.label))
		},
		{
			key: "actor",
			label: "Who",
			counted: false,
			options: actors
				.filter((a) => a.id != null)
				.map((a) => ({ value: String(a.id), label: a.name }))
				.sort((a, b) => a.label.localeCompare(b.label))
		},
		{
			key: "action",
			label: "Action",
			counted: false,
			options: LOGBOOK_ACTIONS.map((a) => ({
				value: a,
				label: LOGBOOK_ACTION_LABELS[a]
			}))
		},
		{
			key: "when",
			label: "When",
			counted: false,
			allLabel: "Any date",
			options: WHEN_OPTIONS
		}
	])
</script>

<AdminChangelist
	title="History"
	purpose="Who changed what on this pub, and when. Records are kept for 90 days; secrets are never written down."
	rows={records}
	rowKey={(r) => r.id}
	{columns}
	{filters}
	{loading}
	serverSearch
	keepQuery={["id"]}
	noun={{ singular: "change", plural: "changes" }}
	rowHref={(r) => `/admin/history/${r.id}`}
	defaultSort="when"
	defaultSortDir="desc"
	emptyIcon={Icons.History}
	emptyMessage="No changes recorded yet. Changes made in the admin sections will appear here."
>
	{#snippet headerExtra()}
		{#if narrowedTo != null}
			<div class="flex flex-wrap items-center gap-2 text-sm">
				<span
					class="preset-tonal-primary flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-xs"
				>
					{objectName(type, narrowedTo)}
					<button
						type="button"
						class="hover:preset-tonal-surface flex size-6 items-center justify-center rounded-full"
						aria-label="Show every {typeLabel(type)}"
						onclick={() => setParam("id", null)}
					>
						<Icons.X size={12} aria-hidden="true" />
					</button>
				</span>
			</div>
		{/if}
	{/snippet}
	{#snippet cell(row, col)}
		{#if col.key === "when"}
			<time class="text-surface-700-300 text-xs whitespace-nowrap" datetime={row.at}>
				{fmtWhen(row.at)}
			</time>
		{:else if col.key === "action"}
			{@const Icon = Icons[ACTION_ICON[row.action]]}
			<span
				class="{ACTION_TONE[row.action]} inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
			>
				<Icon size={12} aria-hidden="true" />
				{LOGBOOK_ACTION_LABELS[row.action]}
			</span>
		{:else if col.key === "object"}
			<span class="flex min-w-0 flex-col">
				<span class="truncate">{row.objectLabel || typeLabel(row.objectType)}</span>
				<span class="text-surface-600-400 text-[11px]">
					{typeLabel(row.objectType)}
				</span>
			</span>
		{/if}
	{/snippet}
</AdminChangelist>

{#if hasMore && !loading}
	<div class="mt-3 flex justify-center">
		<button
			type="button"
			class="btn btn-sm preset-tonal-surface"
			onclick={loadOlder}
			disabled={loadingOlder}
		>
			{#if loadingOlder}
				<Icons.LoaderCircle size={16} class="animate-spin" aria-hidden="true" />
			{:else}
				<Icons.ChevronsDown size={16} aria-hidden="true" />
			{/if}
			Load older changes
		</button>
	</div>
{/if}
