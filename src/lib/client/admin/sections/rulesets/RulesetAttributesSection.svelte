<script lang="ts">
	import FieldHelp from "$lib/client/components/FieldHelp.svelte"
	/**
	 * 🚧 **Attributes** (PLAN-rulesets-functions D2, D8; lane A4, 2026-10-23):
	 * what characters, the world and places carry, one row each — its name,
	 * its kind (_A number, 0 to 10_), who carries it, who sees it, and the
	 * sentence the model reads; under it its tags, how a widget shows it and
	 * who may change it, and **More…** for its id, its bounds or words and
	 * where it starts. An attribute that IS an existing attribute slot (a
	 * copy's ⏳ stats) keeps the slot's shape and says so.
	 *
	 * Every edit waits for the page's Save.
	 */
	import * as Icons from "@lucide/svelte"
	import RulesetInlinePick from "./RulesetInlinePick.svelte"
	import RulesetRowFindings from "./RulesetRowFindings.svelte"
	import { idFromName, newAttribute, removeAttribute, type AttributeRow, type FindingsByRow, type FunctionRow, type SectionsForm } from "./rulesetSectionsForm"
	import {
		ATTRIBUTE_KIND_OPTIONS,
		attributeName,
		CHANGER_OPTIONS,
		carriedWords,
		changedByWords,
		kindWords,
		OWNER_OPTIONS,
		SHOWN_AS_OPTIONS,
		shownAsWords,
		visibilityWords,
		VISIBILITY_WORDS
	} from "./rulesetWords"

	type SlotChoice = Sockets.Rulesets.DetailRow["slotChoices"][number]

	interface Props {
		form: SectionsForm
		slotChoices: readonly SlotChoice[]
		/** The scope functions a visibility may name (catalogue's and the ruleset's own). */
		scopes: readonly { value: string; label: string }[]
		/** 🚧 The saved draft's findings, by row (RF fix 2): said on the row, after a Save. */
		findings?: FindingsByRow
		readonly?: boolean
		/** Functions that bind an attribute: _A function refills it each morning →_. */
		onOpenFunctions?: () => void
	}
	let { form = $bindable(), slotChoices, scopes, findings, readonly = false, onOpenFunctions }: Props = $props()

	let more = $state<Record<string, boolean>>({})
	const visibilityChoices = $derived([...VISIBILITY_WORDS.map((v) => ({ ...v })), ...scopes])
	const slotOf = (a: AttributeRow) => (a.slot ? (slotChoices.find((s) => s.id === a.slot) ?? null) : null)
	/** The functions that bind this attribute, by key. */
	const bindingFunctions = (a: AttributeRow): FunctionRow[] =>
		form.functions.filter((f) => Object.values(f.bindings).some((b) => (Array.isArray(b) ? b.includes(a.id) : b === a.id)))

	function add() {
		const row = newAttribute(form)
		form.attributes = [...form.attributes, row]
		more[row.uid] = true
		queueMicrotask(() => document.getElementById(`attr-name-${row.uid}`)?.focus())
	}
	/** 🚧 RF fix 2, item 6: the functions and zone limits that named it show the hole. */
	function remove(uid: string) {
		removeAttribute(form, uid)
	}
	function move(i: number, by: -1 | 1) {
		const next = [...form.attributes]
		const [row] = next.splice(i, 1)
		next.splice(i + by, 0, row!)
		form.attributes = next
	}
	/** A new attribute takes an id from its name until one is typed. */
	function named(a: AttributeRow, value: string) {
		a.id = idFromName(a, form.attributes, value, "attribute")
		a.name = value
	}
</script>

