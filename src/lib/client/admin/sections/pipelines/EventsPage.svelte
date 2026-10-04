<script lang="ts">
	/**
	 * Admin › Pipelines › Events (PLAN-turn-order §B2; note 37, Django admin):
	 * the read-only **changelist** of every event this instance knows — core's,
	 * then each enabled package's — with its family, who declared it, the
	 * genres that list it and how many presets bind it. Filters: family,
	 * declared by, genre (`?genre=<id>`, the genre hub's link) and bound.
	 * A row opens the event's change view (`EventIdPage`), which carries the
	 * event map.
	 *
	 * Read-only by design: events arrive with code (core and packages), and
	 * an event binding is edited on its preset's change form — so no Add, no
	 * Delete and no bulk action. The old `?event=<id>` deep link opens that
	 * event's change view. Admin-only: redirected here, refused again by the
	 * handler.
	 */
	import { getContext, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { adminGoto as goto, adminPage } from "$lib/client/admin/adminRouter.svelte"
	import { getInterestContext } from "$lib/client/sockets/interest.svelte"
	import AdminChangelist from "$lib/client/components/admin/AdminChangelist.svelte"
	import type {
		AdminChangelistColumn,
		AdminChangelistFilter
	} from "$lib/client/components/admin/changelist"
	import { STANDARD_GENRE_ID } from "$lib/client/components/sessionForms/createSession.svelte"
	import { eventHref } from "./eventsAdmin"

	type Row = Sockets.Pipelines.EventMap.RegistryRow

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const interest = getInterestContext()

	// The page's old `?event=<id>` selection: the event's change view is its
	// page now, so the deep link opens it, its map scope with it. Read before
	// the changelist mounts and rewrites the query.
	const legacy = new URLSearchParams(typeof window !== "undefined" ? adminPage.url.search : "")
	const legacyEvent = legacy.get("event")
	legacy.delete("event")

	onMount(() => {
		if (!userCtx.user?.isAdmin) {
			goto("/")
			return
		}
		if (legacyEvent) void goto(eventHref(legacyEvent, legacy), { replaceState: true })
	})

	let events = $state<Row[]>([])
	let genres = $state<Array<{ genreId: string; name: string }>>([])
	let loading = $state(true)
	let error = $state<string | null>(null)

	/**
	 * BARE interest: `pipelines:eventMap` is about the instance, not one
	 * session. Its registry is the same whatever the scope; the map it also
	 * draws is asked for on Chat, the smallest useful one — the change view
	 * draws the map. The app-wide context, not `adminInterest`: `pipelines:`
	 * is a mixed family, so this is an ordinary key behind the page's own
	 * admin check.
	 */
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const releases = [
			interest.requestWithInterest(
				"pipelines:eventMap",
				{ genreId: STANDARD_GENRE_ID },
				(res) => {
					if (res.error) error = res.error
					else {
						events = res.events ?? []
						genres = res.genres ?? []
						error = null
					}
					loading = false
				}
			),
			interest.declareInterest<"pipelines:eventMap:error">(
				"pipelines:eventMap:error",
				(res) => {
					error = res.error ?? "The events could not be read."
					loading = false
				}
			)
		]
		return () => {
			for (const release of releases) release()
		}
	})

	const genreName = (id: string) => genres.find((g) => g.genreId === id)?.name ?? id
	const ownerWord = (owner: string) => (owner === "core" ? "Core" : owner)
	const FAMILY_WORD: Record<string, string> = { data: "Data", action: "Action" }

	const columns: AdminChangelistColumn<Row>[] = [
		{ key: "label", label: "Event", primary: true, text: (e) => e.label, sortValue: (e) => e.label },
		{
			key: "id",
			label: "Id",
			text: (e) => e.id,
			sortValue: (e) => e.id,
			class: "font-mono text-xs",
			hideWhenStacked: true
		},
		{
			key: "family",
			label: "Family",
			text: (e) => FAMILY_WORD[e.family] ?? e.family,
			sortValue: (e) => e.family
		},
		{
			key: "owner",
			label: "Declared by",
			text: (e) => ownerWord(e.owner),
			// Core first, then packages by id.
			sortValue: (e) => (e.owner === "core" ? "" : e.owner)
		},
		{
			key: "genres",
			label: "Genres",
			text: (e) => e.genres.map((g) => genreName(g.genreId)).join(", ") || "—",
			sortValue: (e) => e.genres.length
		},
		{
			key: "presets",
			label: "Presets",
			numeric: true,
			text: (e) => String(e.presets),
			sortValue: (e) => e.presets
		}
	]

	const filters: AdminChangelistFilter<Row>[] = $derived([
		{
			key: "family",
			label: "Family",
			values: (e) => e.family,
			optionLabel: (v) => FAMILY_WORD[v] ?? v,
			order: ["data", "action"]
		},
		{ key: "owner", label: "Declared by", values: (e) => e.owner, optionLabel: ownerWord, order: ["core"] },
		{
			key: "genre",
			label: "Genre",
			values: (e) => e.genres.map((g) => g.genreId),
			optionLabel: genreName
		},
		{
			key: "bound",
			label: "Bound",
			values: (e) => (e.presets > 0 ? "bound" : "unbound"),
			optionLabel: (v) => (v === "bound" ? "Bound by a preset" : "Unbound"),
			order: ["bound", "unbound"]
		}
	])
</script>

<AdminChangelist
	title="Events"
	purpose="Every event this pub knows, and which pipelines and listeners answer and cause each one."
	rows={events}
	rowKey={(e) => e.id}
	{columns}
	{filters}
	{loading}
	noun={{ singular: "event", plural: "events" }}
	searchText={(e) => `${e.label} ${e.id} ${e.owner} ${e.description}`}
	rowHref={(e) => eventHref(e.id)}
	emptyIcon={Icons.Zap}
	emptyMessage="No events are registered. Core registers its own at startup, so an empty list usually means the event registry did not load — check the server log."
>
	{#snippet headerExtra()}
		{#if error}
			<p class="text-error-600-400 text-sm" role="alert">{error}</p>
		{/if}
	{/snippet}
</AdminChangelist>
