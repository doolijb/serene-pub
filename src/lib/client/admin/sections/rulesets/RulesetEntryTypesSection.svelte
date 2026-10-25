<script lang="ts">
	import FieldHelp from "$lib/client/components/FieldHelp.svelte"
	/**
	 * 🚧 **Entry types** (PLAN-rulesets-functions D2, D5, D8; lane A4,
	 * 2026-10-23): kinds of thing people hold, suffer or share — a bond, a
	 * keepsake, a card. Each IS a lorebook entry type; its rows are the
	 * library. A card per type: its name, between two people or held, its
	 * tags, the sentence the model reads, then its shape (the fields every one
	 * has), who sees it, its library rows and the functions that bind it.
	 * **Edit…** opens the rest. An entry type a copy brought in the shape
	 * before the sections keeps that shape whole (edited in the Document).
	 */
	import * as Icons from "@lucide/svelte"
	import { tieSidesOf, type FarEnd } from "@serene-pub/sdk"
	import RulesetInlinePick from "./RulesetInlinePick.svelte"
	import RulesetRowFindings from "./RulesetRowFindings.svelte"
	import {
		idFromName,
		libraryRowsOf,
		newEntryField,
		newEntryType,
		removeEntryType,
		splitWords,
		zonesHolding,
		type EntryTypeRow,
		type FindingsByRow,
		type SectionsForm
	} from "./rulesetSectionsForm"
	import { ENTRY_FIELD_TYPE_OPTIONS, OWNER_OPTIONS, SHOWN_AS_OPTIONS, visibilityWords, VISIBILITY_WORDS } from "./rulesetWords"

	interface Props {
		form: SectionsForm
		scopes: readonly { value: string; label: string }[]
		/** 🚧 The saved draft's findings, by row (RF fix 2): said on the card, after a Save. */
		findings?: FindingsByRow
		readonly?: boolean
		onOpenFunctions?: () => void
		onOpenLibrary?: () => void
	}
	let { form = $bindable(), scopes, findings, readonly = false, onOpenFunctions, onOpenLibrary }: Props = $props()

	/**
	 * 🚧 Removing an entry type (RF fix 2, item 6): its zone types stop
	 * holding it, the functions tied to it show the hole, and — asked first
	 * when it has any — its library rows go with it.
	 */
	let confirming = $state<string | null>(null)
	function askRemove(e: EntryTypeRow) {
		if (libraryRowsOf(form, e) > 0) confirming = e.uid
		else removeEntryType(form, e.uid, { rows: false })
	}
	function remove(e: EntryTypeRow, rows: boolean) {
		confirming = null
		removeEntryType(form, e.uid, { rows })
	}
	/** Where its entries sit: the zone types holding it, else the host's carried list. */
	const livesIn = (e: EntryTypeRow): string => {
		const zones = zonesHolding(form, e)
		return zones.length ? zones.map((z) => z.name || z.id).join(", ") : "What someone carries (always there)"
	}

	let editing = $state<Record<string, boolean>>({})
	const FIELD_TYPES = ENTRY_FIELD_TYPE_OPTIONS
	const visibilityChoices = $derived([...VISIBILITY_WORDS.map((v) => ({ ...v })), ...scopes])
	const rowsOf = (e: EntryTypeRow) => form.library.lists.find((l) => l.repertoireId === e.id)?.rows.length ?? 0
	const functionsOn = (e: EntryTypeRow) =>
		form.functions.filter((f) => Object.values(f.bindings).some((b) => (Array.isArray(b) ? b.includes(e.id) : b === e.id))).map((f) => f.key)
	/** The fields every one has, in a line: _name · description · **tie** (friend, rival)_. */
	function shapeParts(e: EntryTypeRow): { key: string; words: string; own: boolean }[] {
		const piece = (e.original as { piece?: { fields?: Record<string, { of?: unknown; members?: { key: string }[] }> } } | null)?.piece
		const base = [
			{ key: "name", words: "", own: false },
			{ key: "description", words: "", own: false }
		]
		if (piece?.fields)
			return Object.entries(piece.fields)
				.filter(([k]) => !["prose", "equipped", "duration"].includes(k))
				.map(([k, f]) => ({ key: k, words: (f.members?.map((m) => m.key) ?? (Array.isArray(f.of) ? (f.of as string[]) : [])).join(", "), own: !["name", "description", "traits", "towards", "edge"].includes(k) }))
		return [
			...base,
			...(e.traits ? [{ key: "traits", words: "this ruleset's", own: false }] : []),
			...(e.relational ? [{ key: "towards", words: "a person", own: false }] : []),
			...e.fields.filter((f) => f.key.trim()).map((f) => ({ key: f.key.trim(), words: f.type === "enum" ? splitWords(f.of).join(", ") : "", own: true }))
		]
	}
	const kept = (e: EntryTypeRow) => !!(e.original as { piece?: unknown } | null)?.piece

	/* ── 🚧 Ties on the graph (T1, T2, T5; lane T2, 2026-10-23) ─────────── */

	/** What the other end of a relational entry type may be (T1). */
	const FAR_END_CHOICES = [
		{ value: "person", label: "A person" },
		{ value: "place", label: "A place" },
		{ value: "entry", label: "Any entry" }
	] as const
	const sidesOf = (e: EntryTypeRow) => tieSidesOf({ relational: e.relational ? true : undefined, farEnd: (e.farEnd || undefined) as FarEnd | undefined, holders: (e.holders.length ? e.holders : undefined) as never })
	/** The sides, worked out from the ends — never said. */
	function sidesWords(e: EntryTypeRow): string {
		const n = sidesOf(e)
		return n === 2 ? "Two · each person holds their own side" : n === 1 ? "One · held by the world" : "Say what the other end may be, and the sides follow."
	}
	const badge = (e: EntryTypeRow): string =>
		!e.relational ? "held" : e.farEnd === "place" ? "to a place" : e.farEnd === "entry" ? "to an entry" : sidesOf(e) === 1 ? "between two people, held by the world" : "between two people"
	/** The fields of its own, named. */
	const ownFields = (e: EntryTypeRow) => e.fields.filter((f) => f.key.trim())
	const wordsFields = (e: EntryTypeRow) => ownFields(e).filter((f) => f.type !== "integer" && f.type !== "boolean")
	const fieldChoices = (e: EntryTypeRow) => [{ value: "", label: "Nothing" }, ...wordsFields(e).map((f) => ({ value: f.key.trim(), label: f.label || f.key.trim() }))]
	/** The field that reads onto a column, or "". */
	const ontoOf = (e: EntryTypeRow, target: string) => Object.entries(e.readsOnto).find(([, t]) => t === target)?.[0] ?? ""
	function setOnto(e: EntryTypeRow, target: string, field: string) {
		const next = Object.fromEntries(Object.entries(e.readsOnto).filter(([, t]) => t !== target))
		if (field) next[field] = target
		e.readsOnto = next
	}
	const copiedOnto = (e: EntryTypeRow) => Object.entries(e.readsOnto).filter(([, t]) => t === "entry-field").map(([k]) => k)
	function setCopied(e: EntryTypeRow, fields: string[]) {
		e.readsOnto = { ...Object.fromEntries(Object.entries(e.readsOnto).filter(([, t]) => t !== "entry-field")), ...Object.fromEntries(fields.map((f) => [f, "entry-field"])) }
	}
	const shareOf = (e: EntryTypeRow, key: string) => e.modelShare[key] ?? { words: true, number: false }
	function setShare(e: EntryTypeRow, key: string, part: "words" | "number", on: boolean) {
		e.modelShare = { ...e.modelShare, [key]: { ...shareOf(e, key), [part]: on } }
	}
	const label = (f: { key: string; label: string }) => f.label || f.key.trim()

	function add() {
		const row = newEntryType(form)
		form.entryTypes = [...form.entryTypes, row]
		editing[row.uid] = true
		queueMicrotask(() => document.getElementById(`et-name-${row.uid}`)?.focus())
	}
	/** A new entry type takes its id from its name (as New ruleset does), until one is typed. */
	function named(e: EntryTypeRow, v: string) {
		e.id = idFromName(e, form.entryTypes, v, "entry")
		e.name = v
	}
