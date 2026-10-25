<script lang="ts">
	import FieldHelp from "$lib/client/components/FieldHelp.svelte"
	/**
	 * 🚧 **Outcomes and time** (PLAN-rulesets-functions D2, D8; lane A4,
	 * 2026-10-23): one view for two sections. **Outcomes**: how things can
	 * turn out, in the author's own words (_awkward_, _warmed_), each
	 * optionally read as a step of the five-band ladder and from the margin it
	 * starts at. **Time**: the unit time is kept in, a round's seconds, how
	 * many actions a turn holds, and rests. Left empty, the host's defaults
	 * hold (R9) — nothing here is required.
	 */
	import * as Icons from "@lucide/svelte"
	import { FIVE_BANDS, RULESET_TIME_UNITS } from "@serene-pub/sdk"
	import RulesetInlinePick from "./RulesetInlinePick.svelte"
	import RulesetRowFindings from "./RulesetRowFindings.svelte"
	import { newOutcome, newRest, type FindingsByRow, type SectionsForm } from "./rulesetSectionsForm"

	interface Props {
		form: SectionsForm
		/** 🚧 The saved draft's findings, by row and section (RF fix 2): said where they are, after a Save. */
		findings?: FindingsByRow
		readonly?: boolean
	}
	let { form = $bindable(), findings, readonly = false }: Props = $props()

	const FIVE_WORDS: Record<string, string> = {
		"": "No step of its own",
		"crit-fail": "A bad miss",
		fail: "Falls short",
		partial: "A partial result",
		success: "Works",
		crit: "Better than hoped"
	}
	const fiveChoices = ["", ...FIVE_BANDS].map((v) => ({ value: v, label: FIVE_WORDS[v] ?? v }))
	const UNIT_WORDS: Record<string, string> = { "": "The host's", round: "Rounds", minute: "Minutes", hour: "Hours", day: "Days", scene: "Scenes" }
	const unitChoices = ["", ...RULESET_TIME_UNITS].map((v) => ({ value: v, label: UNIT_WORDS[v] ?? v }))

	function addOutcome() {
		form.outcomes = [...form.outcomes, newOutcome(form)]
		const uid = form.outcomes.at(-1)!.uid
		queueMicrotask(() => document.getElementById(`outcome-${uid}`)?.focus())
	}
</script>