<section class="flex min-w-0 flex-col gap-3" aria-labelledby="attributes-heading" data-section="attributes">
	<div class="flex flex-wrap items-start justify-between gap-2">
		<div class="flex min-w-0 flex-col gap-0.5">
			<h2 id="attributes-heading" class="text-base font-medium">Attributes</h2>
			<FieldHelp>What characters, the world and places carry. Say what each one means; the model reads your sentence.</FieldHelp>
		</div>
		{#if !readonly}
			<button type="button" class="btn btn-sm preset-tonal-primary" onclick={add} data-add-attribute>
				<Icons.Plus size={14} aria-hidden="true" /> Add an attribute
			</button>
		{/if}
	</div>

	{#if !form.attributes.length}
		<div class="panel-card text-surface-600-400 flex flex-col gap-1 text-sm" data-attributes-empty>
			<p>Nothing here yet: a session on these rules reads like one with no rules at all.</p>
			<p>Add one thing worth tracking — affection, nerve, money — with a sentence saying what it means. That alone is something to play.</p>
		</div>
	{/if}

	<ul class="@container/attrs flex flex-col gap-2.5">
		{#each form.attributes as a, i (a.uid)}
			{@const slot = slotOf(a)}
			{@const using = bindingFunctions(a)}
			<li class="panel-card flex flex-col gap-2" data-attribute={a.id || a.uid}>
				<div class="grid gap-2 @min-[28rem]/attrs:grid-cols-2 @min-[46rem]/attrs:grid-cols-4">
					<div class="flex min-w-0 flex-col gap-1">
						<label for="attr-name-{a.uid}" class="text-surface-600-400 text-xs">Name</label>
						{#if readonly}
							<span class="min-h-10 py-2 text-sm">{attributeName(a, slotChoices)}</span>
						{:else}
							<input
								id="attr-name-{a.uid}"
								class="input"
								type="text"
								value={a.name}
								placeholder={slot?.label ?? "Affection"}
								oninput={(e) => named(a, e.currentTarget.value)}
							/>
						{/if}
					</div>
					<div class="flex min-w-0 flex-col gap-1">
						<span class="text-surface-600-400 text-xs" id="attr-kind-{a.uid}-label">Kind</span>
						{#if a.slot && !a.kind}
							<span class="border-surface-200-800 bg-surface-100-900 flex min-h-10 items-center rounded-base border px-3 text-sm">{kindWords(a, slot)}</span>
						{:else}
							<RulesetInlinePick
								id="attr-kind-{a.uid}"
								look="field"
								label="Kind of {attributeName(a, slotChoices)}"
								choices={ATTRIBUTE_KIND_OPTIONS}
								value={a.kind}
								text={kindWords(a, slot)}
								{readonly}
								onchange={(v) => (a.kind = String(v))}
							/>
						{/if}
					</div>
					<div class="flex min-w-0 flex-col gap-1">
						<span class="text-surface-600-400 text-xs">Carried by</span>
						<RulesetInlinePick
							id="attr-carried-{a.uid}"
							look="field"
							many
							label="Who carries {attributeName(a, slotChoices)}"
							choices={OWNER_OPTIONS}
							value={a.carriedBy}
							text={carriedWords(a.carriedBy)}
							{readonly}
							onchange={(v) => (a.carriedBy = v as string[])}
						/>
					</div>
					<div class="flex min-w-0 flex-col gap-1">
						<span class="text-surface-600-400 text-xs">Who sees it</span>
						<RulesetInlinePick
							id="attr-sees-{a.uid}"
							look="field"
							label="Who sees {attributeName(a, slotChoices)}"
							choices={visibilityChoices}
							value={a.visibility}
							text={visibilityWords(a.visibility, scopes)}
							{readonly}
							onchange={(v) => (a.visibility = String(v))}
						/>
					</div>
				</div>
				<div class="flex min-w-0 flex-col gap-1">
					<label for="attr-prose-{a.uid}" class="text-surface-600-400 text-xs">
						What it means{i === 0 ? " (the model reads this)" : ""}
					</label>
					{#if readonly}
						<p class="text-sm">{a.prose || (slot ? "Read from its attribute slot." : "No sentence yet.")}</p>
					{:else}
						<textarea
							id="attr-prose-{a.uid}"
							class="textarea"
							rows={2}
							bind:value={a.prose}
							placeholder={a.slot ? "Left empty, its attribute slot's description is read." : "How much someone likes you. Above 7 they'll say so unprompted; below 3 they avoid you."}
							aria-invalid={!a.slot && !a.prose.trim()}
						></textarea>
					{/if}
				</div>
				<div class="text-surface-600-400 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" data-attribute-facts>
					{#if a.tags.trim()}<span data-attribute-tags>Tags: <strong class="text-surface-950-50">{a.tags}</strong></span>{/if}
					{#if a.required}<span data-attribute-required>Every holder carries it</span>{/if}
					<span>Shown as: {a.shownAs ? shownAsWords(a.shownAs) : "as the widget likes"}</span>
					<span>Changed by: {changedByWords(a.changedBy)}</span>
					{#if using.length}
						<button type="button" class="text-primary-ink min-h-8 underline-offset-2 hover:underline" onclick={() => onOpenFunctions?.()}>
							{using.length === 1 ? `A function uses it: ${using[0]!.key}` : `${using.length} functions use it`} →
						</button>
					{/if}
					<button
						type="button"
						class="text-primary-ink ml-auto min-h-8 underline-offset-2 hover:underline"
						aria-expanded={!!more[a.uid]}
						aria-controls="attr-more-{a.uid}"
						onclick={() => (more[a.uid] = !more[a.uid])}
						data-attribute-more
					>
						{more[a.uid] ? "Less" : "More…"}
					</button>
				</div>
				{#if more[a.uid]}
					<div id="attr-more-{a.uid}" class="border-surface-200-800 grid gap-2 border-t pt-2 @min-[40rem]/attrs:grid-cols-3">
						<div class="flex flex-col gap-1">
							<label for="attr-id-{a.uid}" class="text-surface-600-400 text-xs">Id (what functions bind it by)</label>
							{#if readonly}<span class="font-mono text-sm">{a.id}</span>{:else}<input id="attr-id-{a.uid}" class="input font-mono" type="text" bind:value={a.id} spellcheck="false" />{/if}
						</div>
						{#if a.kind === "text"}
							<FieldHelp class="@min-[40rem]/attrs:col-span-2">
								Free text: each holder's own few sentences — a vow, a backstory, what they are after. Shown as words; the model reads it as a sentence of its own.
							</FieldHelp>
						{:else if a.kind === "label" || a.kind === "list"}
							<div class="flex flex-col gap-1 @min-[40rem]/attrs:col-span-2">
								<label for="attr-of-{a.uid}" class="text-surface-600-400 text-xs">Its words, with commas</label>
								{#if readonly}<span class="text-sm">{a.of}</span>{:else}<input id="attr-of-{a.uid}" class="input" type="text" bind:value={a.of} placeholder="shy, warm, guarded, giddy" />{/if}
							</div>
						{:else if a.kind}
							<div class="flex flex-col gap-1">
								<span class="text-surface-600-400 text-xs">From and to</span>
								<span class="flex items-center gap-1">
									{#if readonly}<span class="text-sm">{a.min || "—"} to {a.max || "—"}</span>{:else}
										<input class="input w-20" type="text" inputmode="numeric" aria-label="Lowest {attributeName(a, slotChoices)}" bind:value={a.min} />
										<span class="text-surface-600-400 text-xs">to</span>
										<input class="input w-20" type="text" inputmode="numeric" aria-label="Highest {attributeName(a, slotChoices)}" bind:value={a.max} />
									{/if}
								</span>
							</div>
						{/if}
						<div class="flex flex-col gap-1 {a.kind === 'text' ? '@min-[40rem]/attrs:col-span-3' : ''}">
							<label for="attr-start-{a.uid}" class="text-surface-600-400 text-xs">{a.kind === "text" ? "Starts as" : "Starts at"}</label>
							{#if readonly}<span class="text-sm">{a.start || "—"}</span>{:else if a.kind === "text"}<textarea id="attr-start-{a.uid}" class="textarea" rows={2} bind:value={a.start} placeholder="Left empty, each holder starts with nothing written."></textarea>{:else}<input id="attr-start-{a.uid}" class="input" type="text" bind:value={a.start} placeholder={a.kind === "pool" ? "Full" : ""} />{/if}
						</div>
						<div class="flex flex-col gap-1 @min-[40rem]/attrs:col-span-2">
							<label for="attr-tags-{a.uid}" class="text-surface-600-400 text-xs">Tags</label>
							{#if readonly}<span class="text-sm">{a.tags || "—"}</span>{:else}<input id="attr-tags-{a.uid}" class="input" type="text" bind:value={a.tags} placeholder="resource" aria-describedby="attr-tags-{a.uid}-help" />{/if}
							<FieldHelp id="attr-tags-{a.uid}-help">
								Words functions look for — resource, relationship, condition. A function bound by tag picks up every attribute that carries it.
							</FieldHelp>
						</div>
						<div class="flex flex-col gap-1">
							<span class="text-surface-600-400 text-xs" id="attr-required-{a.uid}-label">Every holder carries it</span>
							{#if readonly}<span class="text-sm">{a.required ? "Yes" : "No: a holder may turn it off"}</span>{:else}
								<label class="flex min-h-10 items-center gap-2 text-sm">
									<input type="checkbox" class="checkbox" bind:checked={a.required} aria-describedby="attr-required-{a.uid}-help" data-attribute-required-toggle />
									Required
								</label>
							{/if}
							<FieldHelp id="attr-required-{a.uid}-help">Off, a holder (or the game master, for anyone) may turn it off for themselves: then it is not shown, read or changed for them.</FieldHelp>
						</div>
						<div class="flex flex-col gap-1">
							<span class="text-surface-600-400 text-xs">Shown as</span>
							<RulesetInlinePick
								id="attr-shown-{a.uid}"
								look="field"
								label="How a widget shows {attributeName(a, slotChoices)}"
								choices={SHOWN_AS_OPTIONS}
								value={a.shownAs}
								{readonly}
								onchange={(v) => (a.shownAs = String(v))}
							/>
						</div>
						<div class="flex flex-col gap-1">
							<span class="text-surface-600-400 text-xs">Changed by</span>
							<RulesetInlinePick
								id="attr-changed-{a.uid}"
								look="field"
								many
								label="Who may change {attributeName(a, slotChoices)}"
								choices={CHANGER_OPTIONS}
								value={a.changedBy}
								text={changedByWords(a.changedBy).replace(/^./, (c) => c.toUpperCase())}
								{readonly}
								onchange={(v) => (a.changedBy = v as string[])}
							/>
						</div>
						{#if a.slot}
							<FieldHelp class="@min-[40rem]/attrs:col-span-3">
								Kept under the attribute slot {slot?.label ?? ""} (<span class="font-mono">{a.slot}</span>){a.borrowed ? ", borrowed: these rules read it, another owns it" : ""}.
							</FieldHelp>
						{/if}
						{#if !readonly}
							<div class="flex flex-wrap gap-2 @min-[40rem]/attrs:col-span-3">
								<button type="button" class="btn btn-sm preset-tonal-surface" disabled={i === 0} onclick={() => move(i, -1)}>
									<Icons.ArrowUp size={14} aria-hidden="true" /> Up
								</button>
								<button type="button" class="btn btn-sm preset-tonal-surface" disabled={i === form.attributes.length - 1} onclick={() => move(i, 1)}>
									<Icons.ArrowDown size={14} aria-hidden="true" /> Down
								</button>
								<button type="button" class="btn btn-sm preset-tonal-error ml-auto" onclick={() => remove(a.uid)} data-remove-attribute>
									<Icons.Trash2 size={14} aria-hidden="true" /> Remove {attributeName(a, slotChoices)}
								</button>
							</div>
						{/if}
					</div>
				{/if}
				<RulesetRowFindings findings={findings?.rows[a.uid] ?? []} label={attributeName(a, slotChoices)} />
			</li>
		{/each}
	</ul>
</section>
