<script lang="ts">
	import FieldHelp from "$lib/client/components/FieldHelp.svelte"
	/**
	 * 🚧 **Zone types** (PLAN-rulesets-functions D5, D8; lane A4, 2026-10-23):
	 * where entries sit — a pocket, a shelf, a hand, a deck. Declared once;
	 * every owner that may carry one gets its own. Who sees a thing is decided
	 * by the zone it is in, so moving a keepsake from a pocket to a shelf is
	 * what reveals it. Only the author's own zone types are cards here, with
	 * those the catalogue's functions bring offered beside them (RF fix 2,
	 * item 4, ruled 2026-10-23): the host's **carried** list — where an entry
	 * type no zone type holds lives — is never a card, never counted, never
	 * the author's. Under the cards, **How this looks on a character sheet**
	 * (`RulesetSheetPreview`), drawn from each type's shown-as hint.
	 */
	import * as Icons from "@lucide/svelte"
	import { i18nText } from "@serene-pub/sdk"
	import RulesetInlinePick from "./RulesetInlinePick.svelte"
	import RulesetRowFindings from "./RulesetRowFindings.svelte"
	import RulesetSheetPreview from "./RulesetSheetPreview.svelte"
	import { idFromName, newZoneType, removeZoneType, type FindingsByRow, type SectionsForm, type ZoneTypeRow } from "./rulesetSectionsForm"
	import type { SceneMember } from "./rulesetScene"
	import { carriedWords, OWNER_OPTIONS, SHOWN_AS_OPTIONS, visibilityWords, VISIBILITY_WORDS } from "./rulesetWords"

	type FunctionChoice = Sockets.Rulesets.DetailRow["functionChoices"][number]
	type SlotChoice = Sockets.Rulesets.DetailRow["slotChoices"][number]

	interface Props {
		form: SectionsForm
		scopes: readonly { value: string; label: string }[]
		choices: readonly FunctionChoice[]
		slotChoices: readonly SlotChoice[]
		member: SceneMember | null
		/** 🚧 The saved draft's findings, by row (RF fix 2): said on the card, after a Save. */
		findings?: FindingsByRow
		readonly?: boolean
	}
	let { form = $bindable(), scopes, choices, slotChoices, member, findings, readonly = false }: Props = $props()

	let editing = $state<Record<string, boolean>>({})
	const visibilityChoices = $derived([...VISIBILITY_WORDS.map((v) => ({ ...v })), ...scopes])
	const entryChoices = $derived(form.entryTypes.map((e) => ({ value: e.id, label: e.name || e.id })))
	const attributeChoices = $derived(form.attributes.map((a) => ({ value: a.id, label: a.name || a.id })))
	/** Zone types the catalogue's functions bring (`adds.zoneTypes`), by name, not yet declared here. */
	const offered = $derived(
		choices.flatMap((c) =>
			((c.decl.adds?.zoneTypes ?? []) as unknown as { id: string; name?: unknown; prose?: string }[])
				.filter((z) => !form.zoneTypes.some((x) => x.id === z.id))
				.map((z) => ({ id: z.id, name: i18nText(z.name as never) ?? z.id, prose: z.prose ?? "", from: c.name }))
		)
	)
	const holdsWords = (z: ZoneTypeRow) =>
		z.holdsAny ? "Anything" : !z.holds.length ? "Nothing yet" : z.holds.map((h) => form.entryTypes.find((e) => e.id === h)?.name || h).join(", ")
	const limitWords = (z: ZoneTypeRow) =>
		z.limitKind === "number" && z.limit.trim() ? z.limit.trim() : z.limitKind === "attribute" && z.limitAttribute ? `by ${form.attributes.find((a) => a.id === z.limitAttribute)?.name || z.limitAttribute}` : "none"

	function add(name = "") {
		const row = newZoneType(form, name)
		form.zoneTypes = [...form.zoneTypes, row]
		editing[row.uid] = true
		queueMicrotask(() => document.getElementById(`zt-name-${row.uid}`)?.focus())
	}
	function adopt(o: { id: string; name: string; prose: string }) {
		const row = newZoneType(form, o.name)
		row.id = o.id
		row.prose = o.prose
		form.zoneTypes = [...form.zoneTypes, row]
	}
	/** A new zone type takes its id from its name, until one is typed. */
	function named(z: ZoneTypeRow, v: string) {
		z.id = idFromName(z, form.zoneTypes, v, "zone")
		z.name = v
	}
</script>

