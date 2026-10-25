<script lang="ts">
	/**
	 * 🚧 Admin › Rulesets (PLAN-ruleset-editor §6, P1): the changelist of every
	 * ruleset the pub knows — Serene Pub's, a plugin's, and the ones made on
	 * this pub (drafts included). Administrators read _Rulesets_ here; players
	 * see the same things under **Rules** (NOMENCLATURE §28's admin exception).
	 *
	 * A row opens its change form (`/admin/rulesets/<id>`): a pub ruleset is
	 * edited there; a shipped or plugin one is read there and copied to
	 * change. **Add ruleset** makes one under an owner slug of the admin's own
	 * (`/admin/rulesets/new`). Filters: origin and state. No bulk actions yet.
	 */
	import { getContext } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { getAdminInterestContext } from "$lib/client/sockets/interest.svelte"
	import AdminChangelist from "$lib/client/components/admin/AdminChangelist.svelte"
	import type {
		AdminChangelistColumn,
		AdminChangelistFilter
	} from "$lib/client/components/admin/changelist"
	import { rigourLabel } from "$lib/shared/rulesets/rigourLabels"
	import { docsHref } from "$lib/shared/utils/docsHref"
	import { originLabel, playedByText, stateLabel, STATE_ORDER } from "./rulesetLabels"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	// `rulesets:` is a RESTRICTED (admin-only) interest family.
	const interest = getAdminInterestContext()

	type Row = Sockets.Rulesets.ListRow
	let rows = $state<Row[]>([])
	let loading = $state(true)
	/** BARE and STANDING: every write re-sends the list, so a change form's Publish shows here. */
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		return interest.requestWithInterest("rulesets:list", {}, (res) => {
			rows = res.rulesets
			loading = false
		})
	})

	/**
	 * How strict it can play (`rulesetDecides`, 2026-10-22): a ruleset that
	 * decides anything by its rules plays every level; one that decides
	 * nothing plays Words only. Dice are not the test (ruling R1).
	 */
	const plays = (r: Row) => (r.decides ? `Up to ${rigourLabel("scripts")}` : rigourLabel("prose"))
	const played = (r: Row) => r.playedBy.sessions + r.playedBy.lorebooks

	const columns: AdminChangelistColumn<Row>[] = [
		{ key: "name", label: "Ruleset", primary: true, text: (r) => r.label, sortValue: (r) => r.label },
		{ key: "origin", label: "Origin", text: (r) => originLabel(r.origin, r.rulesetId, r.pluginName), sortValue: (r) => r.origin },
		{
			key: "state",
			label: "State",
			text: (r) => stateLabel(r.state, r.draftChanged),
			sortValue: (r) => STATE_ORDER.indexOf(r.state)
		},
		{ key: "version", label: "Version", text: (r) => r.version ?? "", sortValue: (r) => r.version ?? "" },
		{ key: "plays", label: "Plays", text: plays, sortValue: (r) => (r.decides ? 1 : 0) },
		{ key: "played", label: "Played by", text: (r) => playedByText(r.playedBy), sortValue: played },
		{
			key: "id",
			label: "Id",
			text: (r) => r.rulesetId,
			sortValue: (r) => r.rulesetId,
			class: "font-mono text-xs",
			hideWhenStacked: true
		}
	]

	const filters: AdminChangelistFilter<Row>[] = [
		{
			key: "origin",
			label: "Origin",
			values: (r) => r.origin,
			optionLabel: (v) => (v === "core" ? "Serene Pub" : v === "pub" ? "This pub" : "Plugins"),
			order: ["pub", "core", "plugin"]
		},
		{
			key: "state",
			label: "State",
			values: (r) => r.state,
			optionLabel: (v) => stateLabel(v as Row["state"], false),
			order: STATE_ORDER
		}
	]
</script>

<AdminChangelist
	title="Rulesets"
	purpose="The rules sessions and lorebooks can play, offered under Rules. Copy one to make rules of your own, then publish it."
	doc={docsHref("rulesets", "making-rules-of-your-own")}
	addHref="/admin/rulesets/new"
	addLabel="Add ruleset"
	{rows}
	rowKey={(r) => r.rulesetId}
	{columns}
	{filters}
	{loading}
	noun={{ singular: "ruleset", plural: "rulesets" }}
	searchText={(r) => `${r.label} ${r.name} ${r.rulesetId} ${r.description} ${r.pluginName ?? ""}`}
	rowHref={(r) => `/admin/rulesets/${encodeURIComponent(r.rulesetId)}`}
	defaultSort="name"
	emptyIcon={Icons.Scale}
	emptyMessage="No rulesets: Serene Pub registers Freeform at startup, so an empty list means the startup failed."
/>
