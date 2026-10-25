<script lang="ts">
	import FieldHelp from "$lib/client/components/FieldHelp.svelte"
	import Badge from "$lib/client/components/Badge.svelte"
	/**
	 * 🚧 **How this looks on a character sheet** (PLAN-rulesets-functions D8,
	 * lane A4, 2026-10-23): the scene's first member as a stock widget would
	 * draw them, from each type's shown-as hint — a bar, pips, a badge, a
	 * list, a fan, ties. A sketch to judge the hints by, not the widget: a
	 * ruleset never ships a widget.
	 */
	import { CARRIED_ZONE_TYPE, i18nText } from "@serene-pub/sdk"
	import { splitWords, type AttributeRow, type SectionsForm } from "./rulesetSectionsForm"
	import type { SceneMember } from "./rulesetScene"
	import { attributeName, visibilityWords } from "./rulesetWords"

	type SlotChoice = Sockets.Rulesets.DetailRow["slotChoices"][number]

	interface Props {
		form: SectionsForm
		member: SceneMember | null
		slotChoices: readonly SlotChoice[]
	}
	let { form, member, slotChoices }: Props = $props()

	const who = $derived(member?.name || "Someone")
	const valueOf = (a: AttributeRow): string => member?.values[a.id]?.trim() || a.start.trim() || (a.kind === "pool" ? a.max : a.kind === "label" ? (splitWords(a.of)[0] ?? "") : a.min) || ""
	const numberOf = (a: AttributeRow) => Number(valueOf(a)) || 0
	const most = (a: AttributeRow) => Number(a.max) || Math.max(numberOf(a), 1)
	/** A held row's name, as its library row says it. */
	const rowName = (type: string, id: string) => {
		const r = form.library.lists.find((l) => l.repertoireId === type)?.rows.find((x) => x.id === id)
		return (typeof r?.piece.name === "string" && r.piece.name) || id
	}
	const zones = $derived([
		// A zone type still blank (no id yet) is not drawn: nothing can sit in it (RF fix 2).
		...form.zoneTypes.filter((z) => z.id.trim()).map((z) => ({
			id: z.id,
			name: z.name || z.id,
			holds: z.holdsAny ? ("*" as const) : z.holds,
			visibility: z.visibility,
			limit: z.limitKind === "number" ? z.limit : "",
			shownAs: z.shownAs || "list"
		})),
		...(form.zoneTypes.some((z) => z.id === "carried")
			? []
			: [{ id: "carried", name: i18nText(CARRIED_ZONE_TYPE.name) ?? "Carried", holds: "*" as const, visibility: "everyone", limit: "", shownAs: "list" }])
	])
	/**
	 * Where each held thing sits: the first of the ruleset's own zone types
	 * that names its entry type, else the carried list; a relational one is a
	 * tie, drawn with the ties. Each thing once.
	 */
	const placed = $derived.by(() => {
		const out = new Map<string, string[]>()
		for (const [type, ids] of Object.entries(member?.held ?? {})) {
			if (!ids.length || form.entryTypes.find((e) => e.id === type)?.relational) continue
			const zone = zones.find((z) => z.holds !== "*" && z.holds.includes(type)) ?? zones.find((z) => z.id === "carried") ?? zones[0]
			if (!zone) continue
			out.set(zone.id, [...(out.get(zone.id) ?? []), ...ids.map((id) => rowName(type, id))])
		}
		return out
	})
	const heldIn = (zone: string): string[] => placed.get(zone) ?? []
	const tiesOf = (type: string): string[] => (member?.held[type] ?? []).map((id) => rowName(type, id))
	const ties = $derived(form.entryTypes.filter((e) => e.relational))
</script>

<div class="panel-card flex flex-col gap-2" aria-labelledby="sheet-preview-heading" data-sheet-preview>
	<h3 id="sheet-preview-heading" class="text-sm font-medium">How this looks on a character sheet</h3>
	<div class="grid gap-2 @min-[32rem]/zones:grid-cols-2 @min-[52rem]/zones:grid-cols-3">
		{#if form.attributes.length}
			<div class="border-surface-200-800 flex flex-col gap-1.5 rounded-md border px-3 py-2 text-sm">
				<p class="text-surface-600-400 text-xs">{who}</p>
				{#each form.attributes as a (a.uid)}
					{@const hint = a.shownAs || (a.kind === "pool" ? "pips" : a.kind === "label" ? "badge" : a.kind === "list" ? "list" : "bar")}
					<div class="flex flex-wrap items-center gap-2" data-shown-as={hint}>
						<span class="min-w-20">{attributeName(a, slotChoices)}</span>
						{#if hint === "bar"}
							<span class="bg-surface-200-800 h-1.5 min-w-16 flex-1 overflow-hidden rounded-full" aria-hidden="true">
								<span class="bg-primary-500 block h-full" style="width: {Math.min(100, Math.round((numberOf(a) / most(a)) * 100))}%"></span>
							</span>
							<span class="tabular-nums">{valueOf(a) || "—"}</span>
						{:else if hint === "pips"}
							<span class="flex gap-0.5" aria-label="{numberOf(a)} of {most(a)}">
								{#each Array.from({ length: Math.min(most(a), 12) }) as _, i (i)}
									<span class="h-2.5 w-2.5 rounded-full {i < numberOf(a) ? 'bg-primary-500' : 'border-surface-400-600 border'}"></span>
								{/each}
							</span>
						{:else if hint === "badge"}
							<Badge size="md">{valueOf(a) || "—"}</Badge>
						{:else}
							<span>{valueOf(a) || "—"}</span>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
		{#each zones as z, zi (`${z.id}#${zi}`)}
			{@const items = heldIn(z.id)}
			<div class="border-surface-200-800 flex flex-col gap-1 rounded-md border px-3 py-2 text-sm" data-sheet-zone={z.id}>
				<p class="text-surface-600-400 flex justify-between gap-2 text-xs">
					<span>{who} · {z.name}</span>
					<span>{z.limit ? `${items.length} of ${z.limit}` : visibilityWords(z.visibility).toLowerCase()}</span>
				</p>
				{#if z.shownAs === "fan"}
					<div class="flex gap-1">{#each items as it, i (i)}<span class="border-surface-200-800 rounded border px-1.5 py-2 text-xs">{it}</span>{/each}</div>
				{:else}
					{#each items as it, i (i)}<p>{it}</p>{:else}<p class="text-surface-600-400 text-xs">Nothing in it yet.</p>{/each}
				{/if}
			</div>
		{/each}
		{#each ties as t (t.uid)}
			{@const items = tiesOf(t.id)}
			<div class="border-surface-200-800 flex flex-col gap-1 rounded-md border px-3 py-2 text-sm" data-sheet-ties={t.id}>
				<p class="text-surface-600-400 text-xs">{who} · {t.name || t.id}</p>
				{#each items as it, i (i)}<p>{it}</p>{:else}<p class="text-surface-600-400 text-xs">No one yet.</p>{/each}
			</div>
		{/each}
	</div>
	<FieldHelp>Stock widgets draw these from the hints on each type: a list, a fan, a bar. A ruleset never ships a widget.</FieldHelp>
</div>