<section class="@container/ot flex min-w-0 flex-col gap-3" aria-labelledby="outcomes-heading" data-section="outcomes">
	<div class="flex min-w-0 flex-col gap-0.5">
		<h2 id="outcomes-heading" class="text-base font-medium">Outcomes and time</h2>
		<FieldHelp>How things can turn out, in your own words, and how time is kept. Left empty, the host's defaults hold.</FieldHelp>
	</div>

	<div class="panel-card flex flex-col gap-2" data-outcomes>
		<h3 class="text-sm font-medium">Outcomes, in your words</h3>
		<FieldHelp>Fewest first. Each may read as a step from a bad miss to better than hoped, so results from different rules compare.</FieldHelp>
		{#each form.outcomes as o, i (o.uid)}
			<div class="flex flex-wrap items-center gap-2" data-outcome={o.id || o.uid}>
				{#if readonly}
					<span class="min-w-32 font-medium">{o.label || o.id}</span>
					<span class="text-surface-600-400 text-sm">{FIVE_WORDS[o.five] ?? o.five}{o.from ? ` · from ${o.from}` : ""}</span>
				{:else}
					<input id="outcome-{o.uid}" class="input w-44" type="text" bind:value={o.label} placeholder="warmed" aria-label="Outcome {i + 1}" />
					<RulesetInlinePick label="What {o.label || 'it'} reads as" choices={fiveChoices} value={o.five} onchange={(v) => (o.five = String(v))} />
					<label class="text-surface-600-400 inline-flex items-center gap-1 text-xs">
						from a margin of
						<input class="input min-h-8 w-16 px-2 py-0" type="text" inputmode="numeric" bind:value={o.from} />
					</label>
					<button type="button" class="btn-icon btn-icon-sm preset-tonal-surface ml-auto" aria-label="Remove {o.label || 'this outcome'}" onclick={() => (form.outcomes = form.outcomes.filter((x) => x.uid !== o.uid))}>
						<Icons.X size={14} aria-hidden="true" />
					</button>
				{/if}
			</div>
			<RulesetRowFindings findings={findings?.rows[o.uid] ?? []} label={o.label || o.id || "This outcome"} />
		{:else}
			<p class="text-surface-600-400 text-sm">None: a result reads as the host's — failure or success.</p>
		{/each}
		{#if !readonly}
			<button type="button" class="btn btn-sm preset-tonal-primary self-start" onclick={addOutcome} data-add-outcome>
				<Icons.Plus size={14} aria-hidden="true" /> Add an outcome
			</button>
		{/if}
	</div>

	<div class="panel-card flex flex-col gap-2" data-time>
		<h3 class="text-sm font-medium">Time</h3>
		<RulesetRowFindings findings={findings?.sections.outcomes ?? []} label="Outcomes and time" />
		<div class="grid gap-3 @min-[36rem]/ot:grid-cols-3">
			<div class="flex flex-col gap-1 text-xs">
				<span class="text-surface-600-400">Kept in</span>
				<RulesetInlinePick look="field" label="What time is kept in" choices={unitChoices} value={form.time.unit} {readonly} onchange={(v) => (form.time.unit = String(v))} />
			</div>
			{#if form.time.unit === "round"}
				<label class="flex flex-col gap-1 text-xs">
					<span class="text-surface-600-400">A round lasts (seconds)</span>
					<input class="input" type="text" inputmode="numeric" bind:value={form.time.roundSeconds} readonly={readonly} />
				</label>
			{/if}
			<label class="flex flex-col gap-1 text-xs">
				<span class="text-surface-600-400">Actions in a turn</span>
				<input class="input" type="text" inputmode="numeric" bind:value={form.time.perTurn} placeholder="As the story needs" readonly={readonly} />
			</label>
			{#if readonly}
				<p class="flex min-h-10 items-center self-end text-sm">{form.time.reaction ? "And a reaction besides" : "No reaction besides"}</p>
			{:else}
				<label class="flex min-h-10 items-center gap-2 self-end text-sm">
					<input type="checkbox" class="checkbox" bind:checked={form.time.reaction} /> And a reaction besides
				</label>
			{/if}
		</div>
		<h4 class="text-surface-600-400 mt-1 text-xs font-medium">Rests</h4>
		{#each form.time.rests as r (r.uid)}
			<div class="flex flex-wrap items-center gap-2" data-rest={r.id || r.uid}>
				<input class="input w-40" type="text" bind:value={r.label} placeholder="Long rest" aria-label="Rest" readonly={readonly} />
				<label class="text-surface-600-400 inline-flex items-center gap-1 text-xs">
					minutes <input class="input min-h-8 w-20 px-2 py-0" type="text" inputmode="numeric" bind:value={r.minutes} readonly={readonly} />
				</label>
				<label class="text-surface-600-400 inline-flex flex-1 items-center gap-1 text-xs">
					recharges <input class="input min-h-8 min-w-32 flex-1 px-2 py-0" type="text" bind:value={r.recharges} placeholder="short, long" readonly={readonly} />
				</label>
				{#if !readonly}
					<button type="button" class="btn-icon btn-icon-sm preset-tonal-surface" aria-label="Remove {r.label || 'this rest'}" onclick={() => (form.time.rests = form.time.rests.filter((x) => x.uid !== r.uid))}>
						<Icons.X size={14} aria-hidden="true" />
					</button>
				{/if}
			</div>
		{:else}
			<p class="text-surface-600-400 text-sm">None: resting is the story's to tell.</p>
		{/each}
		{#if !readonly}
			<button type="button" class="btn btn-sm preset-tonal-surface self-start" onclick={() => (form.time.rests = [...form.time.rests, newRest()])}>
				<Icons.Plus size={14} aria-hidden="true" /> Add a rest
			</button>
		{/if}
	</div>
</section>
