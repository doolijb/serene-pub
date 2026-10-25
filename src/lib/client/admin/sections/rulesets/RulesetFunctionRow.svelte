<script lang="ts">
	import FieldHelp from "$lib/client/components/FieldHelp.svelte"
	/**
	 * 🚧 One **function** of a ruleset, as a sentence (PLAN-rulesets-functions
	 * D1, D8; lane A4, 2026-10-23). Its header names it, says its kind and
	 * where it comes from; its sentence is its prose with every `{{hole}}` an
	 * inline pick — a binding (an attribute, an entry type, a zone type, a
	 * scope, an owner, as its header asks) or an option of its form. Options
	 * its sentence does not name sit under it. A deciding function shows the
	 * ruleset's outcome words; every row says what it emits, what it **reads
	 * as**, and runs **Try this function**.
	 *
	 * Its body is code (STYLE-GUIDE §6.12): a reference shows the catalogue's
	 * body read-only, and **Change how it works** forks it into the ruleset
	 * (`forkFunction`: a module of its own, `forkedFrom` the original) — only a
	 * fork's body is edited here. References, not copies, until then.
	 */
	import * as Icons from "@lucide/svelte"
	import { javascript } from "@codemirror/lang-javascript"
	import {
		ATTRIBUTE_KINDS,
		attributeKindsInWords,
		forkFunction,
		functionBindingFieldTypes,
		functionBindingKinds,
		i18nText,
		type FieldDecl,
		type FunctionBindingDecl,
		type FunctionDecl
	} from "@serene-pub/sdk"
	import CodeField from "$lib/client/components/codeField/CodeField.svelte"
	import { rigourLabel } from "$lib/shared/rulesets/rigourLabels"
	import RulesetInlinePick from "./RulesetInlinePick.svelte"
	import RulesetRowFindings from "./RulesetRowFindings.svelte"
	import type { FunctionRow, RowFinding } from "./rulesetSectionsForm"
	import { refusalOf } from "./rulesetRun"
	import type { TryOutResult } from "./rulesetScene"
	import { bodyLines, functionKindLabel, optionWords, pickNote, readsAs, sentenceParts } from "./rulesetWords"

	type FunctionChoice = Sockets.Rulesets.DetailRow["functionChoices"][number]
	/** 🚧 An attribute target says the kinds it may be read as; an entry field target its field type (RF fix 6). */
	type Pick = { value: string; label: string; hint?: string; kinds?: readonly string[]; type?: string }

	interface Props {
		row: FunctionRow
		/** The catalogue's entry for what it references; null for a module only this ruleset carries. */
		choice: FunctionChoice | null
		rulesetId: string
		/** What a binding may name, by its target. */
		targets: Record<"attribute" | "entry-type" | "zone-type" | "scope" | "owner", readonly Pick[]> & { "entry-field"?: readonly Pick[] }
		/** The ruleset's outcome words. */
		outcomes: readonly string[]
		nameOf: (id: string) => string
		/** 🚧 The saved draft's findings about this row (RF fix 2). */
		findings?: readonly RowFinding[]
		readonly?: boolean
		first?: boolean
		last?: boolean
		onTry?: (row: FunctionRow) => Promise<TryOutResult>
		onRemove?: () => void
		onMove?: (by: -1 | 1) => void
	}
	let { row = $bindable(), choice, rulesetId, targets, outcomes, nameOf, findings = [], readonly = false, first = false, last = false, onTry, onRemove, onMove }: Props = $props()

	/**
	 * 🚧 The holes a removal emptied (RF fix 2, item 6), while they are still
	 * empty: each says what it named, so the author knows what to fill.
	 */
	const holes = $derived(
		(row.cleared ?? []).filter((c) => {
			const b = row.bindings[c.hole]
			const o = row.options[c.hole]
			return (b === undefined || (Array.isArray(b) ? !b.length : !b)) && (o === undefined || o === null || o === "")
		})
	)

	const decl = $derived((row.module ?? choice?.decl ?? null) as (FunctionDecl & Record<string, unknown>) | null)
	const parts = $derived(sentenceParts(decl))
	const form = $derived((decl?.form ?? {}) as Record<string, FieldDecl>)
	const bindings = $derived((decl?.bindings ?? {}) as Record<string, FunctionBindingDecl>)
	const inSentence = $derived(new Set(parts.filter((p) => "hole" in p).map((p) => (p as { hole: string }).hole)))
	const looseBindings = $derived(Object.keys(bindings).filter((r) => !inSentence.has(r)))
	const looseOptions = $derived(Object.keys(form).filter((k) => !inSentence.has(k)))
	/** Options set on the reference that its form does not describe (a copy's bands, costs): kept, shown, edited in the Document. */
	const otherOptions = $derived(Object.keys(row.options).filter((k) => !(k in form) && k !== "label"))
	const title = $derived(i18nText(row.options.label as never) || i18nText(decl?.name as never) || row.key || "A function")
	const kind = $derived(String(decl?.kind ?? ""))
	const deciding = $derived(kind === "deciding")
	const lines = $derived(bodyLines(decl))
	const seedKey = $derived(typeof decl?.seedKey === "string" ? decl.seedKey : null)
	const forked = $derived(!!row.module)
	const source = $derived(
		row.module
			? row.module.forkedFrom
				? "your copy"
				: "this ruleset's own"
			: choice?.from === "package"
				? `from ${choice.source}`
				: "from the catalogue"
	)
	const reads = $derived(readsAs(row, decl, nameOf))

	let openBody = $state(false)
	let trying = $state(false)
	let tried = $state<{ result: TryOutResult } | { error: string } | null>(null)

	/**
	 * 🚧 What a role may be filled by (RF fix 6, 2026-10-23): for an attribute
	 * role, the attributes of a kind it takes — then, where an entry's field
	 * may fill it (`entryFields`, lane T3), the fields of a type it takes.
	 * An attribute whose kind cannot be said is offered.
	 */
	function fits(role: string): { offered: Pick[]; leftOut: Pick[] } {
		const b = bindings[role]
		if (!b) return { offered: [], leftOut: [] }
		if (b.to !== "attribute") return { offered: [...(targets[b.to] ?? [])], leftOut: [] }
		const kinds = functionBindingKinds(b) as readonly string[]
		const types = functionBindingFieldTypes(b) as readonly string[]
		const attrs = targets.attribute ?? []
		const fields = types.length ? (targets["entry-field"] ?? []) : []
		const attrFits = (t: Pick) => !t.kinds?.length || t.kinds.some((k) => kinds.includes(k))
		const fieldFits = (t: Pick) => !t.type || types.includes(t.type) || (t.type === "integer" && types.includes("number"))
		return {
			offered: [...attrs.filter(attrFits), ...fields.filter(fieldFits)],
			leftOut: [...attrs.filter((t) => !attrFits(t)), ...fields.filter((t) => !fieldFits(t))]
		}
	}
	const choicesFor = (role: string): readonly Pick[] => fits(role).offered
	const roleLabel = (role: string) => i18nText(bindings[role]?.label as never) || role
	/** 🚧 Why the pick offers what it offers (pickers explain why); nothing when a role takes any kind and leaves nothing out. */
	function noteFor(role: string): string | undefined {
		const b = bindings[role]
		if (!b || b.to !== "attribute") return undefined
		const kinds = functionBindingKinds(b)
		const { offered, leftOut } = fits(role)
		if (kinds.length === ATTRIBUTE_KINDS.length && !leftOut.length) return undefined
		return pickNote({ role: roleLabel(role), takes: attributeKindsInWords(kinds), fieldTypes: functionBindingFieldTypes(b), leftOut: leftOut.map((t) => t.label), offered: offered.length })
	}

	function setOption(name: string, raw: string) {
		const f = form[name]
		const t = raw.trim()
		if (!t) row.options[name] = undefined as never
		else if (f?.type === "integer" || f?.type === "number") row.options[name] = /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : (t as never)
		else row.options[name] = t
	}
	const optionText = (name: string) => {
		const v = row.options[name]
		return v === undefined || v === null ? "" : typeof v === "object" ? "" : String(v)
	}

	/** Change how it works: the body forked into this ruleset, a module of its own. */
	function fork() {
		if (!decl) return
		const copy = forkFunction({ ...(decl as FunctionDecl), id: row.ref } as FunctionDecl, rulesetId)
		row.module = JSON.parse(JSON.stringify({ ...copy, body: copy.body ?? "" }))
		row.ref = copy.id
		openBody = true
	}

	async function tryIt() {
		if (!onTry) return
		trying = true
		tried = null
		try {
			tried = { result: await onTry(row) }
		} catch (e) {
			tried = { error: refusalOf(e).sentence }
		} finally {
			trying = false
		}
	}