</script>

<section class="@container/types flex min-w-0 flex-col gap-3" aria-labelledby="entry-types-heading" data-section="entryTypes">
	<div class="flex flex-wrap items-start justify-between gap-2">
		<div class="flex min-w-0 flex-col gap-0.5">
			<h2 id="entry-types-heading" class="text-base font-medium">Entry types</h2>
			<FieldHelp>Kinds of thing people hold, suffer or share. Each kind is a lorebook entry type; its rows are the library.</FieldHelp>
		</div>
	</div>

	{#if !form.entryTypes.length}
		<p class="panel-card text-surface-600-400 text-sm" data-entry-types-empty>
			None yet. Every session still has a carried list for what people have on them; an entry type gives a kind of thing its own shape and sentence — a bond, a keepsake, a card.
		</p>
	{/if}

	<ul class="grid gap-3 @min-[44rem]/types:grid-cols-2">
		{#each form.entryTypes as e (e.uid)}
			{@const shape = shapeParts(e)}
			{@const fns = functionsOn(e)}
			<li class="panel-card flex flex-col gap-2" data-entry-type={e.id || e.uid}>
				<div class="flex flex-wrap items-baseline gap-2">
					{#if readonly || !editing[e.uid]}
						<h3 class="text-base font-medium">{e.name || e.id || "New entry type"}</h3>
					{:else}
						<label class="sr-only" for="et-name-{e.uid}">Name</label>
						<input id="et-name-{e.uid}" class="input max-w-60" type="text" value={e.name} placeholder="Keepsake" oninput={(ev) => named(e, ev.currentTarget.value)} />
					{/if}
					<span class="border-surface-200-800 text-surface-600-400 rounded-full border px-2 py-0.5 text-xs" data-entry-kind>{badge(e)}</span>
					{#if e.tags.trim()}<span class="text-surface-600-400 ml-auto text-xs" data-entry-tags>Tags: {e.tags}</span>{/if}
				</div>
				{#if readonly}
					<p class="text-sm">{e.prose || "No sentence yet."}</p>
				{:else}
					<label class="sr-only" for="et-prose-{e.uid}">What the model reads about {e.name || "it"}</label>
					<textarea
						id="et-prose-{e.uid}"
						class="textarea"
						rows={2}
						bind:value={e.prose}
						placeholder="Something given or found that means something. Giving one away warms a bond."
						aria-invalid={!e.prose.trim()}
					></textarea>
				{/if}
				<dl class="grid gap-x-3 gap-y-2 text-sm @min-[28rem]/types:grid-cols-2">
					<div>
						<dt class="text-surface-600-400 text-xs">Shape</dt>
						<dd data-entry-shape>
							{#each shape as p, i (`${p.key}#${i}`)}{i ? " · " : ""}{#if p.own}<strong>{p.key}</strong>{:else}{p.key}{/if}{p.words ? ` (${p.words})` : ""}{/each}
						</dd>
					</div>
					<div>
						<dt class="text-surface-600-400 text-xs">Who sees it</dt>
						<dd>
							<RulesetInlinePick
								label="Who sees {e.name || 'it'}"
								choices={visibilityChoices}
								value={e.visibility}
								text={visibilityWords(e.visibility, scopes)}
								{readonly}
								onchange={(v) => (e.visibility = String(v))}
							/>
						</dd>
					</div>
					<div>
						<dt class="text-surface-600-400 text-xs">Library</dt>
						<dd>
							<button type="button" class="underline-offset-2 hover:underline" onclick={() => onOpenLibrary?.()}>
								{rowsOf(e)} row{rowsOf(e) === 1 ? "" : "s"}{(e.original as { entryable?: unknown } | null)?.entryable === false ? "" : " · in the lorebook"}
							</button>
						</dd>
					</div>
					<div>
						<dt class="text-surface-600-400 text-xs">Lives in</dt>
						<dd data-entry-lives-in>{livesIn(e)}</dd>
					</div>
					<div>
						<dt class="text-surface-600-400 text-xs">Functions on it</dt>
						<dd>
							{#if fns.length}
								<button type="button" class="text-primary-ink underline-offset-2 hover:underline" onclick={() => onOpenFunctions?.()}>{fns.join(" · ")}</button>
							{:else}None{/if}
						</dd>
					</div>
				</dl>
				{#if e.relational}
					<!-- 🚧 T1: what the other end may be; the sides are worked out from the ends. -->
					<div class="bg-surface-50-950 border-surface-200-800 grid gap-x-3 gap-y-2 rounded-md border p-2 text-sm @min-[28rem]/types:grid-cols-2" data-tie-ends>
						<div class="flex flex-col gap-1">
							<span class="text-surface-600-400 text-xs" id="far-end-{e.uid}">The other end may be</span>
							<div class="flex flex-wrap gap-1.5" role="group" aria-labelledby="far-end-{e.uid}">
								{#each FAR_END_CHOICES as c (c.value)}
									<button
										type="button"
										class="chip min-h-8 {e.farEnd === c.value ? 'preset-pressed' : 'preset-tonal-surface'}"
										aria-pressed={e.farEnd === c.value}
										disabled={readonly}
										onclick={() => (e.farEnd = e.farEnd === c.value ? "" : c.value)}
										data-far-end={c.value}
									>
										{c.label}
									</button>
								{/each}
							</div>
							<FieldHelp>A road is place to place; a standing in a town is person to place.</FieldHelp>
						</div>
						<div class="flex flex-col gap-1">
							<span class="text-surface-600-400 text-xs">Sides</span>
							<p data-tie-sides>{sidesWords(e)}</p>
							<FieldHelp>Worked out from the ends: person to person has two sides, each held by its person; anything else has one, held by the world.</FieldHelp>
						</div>
					</div>
				{/if}
				{#if ownFields(e).length && !kept(e)}
					<!-- 🚧 T2, T5: what reads onto the lorebook, and what the model is told of each field. -->
					<div class="border-surface-200-800 flex flex-col gap-2 border-t pt-2" data-reads-onto>
						<h4 class="text-sm font-medium">{e.relational ? "On the lorebook graph" : "On the lorebook"}</h4>
						{#if e.relational && !e.farEnd}
							<FieldHelp>Say what its other end may be, and its fields can read onto the relationship it rides on.</FieldHelp>
						{:else if e.relational}
							<div class="grid gap-x-3 gap-y-2 text-sm @min-[28rem]/types:grid-cols-2">
								<div class="flex flex-col gap-1 text-xs">
									<span class="text-surface-600-400">Each side's relationship type reads from</span>
									<RulesetInlinePick
										look="field"
										label="What each side's relationship type reads from"
										choices={fieldChoices(e)}
										value={ontoOf(e, "relationship-type")}
										{readonly}
										onchange={(v) => setOnto(e, "relationship-type", String(v))}
										id="onto-type-{e.uid}"
									/>
								</div>
								<div class="flex flex-col gap-1 text-xs">
									<span class="text-surface-600-400">The relationship's name reads from</span>
									<RulesetInlinePick
										look="field"
										label="What the relationship's name reads from"
										choices={fieldChoices(e)}
										value={ontoOf(e, "relationship-name")}
										{readonly}
										onchange={(v) => setOnto(e, "relationship-name", String(v))}
										id="onto-name-{e.uid}"
									/>
								</div>
							</div>
							<FieldHelp>
								The held side owns the truth; the lorebook's row is written from it whichever was made first. Drawing a tie on the lorebook makes the sides; a function adding a side makes the row; taking the row off retires the sides.
							</FieldHelp>
						{:else}
							<div class="flex flex-col gap-1 text-xs">
								<span class="text-surface-600-400">Copied onto its own entry</span>
								<RulesetInlinePick
									look="field"
									many
									label="Which fields are copied onto the entry"
									choices={ownFields(e).map((f) => ({ value: f.key.trim(), label: label(f) }))}
									value={copiedOnto(e)}
									text={copiedOnto(e).length ? undefined : "None"}
									{readonly}
									onchange={(v) => setCopied(e, v as string[])}
									id="onto-entry-{e.uid}"
								/>
							</div>
						{/if}
						<table class="w-full text-sm" data-model-share>
							<caption class="text-surface-600-400 text-left text-xs">Shared with the model</caption>
							<thead>
								<tr class="text-surface-600-400 text-left text-xs">
									<th scope="col" class="font-normal">Field</th>
									<th scope="col" class="font-normal">Words</th>
									<th scope="col" class="font-normal">The number</th>
								</tr>
							</thead>
							<tbody>
								{#each ownFields(e) as f (f.uid)}
									{@const share = shareOf(e, f.key.trim())}
									<tr data-share-field={f.key.trim()}>
										<th scope="row" class="py-1 text-left font-normal">{label(f)}</th>
										<td class="py-1">
											<input
												type="checkbox"
												class="checkbox"
												checked={share.words}
												disabled={readonly}
												aria-label="Share {label(f)} as words"
												onchange={(ev) => setShare(e, f.key.trim(), "words", ev.currentTarget.checked)}
											/>
										</td>
										<td class="py-1">
											{#if f.type === "integer"}
												<input
													type="checkbox"
													class="checkbox"
													checked={share.number}
													disabled={readonly}
													aria-label="Share the {label(f)} number"
													onchange={(ev) => setShare(e, f.key.trim(), "number", ev.currentTarget.checked)}
												/>
											{:else}
												<span class="text-surface-600-400 text-xs">words only</span>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
						<FieldHelp>The model is told a field's words unless you untick them, and a number only when you tick it.</FieldHelp>
					</div>
				{/if}
				{#if !readonly}
					<button
						type="button"
						class="text-primary-ink min-h-8 self-start text-xs underline-offset-2 hover:underline"
						aria-expanded={!!editing[e.uid]}
						onclick={() => (editing[e.uid] = !editing[e.uid])}
						data-entry-type-edit
					>
						{editing[e.uid] ? "Done" : "Edit…"}
					</button>
				{/if}
				{#if editing[e.uid] && !readonly}
					<div class="border-surface-200-800 grid gap-2 border-t pt-2 @min-[28rem]/types:grid-cols-2">
						<label class="flex flex-col gap-1 text-xs">
							<span class="text-surface-600-400">Id</span>
							<input class="input font-mono" type="text" bind:value={e.id} spellcheck="false" />
						</label>
						<div class="flex flex-col gap-1 text-xs">
							<label class="text-surface-600-400" for="et-tags-{e.uid}">Tags</label>
							<input id="et-tags-{e.uid}" class="input" type="text" bind:value={e.tags} placeholder="relationship" aria-describedby="et-tags-{e.uid}-help" />
							<p id="et-tags-{e.uid}-help" class="text-surface-600-400">
								Words functions look for — relationship, condition, class. A function bound by tag picks up every type that carries it. Commas between them.
							</p>
						</div>
						<label class="flex flex-col gap-1 text-xs @min-[28rem]/types:col-span-2">
							<span class="text-surface-600-400">Description (what a person reads)</span>
							<input class="input" type="text" bind:value={e.description} />
						</label>
						<label class="flex min-h-10 items-center gap-2 text-sm">
							<input type="checkbox" class="checkbox" bind:checked={e.relational} /> Between two people
						</label>
						<label class="flex min-h-10 items-center gap-2 text-sm">
							<input type="checkbox" class="checkbox" bind:checked={e.traits} /> A free list of traits
						</label>
						<div class="flex flex-col gap-1 text-xs">
							<span class="text-surface-600-400">Held by</span>
							<RulesetInlinePick
								look="field"
								many
								label="Who holds {e.name || 'it'}"
								choices={OWNER_OPTIONS}
								value={e.holders}
								text={e.holders.length ? undefined : "Characters"}
								onchange={(v) => (e.holders = v as string[])}
							/>
						</div>
						<div class="flex flex-col gap-1 text-xs">
							<span class="text-surface-600-400">Shown as</span>
							<RulesetInlinePick look="field" label="How a widget shows {e.name || 'it'}" choices={SHOWN_AS_OPTIONS} value={e.shownAs} onchange={(v) => (e.shownAs = String(v))} />
						</div>
						{#if kept(e)}
							<FieldHelp class="@min-[28rem]/types:col-span-2">Its shape came with a copy and is kept whole; change its fields in the Document.</FieldHelp>
						{:else}
							<div class="flex flex-col gap-1.5 @min-[28rem]/types:col-span-2">
								<span class="text-surface-600-400 text-xs">Fields of its own</span>
								{#each e.fields as f, fi (f.uid)}
									<div class="flex flex-wrap items-center gap-1.5">
										<input class="input w-32 font-mono" type="text" bind:value={f.key} placeholder="footing" aria-label="Field name" spellcheck="false" />
										<RulesetInlinePick label="Kind of field {f.key || fi + 1}" choices={FIELD_TYPES} value={f.type} onchange={(v) => (f.type = String(v))} />
										{#if f.type === "enum"}
											<input class="input min-w-40 flex-1" type="text" bind:value={f.of} placeholder="steady, strained, broken" aria-label="Its words, with commas" />
										{/if}
										<button type="button" class="btn-icon btn-icon-sm preset-tonal-surface" aria-label="Remove the field {f.key}" onclick={() => (e.fields = e.fields.filter((x) => x.uid !== f.uid))}>
											<Icons.X size={14} aria-hidden="true" />
										</button>
									</div>
								{/each}
								<button type="button" class="btn btn-sm preset-tonal-surface self-start" onclick={() => (e.fields = [...e.fields, newEntryField()])}>
									<Icons.Plus size={14} aria-hidden="true" /> Add a field
								</button>
							</div>
						{/if}
						{#if confirming === e.uid}
							{@const rows = libraryRowsOf(form, e)}
							<div class="border-warning-500/40 flex flex-col gap-2 rounded-md border p-2 @min-[28rem]/types:col-span-2" role="group" aria-labelledby="et-rows-{e.uid}" data-remove-confirm>
								<p id="et-rows-{e.uid}" class="text-sm">
									Also remove {rows === 1 ? "the 1 library row" : `the ${rows} library rows`} of {e.name || e.id || "this entry type"}?
								</p>
								<div class="flex flex-wrap gap-2">
									<button type="button" class="btn btn-sm preset-tonal-error" onclick={() => remove(e, true)} data-remove-with-rows>Remove them too</button>
									<button type="button" class="btn btn-sm preset-tonal-surface" onclick={() => remove(e, false)} data-remove-keep-rows>Keep the rows</button>
									<button type="button" class="btn btn-sm hover:preset-tonal-surface" onclick={() => (confirming = null)}>Cancel</button>
								</div>
								<FieldHelp>Kept rows stay in the library, and Check and publish lists them until they belong to an entry type again.</FieldHelp>
							</div>
						{:else}
							<button
								type="button"
								class="btn btn-sm preset-tonal-error self-start @min-[28rem]/types:col-span-2"
								onclick={() => askRemove(e)}
								data-remove-entry-type
							>
								<Icons.Trash2 size={14} aria-hidden="true" /> Remove {e.name || "this entry type"}
							</button>
						{/if}
					</div>
				{/if}
				<RulesetRowFindings findings={findings?.rows[e.uid] ?? []} label={e.name || e.id || "This entry type"} />
			</li>
		{/each}
	</ul>
	<RulesetRowFindings findings={findings?.sections.entryTypes ?? []} label="Entry types" />
	{#if !readonly}
		<button type="button" class="btn preset-tonal-primary self-start" onclick={add} data-add-entry-type>
			<Icons.Plus size={16} aria-hidden="true" /> Add an entry type
		</button>
	{/if}
</section>