<section class="@container/zones flex min-w-0 flex-col gap-3" aria-labelledby="zone-types-heading" data-section="zoneTypes">
	<div class="flex min-w-0 flex-col gap-0.5">
		<h2 id="zone-types-heading" class="text-base font-medium">Zone types</h2>
		<FieldHelp>Where entries sit. Declared once; every owner that may carry one gets its own. Who sees a thing is decided by the zone it's in.</FieldHelp>
	<FieldHelp data-zone-fallback>An entry type no zone type holds lives with what someone carries, which every session has. Add a zone type only where you want it kept apart.</FieldHelp>
	</div>

	<ul class="grid gap-3 @min-[32rem]/zones:grid-cols-2 @min-[52rem]/zones:grid-cols-3">
		{#each form.zoneTypes as z (z.uid)}
			<li class="panel-card flex flex-col gap-1.5 text-sm" data-zone-type={z.id || z.uid}>
				{#if readonly || !editing[z.uid]}
					<h3 class="text-base font-medium">{z.name || z.id || "New zone type"}</h3>
					<p class="text-surface-700-300">{z.prose || "No sentence yet."}</p>
				{:else}
					<label class="text-surface-600-400 flex flex-col gap-1 text-xs">
						Name
						<input id="zt-name-{z.uid}" class="input" type="text" value={z.name} placeholder="Shelf" oninput={(e) => named(z, e.currentTarget.value)} />
					</label>
					<label class="text-surface-600-400 flex flex-col gap-1 text-xs">
						What the model reads
						<textarea class="textarea" rows={2} bind:value={z.prose} placeholder="Keepsakes on display at home. Anyone who visits sees them." aria-invalid={!z.prose.trim()}></textarea>
					</label>
				{/if}
				<p class="flex flex-wrap items-center gap-1">
					<span class="text-surface-600-400">Carried by:</span>
					<RulesetInlinePick many label="Who carries {z.name || 'it'}" choices={OWNER_OPTIONS} value={z.owners} text={carriedWords(z.owners).toLowerCase()} {readonly} onchange={(v) => (z.owners = v as string[])} />
				</p>
				<p class="flex flex-wrap items-center gap-1">
					<span class="text-surface-600-400">Holds:</span>
					<RulesetInlinePick
						many
						label="What {z.name || 'it'} holds"
						choices={entryChoices}
						value={z.holdsAny ? [] : z.holds}
						text={holdsWords(z)}
						{readonly}
						onchange={(v) => {
							z.holds = v as string[]
							z.holdsAny = !(v as string[]).length
						}}
					/>
				</p>
				{#if !z.holdsAny && !z.holds.length}
					<p class="text-warning-700-300 text-xs" data-holds-nothing>Holds nothing yet: pick what it holds.</p>
				{/if}
				<p class="flex flex-wrap items-center gap-1">
					<span class="text-surface-600-400">Limit:</span>
					{#if readonly || !editing[z.uid]}{limitWords(z)}{:else}
						<RulesetInlinePick
							label="How {z.name || 'it'} is limited"
							choices={[
								{ value: "none", label: "None" },
								{ value: "number", label: "A number" },
								{ value: "attribute", label: "As an attribute says" }
							]}
							value={z.limitKind}
							onchange={(v) => (z.limitKind = String(v))}
						/>
						{#if z.limitKind === "number"}<input class="input min-h-8 w-16 px-2 py-0" type="text" inputmode="numeric" bind:value={z.limit} aria-label="At most" />{/if}
						{#if z.limitKind === "attribute"}<RulesetInlinePick label="The attribute that limits it" choices={attributeChoices} value={z.limitAttribute} onchange={(v) => (z.limitAttribute = String(v))} />{/if}
					{/if}
					<span class="text-surface-600-400">· Ordered:</span>
					{#if readonly || !editing[z.uid]}{z.ordered ? "yes" : "no"}{:else}<input type="checkbox" class="checkbox" bind:checked={z.ordered} aria-label="Its order means something" />{/if}
				</p>
				<p class="flex flex-wrap items-center gap-1">
					<span class="text-surface-600-400">Who sees it:</span>
					<RulesetInlinePick label="Who sees what is in {z.name || 'it'}" choices={visibilityChoices} value={z.visibility} text={visibilityWords(z.visibility, scopes)} {readonly} onchange={(v) => (z.visibility = String(v))} />
				</p>
				{#if editing[z.uid] && !readonly}
					<p class="flex flex-wrap items-center gap-1">
						<span class="text-surface-600-400">Shown as:</span>
						<RulesetInlinePick label="How a widget shows {z.name || 'it'}" choices={SHOWN_AS_OPTIONS} value={z.shownAs} onchange={(v) => (z.shownAs = String(v))} />
					</p>
					<label class="text-surface-600-400 flex flex-col gap-1 text-xs">
						Id
						<input class="input font-mono" type="text" bind:value={z.id} spellcheck="false" />
					</label>
					<button type="button" class="btn btn-sm preset-tonal-error self-start" onclick={() => removeZoneType(form, z.uid)} data-remove-zone-type>
						<Icons.Trash2 size={14} aria-hidden="true" /> Remove
					</button>
				{/if}
				{#if !readonly}
					<button type="button" class="text-primary-ink min-h-8 self-start text-xs underline-offset-2 hover:underline" aria-expanded={!!editing[z.uid]} onclick={() => (editing[z.uid] = !editing[z.uid])} data-zone-type-edit>
						{editing[z.uid] ? "Done" : "Edit…"}
					</button>
				{/if}
				<RulesetRowFindings findings={findings?.rows[z.uid] ?? []} label={z.name || z.id || "This zone type"} />
			</li>
		{/each}
		<li class="border-surface-300-700 text-surface-600-400 flex flex-col gap-1.5 rounded-base border border-dashed p-4 text-sm" data-zone-catalogue>
			<h3 class="text-surface-950-50 text-base font-medium">From the catalogue</h3>
			{#each offered as o (o.id)}
				<p class="flex flex-wrap items-center gap-2">
					<span><strong class="text-surface-950-50">{o.name}</strong> · {o.prose || `from ${o.from}`}</span>
					{#if !readonly}<button type="button" class="btn btn-sm preset-tonal-surface" onclick={() => adopt(o)}>Use it</button>{/if}
				</p>
			{:else}
				<p>The functions you use bring no zone types of their own yet.</p>
			{/each}
			{#if !readonly}
				<button type="button" class="btn btn-sm preset-tonal-primary mt-1 self-start" onclick={() => add()} data-add-zone-type>
					<Icons.Plus size={14} aria-hidden="true" /> Add a zone type
				</button>
			{/if}
		</li>
	</ul>

	<RulesetSheetPreview {form} {member} {slotChoices} />
</section>
