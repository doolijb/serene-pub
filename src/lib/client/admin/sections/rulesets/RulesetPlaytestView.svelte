<script lang="ts">
	import FieldHelp from "$lib/client/components/FieldHelp.svelte"
	/**
	 * 🚧 **Playtest a scene** (PLAN-rulesets-functions D8, lane A4,
	 * 2026-10-23): a sample party, a situation, one thing that happens, put
	 * through the rules once (`rulesets:tryOut`, nothing saved). **Run the
	 * scene**; **Ask a model** (the Reply loadout narrates what the rules
	 * decided, `rulesets:askModel`); **Run it N times** (N seeds, the outcomes
	 * counted); **Save as a test** (the scene kept in the draft, `playtests`,
	 * waiting for Save). The result: what happened in the ruleset's words, how
	 * it was decided, each change as proposed, refused or no change, and what
	 * the model would read.
	 *
	 * The functions it runs are read, not run, until the engine runs function
	 * modules (lane A1); the ways a check is decided run today.
	 */
	import * as Icons from "@lucide/svelte"
	import type { Rigour } from "@serene-pub/sdk"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { rigourLabel } from "$lib/shared/rulesets/rigourLabels"
	import RulesetInlinePick from "./RulesetInlinePick.svelte"
	import type { Json } from "./rulesetFormParts"
	import { askModel, refusalOf, runTryOut } from "./rulesetRun"
	import {
		blocksInOrder,
		changeDelta,
		libraryRows,
		newSceneMember,
		outcomeWord,
		partyParams,
		promptTokens,
		savedOf,
		sceneFromSaved,
		slotOfAttribute,
		type PlaytestScene,
		type TryOutParams,
		type TryOutResult
	} from "./rulesetScene"
	import { newRowUid, type SectionsForm } from "./rulesetSectionsForm"
	import { attributeName } from "./rulesetWords"

	type FunctionChoice = Sockets.Rulesets.DetailRow["functionChoices"][number]
	type SlotChoice = Sockets.Rulesets.DetailRow["slotChoices"][number]

	interface Props {
		rulesetId: string
		form: SectionsForm
		scene: PlaytestScene
		/** The unsaved draft to run, worked out as a run is sent; null runs what is saved. */
		getDocument: () => Json | null
		slotChoices: readonly SlotChoice[]
		choices: readonly FunctionChoice[]
		readonly?: boolean
	}
	let { rulesetId, form = $bindable(), scene = $bindable(), getDocument, slotChoices, choices, readonly = false }: Props = $props()

	const socket = useTypedSocket()
	const RIGOURS: Rigour[] = ["prose", "mechanics", "scripts"]
	const KINDS = [
		{ value: "none", label: "Nothing yet: just read the scene" },
		{ value: "function", label: "Someone uses a function" },
		{ value: "attribute", label: "An attribute changes" },
		{ value: "entry", label: "Someone gains or loses an entry" }
	]

	let running = $state<"run" | "ask" | "repeat" | null>(null)
	let result = $state.raw<TryOutResult | null>(null)
	let narration = $state<{ text: string; loadout: string } | null>(null)
	let refusal = $state<{ sentence: string; findings: string[] } | null>(null)
	let times = $state("200")
	let testName = $state("")
	let savedNote = $state<string | null>(null)

	const people = $derived(scene.party.map((m) => ({ value: m.name, label: m.name || "Someone" })))
	const functionChoices = $derived(
		form.functions.map((f) => {
			const c = choices.find((x) => x.id === f.ref)
			return { value: f.key, label: f.key, hint: c?.name }
		})
	)
	const attributeChoices = $derived(form.attributes.map((a) => ({ value: a.id, label: attributeName(a, slotChoices) })))
	const entryTypeChoices = $derived(form.entryTypes.map((e) => ({ value: e.id, label: e.name || e.id })))
	const nameOfSlot = (slotId: string) => {
		const a = form.attributes.find((x) => slotOfAttribute(rulesetId, x) === slotId || x.id === slotId)
		return a ? attributeName(a, slotChoices) : (slotChoices.find((s) => s.id === slotId)?.label ?? slotId)
	}
	/** A member by the key a run names them by (`sample:2`) or the owner it files a change under. */
	const memberName = (owner: unknown) => {
		if (typeof owner === "string") {
			const m = /^sample:(\d+)$/.exec(owner)
			return m ? (scene.party[Number(m[1]) - 1]?.name ?? owner) : owner
		}
		const id = (owner as { id?: unknown } | null)?.id
		return typeof id === "number" ? (scene.party[id]?.name ?? "Someone") : String(owner ?? "")
	}

	function params(extra: Partial<TryOutParams> = {}): { ok: true; p: TryOutParams } | { ok: false; error: string } {
		const plan = changeDelta(rulesetId, form, scene.change)
		if (!plan.ok) return { ok: false, error: plan.error }
		const doc = getDocument()
		return {
			ok: true,
			p: {
				rulesetId,
				rigour: scene.rigour,
				party: partyParams(rulesetId, form, scene.party),
				deltas: plan.delta ? [plan.delta as never] : [],
				scripts: true,
				...(scene.seed.trim() ? { seed: scene.seed.trim() } : {}),
				...(doc ? { document: doc } : {}),
				...extra
			}
		}
	}

	async function run(kind: "run" | "ask" | "repeat") {
		const built = params(kind === "repeat" ? { repeat: Math.max(2, Math.min(200, Number(times) || 200)), scripts: false } : {})
		if (!built.ok) {
			refusal = { sentence: built.error, findings: [] }
			return
		}
		running = kind
		refusal = null
		if (kind !== "ask") narration = null
		try {
			if (kind === "ask") {
				const r = await askModel(socket, { ...built.p, situation: scene.situation })
				result = r.result
				narration = { text: r.narration, loadout: r.loadout }
			} else result = await runTryOut(socket, built.p)
		} catch (e) {
			refusal = refusalOf(e)
		} finally {
			running = null
		}
	}

	function saveTest() {
		const name = testName.trim() || scene.situation.trim().slice(0, 40) || `Scene ${form.playtests.length + 1}`
		form.playtests = [...form.playtests, { uid: newRowUid(), value: savedOf(rulesetId, form, scene, name) }]
		testName = ""
		savedNote = `Kept as “${name}”. Save the ruleset to keep it for good.`
	}
	function load(i: number) {
		scene = sceneFromSaved(rulesetId, form, form.playtests[i]!.value)
	}

	const decided = $derived((result?.outcomes ?? []).filter((o) => o.check || o.kind === "check"))
	const others = $derived((result?.outcomes ?? []).filter((o) => !(o.check || o.kind === "check")))
	const tallyMax = $derived(Math.max(1, ...(result?.repeat?.tally ?? []).map((t) => t.count)))
