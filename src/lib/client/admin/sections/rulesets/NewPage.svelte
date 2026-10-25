<script lang="ts">
	/**
	 * 🚧 Admin › Rulesets › **New ruleset** (PLAN-rulesets-functions D8, D9;
	 * lane A4, 2026-10-23; the design canvas's first screen). A label and the
	 * id it makes (`<owner>:ruleset/<name>@1`, made from the pub's owner slug
	 * and the label until typed over; it never changes), then **What kind of
	 * game is it?** — **From scratch** first (truly empty, R9: a session on
	 * it reads like one with no rules), then the archetypes (ruleset
	 * templates: a paragraph, how each decides, its attributes, entry types
	 * and zone types), and under **More starting points** the other
	 * archetypes, **A copy of rules you have** and **Paste a document**.
	 * Nothing exists until **Save**; the server makes the row with its draft
	 * (`rulesets:create`) and the page lands on it.
	 *
	 * `?from=<id>` preselects a template or a ruleset to copy; `?from=blank`
	 * from scratch.
	 */
	import { getContext } from "svelte"
	import * as Icons from "@lucide/svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import CodeField from "$lib/client/components/codeField/CodeField.svelte"
	import { adminGoto, adminPage, adminUnsavedEdits } from "$lib/client/admin/adminRouter.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getAdminInterestContext } from "$lib/client/sockets/interest.svelte"
	import AdminChangeForm from "$lib/client/components/admin/AdminChangeForm.svelte"
	import AdminFieldset from "$lib/client/components/admin/AdminFieldset.svelte"
	import AdminField, { describedBy } from "$lib/client/components/admin/AdminField.svelte"
	import { OWNER_SLUG } from "$lib/client/components/pipelines/workspace/canvas/draft.svelte"
	import { originLabel } from "./rulesetLabels"
	import { parseDocumentText } from "./rulesetDocument"
	import { slugOf } from "./rulesetSectionsForm"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()
	// `rulesets:` is a RESTRICTED (admin-only) interest family.
	const interest = getAdminInterestContext()

	/** `vis-itineris`: lowercase letters and digits joined by single hyphens (the server's `RULESET_NAME`). */
	const RULESET_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/
	/** A ruleset id as the server makes one: `<owner>:ruleset/<name>@1`. */
	const RULESET_ID = /^([^:\s]*):ruleset\/([^@\s]*)@1$/
	const SCRATCH = "scratch"
	const COPY = "copy"
	const PASTE = "paste"
	/** The archetypes shown first, in this order, when the catalogue has them; the rest go under the fold. */
	const MAIN_STEMS = ["romance", "slice-of-life", "workplace", "card-game", "dice-adventure", "d20-style"]

	let rulesets = $state<Sockets.Rulesets.ListRow[]>([])
	let templates = $state<Sockets.Rulesets.TemplateCard[]>([])
	let loading = $state(true)

	let offeredOwner = $state("")
	let label = $state("")
	/** The id as typed; null while it follows the label. */
	let idTyped = $state<string | null>(null)
	/** `scratch`, a template's id, `copy` or `paste`. */
	let from = $state(SCRATCH)
	let copyFrom = $state("")
	let pasted = $state("")
	const autoId = $derived(`${offeredOwner}:ruleset/${slugOf(label) || "new-ruleset"}@1`)
	const id = $derived(idTyped ?? autoId)
	const dirty = $derived(!!label.trim() || idTyped !== null || !!pasted.trim())
	adminUnsavedEdits(() => dirty && !saving)

	const main = $derived(
		MAIN_STEMS.map((s) => templates.find((t) => t.stem === s))
			.filter((t): t is Sockets.Rulesets.TemplateCard => !!t)
			.slice(0, 5)
	)
	const more = $derived(templates.filter((t) => !main.includes(t)))
	const fromTemplate = $derived(templates.find((t) => t.id === from))
	const fromRow = $derived(rulesets.find((r) => r.rulesetId === copyFrom))
	const pickable = $derived(rulesets.filter((r) => r.state !== "retired" && r.state !== "draft"))
	const moreOpen = $derived(from === COPY || from === PASTE || more.some((t) => t.id === from))

	let saving = $state(false)
	let pending = false
	let formErrors = $state<string[]>([])
	let idError = $state<string | null>(null)
	let labelError = $state<string | null>(null)
	let pasteError = $state<string | null>(null)

	/** The owner every ruleset made here shares, when there is exactly one. */
	function pubOwner(rows: Sockets.Rulesets.ListRow[]): string {
		const owners = new Set(rows.filter((r) => r.origin === "pub").map((r) => r.rulesetId.slice(0, r.rulesetId.indexOf(":"))))
		return owners.size === 1 ? [...owners][0]! : ""
	}

	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const releases = [
			interest.declareInterest<"rulesets:create">("rulesets:create", (res) => {
				if (!pending || !res.rulesetId) return
				pending = false
				saving = false
				label = ""
				idTyped = null
				pasted = ""
				void adminGoto(`/admin/rulesets/${encodeURIComponent(res.rulesetId)}`, { replaceState: true })
			}),
			interest.declareInterest<"rulesets:create:error">("rulesets:create:error", (res) => {
				if (!pending) return
				pending = false
				saving = false
				const error = res.error ?? "The ruleset was not added."
				// The server's refusals are sentences; each lands on the field it names.
				if (/owner name|'core'|ruleset name|already a ruleset/i.test(error)) idError = error
				else if (/label/i.test(error)) labelError = error
				else if (/pasted|JSON/i.test(error)) pasteError = error
				else formErrors = [error]
			}),
			interest.requestWithInterest("rulesets:list", {}, (res) => {
				rulesets = res.rulesets
				templates = res.templates ?? []
				if (loading) {
					const want = adminPage.url.searchParams.get("from")
					if (want === "blank" || want === SCRATCH) from = SCRATCH
					else if (want && templates.some((t) => t.id === want)) from = want
					else if (want && res.rulesets.some((r) => r.rulesetId === want)) {
						from = COPY
						copyFrom = want
					}
					if (!copyFrom) copyFrom = res.rulesets.find((r) => r.origin === "core")?.rulesetId ?? res.rulesets[0]?.rulesetId ?? ""
					offeredOwner = pubOwner(res.rulesets)
				}
				loading = false
			})
		]
		return () => {
			for (const release of releases) release()
		}
	})

	function check(): { owner: string; name: string } | null {
		formErrors = []
		pasteError = null
		labelError = label.trim() ? null : "Give it a label: it is what people see under Rules."
		const m = RULESET_ID.exec(id.trim())
		const owner = m?.[1] ?? ""
		const name = m?.[2] ?? ""
		idError = !m
			? "An id reads owner:ruleset/name@1 — acme.lab:ruleset/hollow-hearts@1."
			: !owner
				? "Start the id with an owner slug of your own, before the colon: every ruleset you make lives under it."
				: owner === "core"
					? "“core” is Serene Pub's own name. Choose one of your own."
					: !OWNER_SLUG.test(owner)
						? "The owner slug takes lowercase letters and digits, joined by single dots or hyphens."
						: !RULESET_NAME.test(name)
							? "The name after ruleset/ takes lowercase letters and digits, joined by single hyphens."
							: null
		if (from === PASTE) {
			const parsed = parseDocumentText(pasted)
			if (!pasted.trim()) pasteError = "Paste the ruleset's JSON."
			else if (!parsed.ok) pasteError = `That is not a ruleset's JSON (${parsed.error}).`
		}
		return labelError || idError || pasteError ? null : { owner, name }
	}

	function save() {
		if (saving) return
		const ok = check()
		if (!ok) return
		saving = true
		pending = true
		const parsed = from === PASTE ? parseDocumentText(pasted) : null
		socket.emit("rulesets:create", {
			ownerSlug: ok.owner,
			name: ok.name,
			label: label.trim(),
			from: from === SCRATCH || from === PASTE ? null : from === COPY ? copyFrom || null : from,
			...(parsed?.ok ? { document: parsed.value } : {})
		})
	}

	const copyOptions = $derived(
		pickable.map((r) => ({ value: r.rulesetId, label: r.label, group: originLabel(r.origin, r.rulesetId, r.pluginName), hint: r.rulesetId }))
	)
	const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`
	/** _Decided by: Compare · Spend · 3 attributes · Bonds, Moods_. */
	const facts = (t: Sockets.Rulesets.TemplateCard) =>
		[
			t.decidedBy.length ? `Decided by: ${t.decidedBy.join(" · ")}` : "Decided in words",
			plural(t.attributes, "attribute"),
			t.entryTypes.join(", "),
			t.zoneTypes.join(", ")
		]
			.filter(Boolean)
			.join(" · ")
	const startingWith = $derived(
		from === SCRATCH
			? "from scratch"
			: from === COPY
				? `from a copy of ${fromRow?.label ?? "rules you have"}`
				: from === PASTE
					? "from a pasted document"
					: `from ${fromTemplate?.label ?? "an archetype"}`
	)
</script>

{#snippet card(value: string, title: string, about: string, footer: string, badge?: string)}
	<label
		class="border-surface-200-800 has-[:checked]:border-primary-500 has-[:checked]:bg-primary-500/10 flex cursor-pointer flex-col gap-2 rounded-base border-2 p-4"
		data-start={value}
	>
		<span class="flex items-center justify-between gap-2">
			<span class="flex items-center gap-2">
				<input type="radio" class="radio" name="ruleset-new-from" {value} bind:group={from} />
				<span class="text-base font-medium">{title}</span>
			</span>
			{#if badge}<span class="text-primary-ink border-primary-500 rounded-full border px-2 py-0.5 text-xs font-medium">{badge}</span>{/if}
		</span>
		<span class="text-sm">{about}</span>
		<span class="text-surface-600-400 text-xs">{footer}</span>
	</label>
{/snippet}

<AdminChangeForm
	mode="add"
	title="New ruleset"
	purpose="Rules of your own: start from nothing or from an archetype, make them yours, playtest them, publish them under Rules."
	noun="ruleset"
	changelistHref="/admin/rulesets"
	changelistLabel="Rulesets"
	{dirty}
	{saving}
	addAnother={false}
	canSave={!loading && (from !== COPY || !!copyFrom) && !saving}
	errors={formErrors}
	fieldErrors={{ "ruleset-new-label": labelError, "ruleset-new-id": idError, "ruleset-new-paste": pasteError }}
	onSave={save}
>
	{#snippet saveRowExtra()}
		<span class="text-surface-600-400 text-xs" data-starting>Starting <strong class="text-surface-950-50">{startingWith}</strong>. You can add anything later from the catalogue.</span>
	{/snippet}

	<AdminFieldset title="Ruleset">
		<div class="grid gap-4 @min-[36rem]/content:grid-cols-2">
			<AdminField id="ruleset-new-label" label="Label" required error={labelError} help="What people see under Rules.">
				<input
					id="ruleset-new-label"
					class="input"
					type="text"
					placeholder="Hollow Hearts"
					bind:value={label}
					aria-invalid={!!labelError}
					aria-describedby={describedBy("ruleset-new-label", !!labelError)}
				/>
			</AdminField>
			<AdminField
				id="ruleset-new-id"
				label="Id"
				required
				error={idError}
				help={offeredOwner ? "Made from your owner slug and the label. It stays." : "Your owner slug, then the name: acme.lab:ruleset/hollow-hearts@1. It stays."}
			>
				<input
					id="ruleset-new-id"
					class="input font-mono text-sm"
					type="text"
					autocomplete="off"
					spellcheck="false"
					value={id}
					oninput={(e) => (idTyped = e.currentTarget.value)}
					aria-invalid={!!idError}
					aria-describedby={describedBy("ruleset-new-id", !!idError)}
				/>
			</AdminField>
		</div>
	</AdminFieldset>

	<section class="flex flex-col gap-3" aria-labelledby="ruleset-new-kind">
		<div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
			<h2 id="ruleset-new-kind" class="text-base font-medium">What kind of game is it?</h2>
			<span class="text-surface-600-400 text-sm">A starting point you can change entirely. None of them locks you in.</span>
		</div>
		<div class="grid gap-3 @min-[44rem]/content:grid-cols-2 @min-[64rem]/content:grid-cols-3" role="radiogroup" aria-labelledby="ruleset-new-kind" data-start-from>
			{@render card(
				SCRATCH,
				"From scratch",
				"Truly empty: no outcomes, no time, no ways to decide. A session on it reads exactly like one with no rules. Add attributes with a sentence each and it's a game.",
				"Good for: any story where numbers are flavour, not law.",
				"Nothing added"
			)}
			{#each main as t (t.id)}
				{@render card(t.id, t.label, t.about, facts(t))}
			{/each}
		</div>
		{#if fromTemplate?.situation}
			<p class="text-surface-600-400 text-xs" data-template-scene>Opens with a scene ready to playtest: {fromTemplate.situation}</p>
		{/if}

		<details class="border-surface-300-700 group rounded-base border border-dashed px-4 py-2" open={moreOpen} data-more-starts>
			<summary class="flex min-h-10 cursor-pointer list-none items-center gap-1 text-sm font-medium">
				<Icons.ChevronRight size={14} class="transition-transform group-open:rotate-90" aria-hidden="true" /> More starting points
			</summary>
			<div class="mt-2 grid gap-3 @min-[44rem]/content:grid-cols-3" role="radiogroup" aria-label="More starting points">
				{#each more as t (t.id)}
					{@render card(t.id, t.label, t.about, facts(t))}
				{/each}
				{@render card(COPY, "A copy of rules you have", "Everything in them, to change as you like.", "Serene Pub's and a plugin's rules stay as written; a copy is how you change them.")}
				{@render card(PASTE, "Paste a document", "A ruleset someone shared as JSON, taken under your id.", "What it names and did not bring, it borrows.")}
			</div>
			{#if from === COPY}
				<div class="mt-3">
					<AdminField id="ruleset-new-from" label="Copy" required help={`A copy brings everything in ${fromRow?.label ?? "it"}. The attributes it owns are copied under your owner slug.`}>
						<Select
							label="Copy"
							labelHidden
							options={copyOptions}
							bind:value={copyFrom}
							placeholder={loading ? "Loading rulesets…" : "Pick a ruleset"}
							describedBy={describedBy("ruleset-new-from", false)}
						/>
					</AdminField>
				</div>
			{:else if from === PASTE}
				<div class="mt-3">
					<AdminField id="ruleset-new-paste" label="The ruleset's JSON" required error={pasteError} help="One JSON object: the ruleset as someone shared it.">
						<CodeField id="ruleset-new-paste" value={pasted} oninput={(v) => (pasted = v)} rows={10} label="The ruleset's JSON" invalid={!!pasteError} />
					</AdminField>
				</div>
			{/if}
		</details>
	</section>
</AdminChangeForm>