</script>

{#snippet optionControl(name: string)}
	{@const f = form[name]}
	{#if f?.type === "boolean" && readonly}
		<span class="text-sm">{i18nText(f.label) ?? name}: <strong>{row.options[name] === true ? "yes" : "no"}</strong></span>
	{:else if f?.type === "boolean"}
		<label class="inline-flex min-h-8 items-center gap-1 align-baseline">
			<input type="checkbox" class="checkbox" checked={row.options[name] === true} onchange={(e) => (row.options[name] = e.currentTarget.checked)} />
			<span class="text-sm">{i18nText(f.label) ?? name}</span>
		</label>
	{:else if f?.type === "enum"}
		<RulesetInlinePick
			label={i18nText(f.label) ?? name}
			choices={(f.members ?? (f.of as string[] | undefined)?.map((k) => ({ key: k, label: k })) ?? []).map((m) => ({
				value: (m as { key: string }).key,
				label: i18nText((m as { label?: never }).label) ?? (m as { key: string }).key
			}))}
			value={String(row.options[name] ?? f.default ?? "")}
			{readonly}
			onchange={(v) => (row.options[name] = v as string)}
		/>
	{:else if f?.type === "integer" || f?.type === "number" || f?.type === "string" || f?.type === "text"}
		{#if readonly}
			<strong>{optionWords(row.options[name], f) || "—"}</strong>
		{:else}
			<input
				class="input mx-0.5 inline-block min-h-8 w-auto max-w-40 px-2 py-0 align-baseline"
				type="text"
				size={Math.max(3, optionText(name).length + 1)}
				inputmode={f?.type === "integer" || f?.type === "number" ? "numeric" : undefined}
				list={f?.type === "string" ? `fn-attrs-${row.uid}` : undefined}
				aria-label={i18nText(f?.label) ?? name}
				value={optionText(name)}
				oninput={(e) => setOption(name, e.currentTarget.value)}
			/>
		{/if}
	{:else}
		<strong>{optionWords(row.options[name], f) || "set in the Document"}</strong>
	{/if}
{/snippet}

<!-- 🚧 Focusable, so a removal above it hands it the focus and the form's Ctrl+S still saves (RF fix 6). -->
<article id="fn-{row.uid}" tabindex="-1" class="panel-card flex flex-col gap-2.5" data-function={row.key} aria-labelledby="fn-title-{row.uid}">
	<datalist id="fn-attrs-{row.uid}">
		{#each targets.attribute as a (a.value)}<option value={a.value}>{a.label}</option>{/each}
	</datalist>
	<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
		<h3 id="fn-title-{row.uid}" class="text-base font-medium">{title}</h3>
		<span class="border-surface-200-800 text-surface-600-400 rounded-full border px-2 py-0.5 text-xs">{i18nText(decl?.name as never) && title !== i18nText(decl?.name as never) ? i18nText(decl?.name as never) : functionKindLabel(kind)}</span>
		<span class="text-surface-600-400 ml-auto text-xs" data-function-source>
			{#if deciding && decl?.invokable}<span class="text-primary-ink font-medium">A way to decide · offered as an action</span> ·{/if}
			{source} · {lines ? `has a body · ${lines} line${lines === 1 ? "" : "s"}` : seedKey ? "its body is a script" : "no code"}
		</span>
	</div>

	<p class="bg-surface-100-900 rounded-md px-3 py-2 text-base leading-loose" data-function-sentence>
		{#if parts.length}
			{#each parts as p, i (i)}
				{#if "text" in p}<span class="text-surface-700-300">{p.text}</span>{:else if p.as === "binding"}
					{@const b = bindings[p.hole]}
					<RulesetInlinePick
						label="{roleLabel(p.hole)} of {title}"
						choices={choicesFor(p.hole)}
						note={noteFor(p.hole)}
						value={row.bindings[p.hole] ?? (b?.many ? [] : "")}
						many={!!b?.many}
						placeholder={roleLabel(p.hole)}
						{readonly}
						onchange={(v) => (row.bindings[p.hole] = v)}
					/>
				{:else if p.as === "option"}{@render optionControl(p.hole)}{:else}<strong>{p.hole}</strong>{/if}
			{/each}
		{:else}
			<span class="text-surface-600-400">It says nothing the model reads yet.</span>
		{/if}
	</p>

	{#if looseBindings.length || looseOptions.length}
		<div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" data-function-options>
			{#each looseBindings as role (role)}
				<span class="inline-flex items-center gap-1">
					<span class="text-surface-600-400">{roleLabel(role)}:</span>
					<RulesetInlinePick
						label="{roleLabel(role)} of {title}"
						choices={choicesFor(role)}
						note={noteFor(role)}
						value={row.bindings[role] ?? (bindings[role]?.many ? [] : "")}
						many={!!bindings[role]?.many}
						{readonly}
						onchange={(v) => (row.bindings[role] = v)}
					/>
				</span>
			{/each}
			{#each looseOptions as name (name)}
				<span class="inline-flex items-center gap-1">
					{#if form[name]?.type !== "boolean"}<span class="text-surface-600-400">{i18nText(form[name]?.label) ?? name}:</span>{/if}
					{@render optionControl(name)}
				</span>
			{/each}
		</div>
	{/if}
	{#if otherOptions.length}
		<FieldHelp>Also set: {otherOptions.join(", ")}. Change them in the Document.</FieldHelp>
	{/if}
	{#if holes.length}
		<ul class="border-warning-500/40 bg-warning-500/5 flex flex-col gap-0.5 rounded-md border px-3 py-2 text-sm" data-function-holes>
			{#each holes as h (h.hole)}
				<li>
					<span class="text-warning-700-300 font-medium">{h.hole in bindings ? roleLabel(h.hole) : (i18nText(form[h.hole]?.label) ?? h.hole)}</span> was {h.was}, which you removed. Pick what it is now.
				</li>
			{/each}
		</ul>
	{/if}
	<RulesetRowFindings {findings} label={title} />

	{#if deciding}
		<div class="grid gap-2 @min-[40rem]/fns:grid-cols-2">
			<div class="border-surface-200-800 rounded-md border px-3 py-2 text-sm">
				<p class="text-surface-600-400 text-xs">Outcomes, in your words</p>
				{#if outcomes.length}
					<ul class="mt-1 flex flex-wrap gap-1.5" aria-label="Outcomes">
						{#each outcomes as o (o)}<li class="border-surface-200-800 rounded-full border px-2.5 py-0.5">{o}</li>{/each}
					</ul>
				{:else}
					<p class="mt-1">None named yet: a result reads as the host's. Name them under Outcomes and time.</p>
				{/if}
			</div>
			<div class="border-surface-200-800 rounded-md border px-3 py-2 text-sm">
				<p class="text-surface-600-400 text-xs">Then</p>
				<p class="mt-1">
					{decl?.emits?.length ? `It may raise ${decl.emits.join(", ")}.` : "It raises nothing of its own."}
				</p>
				<p class="text-surface-600-400 mt-1 text-xs">What it changes is proposed, never written: the pipeline stores it.</p>
			</div>
		</div>
	{/if}

	<div class="text-surface-600-400 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
		{#if !deciding}<span>Emits: <strong class="text-surface-950-50">{decl?.emits?.length ? decl.emits.join(", ") : "nothing"}</strong></span>{/if}
		{#if reads}<span data-reads-as>Reads as: <em class="text-surface-950-50">“{reads}”</em></span>{/if}
		{#if deciding}<span>Under <strong class="text-surface-950-50">{rigourLabel("prose")}</strong>: the model judges it from the sentence.</span>{/if}
		<button
			type="button"
			class="text-primary-ink min-h-8 underline-offset-2 hover:underline"
			aria-expanded={openBody}
			aria-controls="fn-body-{row.uid}"
			onclick={() => (openBody = !openBody)}
			data-function-body-toggle
		>
			{openBody ? "Hide the body" : lines || seedKey ? "Open the body" : "Code: none, open the body to add some"}
		</button>
		{#if onTry}
			<button type="button" class="btn btn-sm preset-tonal-surface ml-auto" disabled={trying} onclick={tryIt} data-try-function>
				{#if trying}<Icons.LoaderCircle size={14} class="animate-spin" aria-hidden="true" />{/if} Try this function
			</button>
		{/if}
	</div>

	{#if tried}
		<div class="border-surface-200-800 rounded-md border px-3 py-2 text-sm" role="status" data-tried>
			{#if "error" in tried}
				<p class="text-warning-700-300">{tried.error}</p>
			{:else}
				{@const f = tried.result.function}
				<p>Reads as: <em>“{f?.readsAs || reads || "nothing yet"}”</em></p>
				{#if f && !f.ran}
					<FieldHelp>It is read, not run, here for now: the rules run function modules once their engine lands.</FieldHelp>
				{/if}
				{#each tried.result.outcomes as o, i (i)}<p>{o.text}</p>{/each}
			{/if}
		</div>
	{/if}

	{#if openBody}
		<div id="fn-body-{row.uid}" class="flex flex-col gap-2" data-function-body>
			{#if seedKey && !lines}
				<FieldHelp>Its body is the script <span class="font-mono">{seedKey}</span>, under Admin › Scripts.</FieldHelp>
			{:else}
				<CodeField
					value={String(decl?.body ?? "")}
					readonly={readonly || !forked}
					rows={8}
					label="The body of {title}"
					placeholder={forked ? "effects(ctx) {\n  return { deltas: [] }\n}" : "No body: the model judges it from its sentence."}
					extensions={javascript()}
					oninput={(v) => {
						if (row.module) row.module.body = v
					}}
				/>
			{/if}
			{#if !readonly && !forked && decl}
				<p class="text-surface-600-400 flex flex-wrap items-center gap-2 text-xs">
					It is used by reference: a change to it would change it everywhere it is used.
					<button type="button" class="btn btn-sm preset-tonal-surface" onclick={fork} data-fork-function>
						<Icons.GitFork size={14} aria-hidden="true" /> Change how it works
					</button>
				</p>
			{:else if forked && row.module?.forkedFrom}
				<FieldHelp>Your copy of <span class="font-mono">{row.module.forkedFrom}</span>: changes here are this ruleset's alone.</FieldHelp>
			{/if}
		</div>
	{/if}

	{#if !readonly}
		<div class="flex flex-wrap items-center gap-2">
			<label class="text-surface-600-400 inline-flex items-center gap-1 text-xs">
				Called
				<input class="input min-h-8 w-48 px-2 py-0 font-mono text-xs" type="text" bind:value={row.key} spellcheck="false" aria-label="What {title} is called in these rules" />
			</label>
			<span class="ml-auto flex gap-1">
				<button type="button" class="btn-icon btn-icon-sm preset-tonal-surface" disabled={first} aria-label="Move {title} up" onclick={() => onMove?.(-1)}>
					<Icons.ArrowUp size={14} aria-hidden="true" />
				</button>
				<button type="button" class="btn-icon btn-icon-sm preset-tonal-surface" disabled={last} aria-label="Move {title} down" onclick={() => onMove?.(1)}>
					<Icons.ArrowDown size={14} aria-hidden="true" />
				</button>
				<button type="button" class="btn btn-sm preset-tonal-error" onclick={() => onRemove?.()} data-remove-function>
					<Icons.Trash2 size={14} aria-hidden="true" /> Remove
				</button>
			</span>
		</div>
	{/if}
</article>