</script>

<section class="flex min-w-0 flex-col gap-3" aria-labelledby="playtest-heading" data-playtest>
	<div class="flex min-w-0 flex-col gap-0.5">
		<h2 id="playtest-heading" class="text-base font-medium">Playtest a scene</h2>
		<FieldHelp>A sample party, a situation, one turn through the rules. Nothing is saved.</FieldHelp>
	</div>

	<div class="grid gap-3 @min-[60rem]/content:grid-cols-2">
		<div class="panel-card flex min-w-0 flex-col gap-3" data-scene>
			<h3 class="text-sm font-medium">The scene</h3>
			<ul class="grid gap-2 sm:grid-cols-2">
				{#each scene.party as m, i (m.uid)}
					<li class="border-surface-200-800 flex flex-col gap-1.5 rounded-md border p-2" data-member={m.name}>
						<div class="flex items-center gap-1">
							<input class="input min-h-8 flex-1 px-2 py-0 font-medium" type="text" bind:value={m.name} aria-label="Name of someone in the scene" />
							{#if scene.party.length > 1}
								<button type="button" class="btn-icon btn-icon-sm preset-tonal-surface" aria-label="Take {m.name || 'them'} out of the scene" onclick={() => (scene.party = scene.party.filter((x) => x.uid !== m.uid))}>
									<Icons.X size={14} aria-hidden="true" />
								</button>
							{/if}
						</div>
						{#each form.attributes as a (a.uid)}
							<label class="flex items-center justify-between gap-2 text-xs">
								<span class="text-surface-600-400">{attributeName(a, slotChoices)}</span>
								<input class="input min-h-8 w-24 px-2 py-0 text-sm" type="text" bind:value={m.values[a.id]} placeholder={a.start || (a.kind === "pool" ? a.max : a.kind === "label" ? (a.of.split(",")[0]?.trim() ?? "") : a.min) || "—"} />
							</label>
						{/each}
						{#each form.entryTypes as e (e.uid)}
							{@const rows = libraryRows(form, e.id)}
							{#if rows.length}
								<div class="flex flex-wrap items-center gap-1 text-xs">
									<span class="text-surface-600-400">{e.name || e.id}:</span>
									<RulesetInlinePick
										many
										label="{e.name || e.id} {m.name} holds"
										choices={rows.map((r) => ({ value: r.id, label: r.name }))}
										value={m.held[e.id] ?? []}
										text={(m.held[e.id] ?? []).length ? undefined : "none"}
										onchange={(v) => (m.held[e.id] = v as string[])}
									/>
								</div>
							{/if}
						{/each}
						{#if i === 0 && !form.attributes.length}<p class="text-surface-600-400 text-xs">No attributes yet: they are read as people, by name.</p>{/if}
					</li>
				{/each}
			</ul>
			{#if scene.party.length < 4}
				<button type="button" class="btn btn-sm preset-tonal-surface self-start" onclick={() => (scene.party = [...scene.party, newSceneMember(scene)])}>
					<Icons.UserPlus size={14} aria-hidden="true" /> Add someone
				</button>
			{/if}
			<label class="flex flex-col gap-1 text-xs">
				<span class="text-surface-600-400">Situation</span>
				<textarea class="textarea" rows={2} bind:value={scene.situation} placeholder="The pier at dusk. Wren has been working up to it all day."></textarea>
			</label>
			<div class="flex flex-col gap-1.5" data-scene-change>
				<span class="text-surface-600-400 text-xs">What happens</span>
				<div class="flex flex-wrap items-center gap-1 text-sm">
					<RulesetInlinePick label="What happens" choices={KINDS} value={scene.change.kind} onchange={(v) => (scene.change.kind = v as never)} />
					{#if scene.change.kind !== "none"}
						<span class="text-surface-600-400">by</span>
						<RulesetInlinePick label="Who does it" choices={people} value={scene.change.owner} placeholder="someone" onchange={(v) => (scene.change.owner = String(v))} />
					{/if}
					{#if scene.change.kind === "function"}
						<span class="text-surface-600-400">using</span>
						<RulesetInlinePick label="The function" choices={functionChoices} value={scene.change.key} placeholder="a function" onchange={(v) => (scene.change.key = String(v))} />
						<label class="text-surface-600-400 inline-flex items-center gap-1 text-xs">
							amount <input class="input min-h-8 w-16 px-2 py-0" type="text" bind:value={scene.change.value} />
						</label>
					{:else if scene.change.kind === "attribute"}
						<RulesetInlinePick label="How it changes" choices={[{ value: "add", label: "adds to" }, { value: "set", label: "sets" }]} value={scene.change.op} onchange={(v) => (scene.change.op = String(v))} />
						<RulesetInlinePick label="The attribute" choices={attributeChoices} value={scene.change.attribute} placeholder="an attribute" onchange={(v) => (scene.change.attribute = String(v))} />
						<input class="input min-h-8 w-20 px-2 py-0" type="text" bind:value={scene.change.value} aria-label={scene.change.op === "set" ? "To" : "By"} />
					{:else if scene.change.kind === "entry"}
						<RulesetInlinePick label="Gains or loses" choices={[{ value: "add", label: "gains" }, { value: "remove", label: "loses" }]} value={scene.change.op} onchange={(v) => (scene.change.op = String(v))} />
						<RulesetInlinePick label="Which entry type" choices={entryTypeChoices} value={scene.change.entryType} placeholder="an entry type" onchange={(v) => (scene.change.entryType = String(v))} />
						<RulesetInlinePick
							label="Which one"
							choices={libraryRows(form, scene.change.entryType).map((r) => ({ value: r.id, label: r.name }))}
							value={scene.change.row}
							placeholder="which"
							onchange={(v) => (scene.change.row = String(v))}
						/>
					{/if}
					{#if scene.change.kind !== "none"}
						<span class="text-surface-600-400">aimed at</span>
						<RulesetInlinePick label="Aimed at" choices={[{ value: "", label: "no one" }, ...people]} value={scene.change.aimedAt} onchange={(v) => (scene.change.aimedAt = String(v))} />
					{/if}
				</div>
			</div>
			<div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
				<span class="text-surface-600-400 inline-flex items-center gap-1">
					How strict
					<RulesetInlinePick label="How strict, for the scene" choices={RIGOURS.map((r) => ({ value: r, label: rigourLabel(r) }))} value={scene.rigour} onchange={(v) => (scene.rigour = v as Rigour)} />
				</span>
				<label class="text-surface-600-400 inline-flex items-center gap-1">
					Seed <input class="input min-h-8 w-28 px-2 py-0 font-mono" type="text" bind:value={scene.seed} placeholder="pier-1" />
				</label>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<button type="button" class="btn btn-sm preset-tonal-primary" disabled={!!running} onclick={() => run("run")} data-run-scene>
					{#if running === "run"}<Icons.LoaderCircle size={14} class="animate-spin" aria-hidden="true" />{:else}<Icons.Play size={14} aria-hidden="true" />{/if} Run the scene
				</button>
				<button type="button" class="btn btn-sm preset-tonal-surface" disabled={!!running} onclick={() => run("ask")} data-ask-model>
					{#if running === "ask"}<Icons.LoaderCircle size={14} class="animate-spin" aria-hidden="true" />{:else}<Icons.MessageSquareText size={14} aria-hidden="true" />{/if} Ask a model
				</button>
				<span class="inline-flex items-center gap-1">
					<button type="button" class="btn btn-sm preset-tonal-surface" disabled={!!running} onclick={() => run("repeat")} data-run-repeat>
						{#if running === "repeat"}<Icons.LoaderCircle size={14} class="animate-spin" aria-hidden="true" />{:else}<Icons.Repeat size={14} aria-hidden="true" />{/if} Run it {times || "200"} times
					</button>
					<input class="input min-h-8 w-16 px-2 py-0" type="text" inputmode="numeric" bind:value={times} aria-label="How many times" />
				</span>
				{#if !readonly}
					<span class="inline-flex items-center gap-1">
						<input class="input min-h-8 w-36 px-2 py-0" type="text" bind:value={testName} placeholder="Name it" aria-label="Name for the test" />
						<button type="button" class="btn btn-sm preset-tonal-surface" onclick={saveTest} data-save-test>
							<Icons.Bookmark size={14} aria-hidden="true" /> Save as a test
						</button>
					</span>
				{/if}
			</div>
			{#if savedNote}<p class="text-surface-600-400 text-xs" role="status">{savedNote}</p>{/if}
			{#if form.playtests.length}
				<div class="flex flex-col gap-1" data-saved-tests>
					<span class="text-surface-600-400 text-xs">Saved tests</span>
					<ul class="flex flex-col gap-1">
						{#each form.playtests as t, i (t.uid)}
							<li class="flex flex-wrap items-center gap-2 text-sm">
								<span class="flex-1">{t.value.name}</span>
								<button type="button" class="btn btn-sm preset-tonal-surface" onclick={() => load(i)}>Load</button>
								{#if !readonly}
									<button type="button" class="btn-icon btn-icon-sm preset-tonal-surface" aria-label="Remove the test {t.value.name}" onclick={() => (form.playtests = form.playtests.filter((x) => x.uid !== t.uid))}>
										<Icons.X size={14} aria-hidden="true" />
									</button>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>

		<div class="panel-card flex min-w-0 flex-col gap-2.5" aria-live="polite" data-result>
			<h3 class="text-sm font-medium">What happened</h3>
			{#if refusal}
				<div role="status" data-refused>
					<p class="text-warning-700-300 text-sm">{refusal.sentence}</p>
					{#if refusal.findings.length}
						<ul class="text-surface-600-400 flex list-disc flex-col gap-0.5 pl-4 text-xs">
							{#each refusal.findings.slice(0, 8) as f, i (i)}<li>{f}</li>{/each}
						</ul>
					{/if}
				</div>
			{:else if !result}
				<p class="text-surface-600-400 text-sm">Run the scene to see what the rules make of it.</p>
			{:else}
				{#if result.repeat}
					<div class="flex flex-col gap-1" data-tally>
						<p class="text-sm">Over {result.repeat.runs} runs:</p>
						{#each result.repeat.tally as t (t.outcome)}
							<div class="grid grid-cols-[8rem_minmax(0,1fr)_3rem] items-center gap-2 text-sm">
								<span>{t.outcome}</span>
								<span class="bg-surface-200-800 h-2 overflow-hidden rounded-full"><span class="bg-primary-500 block h-full" style="width: {Math.round((t.count / tallyMax) * 100)}%"></span></span>
								<span class="text-right tabular-nums">{Math.round((t.count / result.repeat.runs) * 100)}%</span>
							</div>
						{/each}
					</div>
				{:else}
					{#each decided as o, i (i)}
						<p class="text-sm" data-outcome-line>
							{memberName(o.owner)} — {o.text}{#if outcomeWord(o) !== o.text}{" — "}<strong class="text-primary-ink">{outcomeWord(o)}</strong>{/if}
						</p>
					{/each}
					{#each others as o, i (i)}<p class="text-sm">{o.text}</p>{/each}
					{#if !decided.length && !others.length}<p class="text-sm">Nothing was decided by the rules: the model tells it from the sentences.</p>{/if}
					{#if result.explain.length}
						<details class="text-sm">
							<summary class="text-primary-ink min-h-8 cursor-pointer">How it was decided</summary>
							<ul class="text-surface-700-300 mt-1 flex flex-col gap-0.5 text-xs">
								{#each result.explain as e, i (i)}<li>{e.text}</li>{/each}
							</ul>
						</details>
					{/if}
					<ul class="flex flex-col gap-1 text-sm" data-changes>
						{#each result.changes as c, i (i)}
							<li class="border-surface-200-800 flex justify-between gap-2 rounded-md border px-2 py-1">
								<span>{memberName(c.owner)} · {nameOfSlot(c.slotId)} {c.op === "set" ? "→" : c.op === "remove" ? "−" : "+"} {Array.isArray(c.value) ? c.value.join(", ") : String(c.value ?? "")}</span>
								<span class="text-surface-600-400 text-xs">{c.held ? "for review" : "proposed"}</span>
							</li>
						{/each}
						{#each result.rejected as r, i (i)}
							<li class="border-surface-200-800 flex justify-between gap-2 rounded-md border px-2 py-1">
								<span>{r.why}</span><span class="text-warning-700-300 text-xs">refused</span>
							</li>
						{/each}
						{#if !result.changes.length && !result.rejected.length && scene.change.kind !== "none"}
							<li class="text-surface-600-400 text-xs">No change.</li>
						{/if}
					</ul>
					<FieldHelp>Changes land through the pipeline, under Review here. The rules wrote nothing.</FieldHelp>
				{/if}
				{#if narration}
					<div class="border-surface-200-800 flex flex-col gap-1 rounded-md border px-3 py-2" data-narration>
						<p class="text-sm">{narration.text}</p>
						<FieldHelp>Told by {narration.loadout}. Nothing was saved.</FieldHelp>
					</div>
				{/if}
				<details class="text-sm">
					<summary class="text-primary-ink min-h-8 cursor-pointer">What the model would read · {promptTokens(result)} tokens</summary>
					<pre class="bg-surface-100-900 mt-1 max-h-72 overflow-auto rounded-md px-3 py-2 font-mono text-xs whitespace-pre-wrap">{blocksInOrder(result)
							.map((b) => b.text)
							.join("\n\n")}</pre>
				</details>
			{/if}
		</div>
	</div>
</section>
