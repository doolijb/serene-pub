<script lang="ts">
	import FieldHelp from "$lib/client/components/FieldHelp.svelte"
	/**
	 * 🚧 **Options** (PLAN-rulesets-functions D2, D8; lane A4, 2026-10-23):
	 * the ways a table may play these rules — each a choice with its words,
	 * which one is the default, and whether a session's owner may set it
	 * (`reach: 'owner'`). What a choice changes in the rules, presets and
	 * conversions are kept as they are and named here; the Document edits
	 * them.
	 */
	import * as Icons from "@lucide/svelte"
	import RulesetInlinePick from "./RulesetInlinePick.svelte"
	import { newOption, newRowUid, type SectionsForm } from "./rulesetSectionsForm"

	interface Props {
		form: SectionsForm
		readonly?: boolean
		onOpenDocument?: () => void
	}
	let { form = $bindable(), readonly = false, onOpenDocument }: Props = $props()

	const original = $derived((form.options.original ?? {}) as { lays?: Record<string, unknown>; presets?: unknown[]; conversions?: unknown[] })
	const lays = $derived(Object.values(original.lays ?? {}).reduce<number>((n, v) => n + Object.keys((v ?? {}) as object).length, 0))
	const presets = $derived(original.presets?.length ?? 0)
	const conversions = $derived(original.conversions?.length ?? 0)
</script>

<section class="flex min-w-0 flex-col gap-3" aria-labelledby="options-heading" data-section="options">
	<div class="flex flex-wrap items-start justify-between gap-2">
		<div class="flex min-w-0 flex-col gap-0.5">
			<h2 id="options-heading" class="text-base font-medium">Options</h2>
			<FieldHelp>The ways a table may play these rules: choices a session's owner can make.</FieldHelp>
		</div>
		{#if !readonly}
			<button type="button" class="btn btn-sm preset-tonal-primary" onclick={() => (form.options.fields = [...form.options.fields, newOption(form)])} data-add-option>
				<Icons.Plus size={14} aria-hidden="true" /> Add an option
			</button>
		{/if}
	</div>

	{#each form.options.fields as f (f.uid)}
		<div class="panel-card flex flex-col gap-2" data-option={f.name}>
			{#if !f.enumField}
				<p class="text-sm"><strong>{f.label || f.name}</strong> <span class="text-surface-600-400">— a value its functions read, set in the Document.</span></p>
			{:else}
				<div class="grid gap-2 sm:grid-cols-3">
					<label class="flex flex-col gap-1 text-xs">
						<span class="text-surface-600-400">Label</span>
						<input class="input" type="text" bind:value={f.label} placeholder="Casting" readonly={readonly} />
					</label>
					<label class="flex flex-col gap-1 text-xs">
						<span class="text-surface-600-400">Id</span>
						<input class="input font-mono" type="text" bind:value={f.name} spellcheck="false" readonly={readonly} />
					</label>
					{#if readonly}
						<p class="flex min-h-10 items-center self-end text-sm">{f.owner ? "A session's owner may set it" : "Set by the rules alone"}</p>
					{:else}
						<label class="flex min-h-10 items-center gap-2 self-end text-sm">
							<input type="checkbox" class="checkbox" bind:checked={f.owner} /> A session's owner may set it
						</label>
					{/if}
					<label class="flex flex-col gap-1 text-xs sm:col-span-3">
						<span class="text-surface-600-400">What it means</span>
						<input class="input" type="text" bind:value={f.description} readonly={readonly} />
					</label>
				</div>
				<div class="flex flex-col gap-1.5">
					<span class="text-surface-600-400 text-xs">Choices</span>
					{#each f.choices as c (c.uid)}
						<div class="flex flex-wrap items-center gap-2">
							<input class="input w-32 font-mono" type="text" bind:value={c.key} aria-label="Choice id" spellcheck="false" readonly={readonly} />
							<input class="input min-w-40 flex-1" type="text" bind:value={c.label} aria-label="What it is called" readonly={readonly} />
							{#if !readonly}
								<button type="button" class="btn-icon btn-icon-sm preset-tonal-surface" aria-label="Remove the choice {c.label || c.key}" onclick={() => (f.choices = f.choices.filter((x) => x.uid !== c.uid))}>
									<Icons.X size={14} aria-hidden="true" />
								</button>
							{/if}
						</div>
					{/each}
					<div class="flex flex-wrap items-center gap-2">
						{#if !readonly}
							<button type="button" class="btn btn-sm preset-tonal-surface" onclick={() => (f.choices = [...f.choices, { uid: newRowUid(), key: "", label: "" }])}>
								<Icons.Plus size={14} aria-hidden="true" /> Add a choice
							</button>
						{/if}
						{#if f.choices.length}
							<span class="text-surface-600-400 inline-flex items-center gap-1 text-xs">
								Default:
								<RulesetInlinePick
									label="The default of {f.label || f.name}"
									choices={f.choices.filter((c) => c.key.trim()).map((c) => ({ value: c.key.trim(), label: c.label || c.key }))}
									value={f.default || f.choices[0]?.key || ""}
									{readonly}
									onchange={(v) => (f.default = String(v))}
								/>
							</span>
						{/if}
						{#if !readonly}
							<button type="button" class="btn btn-sm preset-tonal-error ml-auto" onclick={() => (form.options.fields = form.options.fields.filter((x) => x.uid !== f.uid))}>
								<Icons.Trash2 size={14} aria-hidden="true" /> Remove
							</button>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	{:else}
		<p class="panel-card text-surface-600-400 text-sm">None: every table plays these rules the same way.</p>
	{/each}

	{#if lays || presets || conversions}
		<FieldHelp data-options-kept>
			Also kept: {[lays ? `what ${lays} choice${lays === 1 ? "" : "s"} change` : "", presets ? `${presets} preset${presets === 1 ? "" : "s"}` : "", conversions ? `${conversions} conversion${conversions === 1 ? "" : "s"} from other rules` : ""]
				.filter(Boolean)
				.join(", ")}.
			<button type="button" class="text-primary-ink underline underline-offset-2" onclick={() => onOpenDocument?.()}>Edit them in the Document</button>.
		</FieldHelp>
	{/if}
</section>
