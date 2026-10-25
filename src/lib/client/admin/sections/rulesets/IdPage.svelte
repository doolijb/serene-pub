<script lang="ts">
	import FieldHelp from "$lib/client/components/FieldHelp.svelte"
	/**
	 * 🚧 Admin › Rulesets › one ruleset — **the editor on the seven sections**
	 * (PLAN-rulesets-functions D2, D8; lane A4, 2026-10-23; the design canvas's
	 * five screens). A **rail** of the sections with what each holds —
	 * Attributes · Functions · Entry types · Zone types · Outcomes and time ·
	 * Library · Options — then the **Document**, and a note saying whether
	 * the draft plays as it stands; one section on screen (`?view=`). Beside
	 * every section, sticky, **What the model will read** with How strict and
	 * the prompt cost (`RulesetModelReads`); beside Functions, the
	 * **catalogue** (`RulesetCatalogue`). The header opens **Playtest** (a
	 * scene through the rules, and the **Handbook** under it) and
	 * **Publish…**.
	 *
	 * The draft is read through its sections, whichever shape it is written
	 * in, and every Save writes the sections (`rulesetSectionsForm.ts`):
	 * Save sends ONE `rulesets:saveDraft` with the whole document — the forms
	 * over the saved draft, or the Document's text when that changed (it wins,
	 * and says so before Save). A draft may be invalid; publishing may not, and
	 * it publishes what is SAVED. Every run (the preview, Try this function, a
	 * playtest) reads the unsaved draft and writes nothing.
	 *
	 * A **shipped** or **plugin** ruleset stays as written: the same views,
	 * read-only, no save row, and **Copy…** (`/admin/rulesets/new?from=<id>`).
	 * A **retired** pub ruleset reads the same way until it is unretired.
	 */
	import { getContext, onMount, tick, untrack } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { attributeKindsOfSlotType, ENTRY_FIELD_BINDING_TYPES, forkFunction, i18nText, parseRulesetId, type FunctionDecl, type Rigour } from "@serene-pub/sdk"
	import { adminGoto as goto, adminPage as page, adminRouter, adminUnsavedEdits } from "$lib/client/admin/adminRouter.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getAdminInterestContext } from "$lib/client/sockets/interest.svelte"
	import { awaitReply } from "$lib/client/utils/awaitReply"
	import { toaster } from "$lib/client/utils/toaster"
	import { UnsavedEdits } from "$lib/client/forms/unsavedEdits.svelte"
	import AdminChangeForm, { type AdminSaveIntent } from "$lib/client/components/admin/AdminChangeForm.svelte"
	import AdminPageHeader from "$lib/client/components/admin/AdminPageHeader.svelte"
	import AdminFieldset from "$lib/client/components/admin/AdminFieldset.svelte"
	import AdminField, { describedBy } from "$lib/client/components/admin/AdminField.svelte"
	import type { AdminDeletion } from "$lib/client/components/admin/changelist"
	import { rigourLabel } from "$lib/shared/rulesets/rigourLabels"
	import RulesetAttributesSection from "./RulesetAttributesSection.svelte"
	import RulesetCatalogue from "./RulesetCatalogue.svelte"
	import RulesetDocumentField from "./RulesetDocumentField.svelte"
	import RulesetEntryTypesSection from "./RulesetEntryTypesSection.svelte"
	import RulesetFindingsList from "./RulesetFindingsList.svelte"
	import RulesetFunctionsSection from "./RulesetFunctionsSection.svelte"
	import RulesetHandbook from "./RulesetHandbook.svelte"
	import RulesetLibraryField from "./RulesetLibraryField.svelte"
	import RulesetModelReads from "./RulesetModelReads.svelte"
	import RulesetOptionsSection from "./RulesetOptionsSection.svelte"
	import RulesetOutcomesTimeSection from "./RulesetOutcomesTimeSection.svelte"
	import RulesetPlaytestView from "./RulesetPlaytestView.svelte"
	import RulesetRail from "./RulesetRail.svelte"
	import RulesetRowFindings from "./RulesetRowFindings.svelte"
	import RulesetZoneTypesSection from "./RulesetZoneTypesSection.svelte"
	import {
		dataUpgradeFindings,
		documentTextChanged,
		prettyDocument,
		suggestedVersion,
		upgradeMeaning,
		versionProblem
	} from "./rulesetDocument"
	import {
		documentToSave,
		findingsByRow,
		formChangesDocument,
		libraryEntryTypes,
		libraryView,
		newFunctionRow,
		SECTIONS_COMPARE,
		sectionsFormOf,
		VOICE_MAX,
		VOICE_RIGOURS,
		type FindingsByRow,
		type FunctionRow,
		type Json,
		type SectionsForm
	} from "./rulesetSectionsForm"
	import { partyParams, sceneOf, type PlaytestScene } from "./rulesetScene"
	import { draftFindings, runTryOut } from "./rulesetRun"
	import { attributeName, nextSteps, OWNER_OPTIONS, playableNote, railCounts, SECTION_VIEWS, viewLabel, type ViewId } from "./rulesetWords"
	import { originLabel, playedBySentence, stateLabel } from "./rulesetLabels"

	type FunctionChoice = Sockets.Rulesets.DetailRow["functionChoices"][number]

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()
	// `rulesets:` is a RESTRICTED (admin-only) interest family; this context
	// exists only inside the admin tree, which already turns non-admins away.
	const interest = getAdminInterestContext()
	/**
	 * 🚧 The ruleset this page was opened for — read once (RF fix 6,
	 * 2026-10-23). Admin keeps a section on screen until the next one has
	 * loaded (`AdminView`), so the router's params may already be the next
	 * address's: read live, they handed this page the list's none, and its
	 * Save, runs and forks went to "a ruleset called ''". A page is mounted
	 * afresh for each ruleset (keyed on its address), so its id never moves.
	 */
	const rulesetId = untrack(() => decodeURIComponent(page.params.id ?? ""))

	type Detail = Sockets.Rulesets.DetailRow

	let detail = $state<Detail | null>(null)
	let missing = $state<string | null>(null)
	let loading = $state(true)

	const isPub = $derived(detail?.origin === "pub")
	/** A pub ruleset that is not retired: the only kind the server lets a draft be saved for. */
	const editable = $derived(isPub && detail?.state !== "retired")
	const readonly = $derived(!editable)

	/* ── the unsaved edits ──────────────────────────────────────────── */

	/** The saved draft (a pub ruleset's) or the declaration as written (a shipped one's). */
	let savedDoc = $state.raw<Json | null>(null)
	let form = $state<SectionsForm>(sectionsFormOf(null, ""))
	const edits = new UnsavedEdits(() => form, SECTIONS_COMPARE)
	let documentText = $state("")
	const documentChanged = $derived(editable && documentTextChanged(documentText, savedDoc))
	/** The saved draft as the forms read it: built once per saved draft, not per keystroke. */
	const savedForm = $derived(sectionsFormOf(savedDoc, ""))
	const formsChanged = $derived(editable && formChangesDocument(form, savedForm))
	const dirty = $derived(editable && (edits.dirty || documentChanged))
	// 🚧 RF fix 2, item 5: leaving with unsaved edits asks Save · Discard · Stay; Save here saves and stays put.
	adminUnsavedEdits(() => dirty, () => save("continue"))

	/**
	 * 🚧 The saved draft's findings on the rows they are about (RF fix 2,
	 * items 1 and 8): mapped when the form is read from that draft, so a row
	 * still being typed is never judged, and nothing is said as a wall above
	 * the form. A draft always saves; only Publish waits for them.
	 */
	let rowFindings = $state.raw<FindingsByRow>({ rows: {}, sections: {}, rest: [] })
	const mapFindings = (f: SectionsForm, findings: readonly string[] | undefined) => (rowFindings = findingsByRow(f, findings ?? [], rulesetId))
	/**
	 * 🚧 The draft's findings as it stands, judged again after something is
	 * removed (RF fix 6): a removal can settle a finding (the row is gone) or
	 * raise one (what named it), and neither waits for a Save. Null while the
	 * saved draft's findings stand.
	 */
	let liveFindings = $state.raw<string[] | null>(null)

	const docOf = (d: Detail): Json | null => (d.draft ?? d.published ?? null) as unknown as Json | null
	/** 🚧 A refusal is this page's when it names this ruleset, or none (RF fix 6): another tab's never fails this one's Save. */
	const ownRefusal = (d: unknown): boolean => {
		const id = (d as { rulesetId?: unknown } | null)?.rulesetId
		return id === undefined || id === rulesetId
	}

	/**
	 * `rulesets:detail` is not scoped, and every write re-sends it to every
	 * open page: a detail for another ruleset is not this page's. Each push
	 * moves the saved draft; a clean form and an untouched Document follow
	 * it, an edited one keeps the person's edits (`adoptSaved`).
	 */
	const onDetail = (res: Sockets.Rulesets.Detail.Response) => {
		if (res.ruleset && res.ruleset.rulesetId !== untrack(() => rulesetId)) return
		loading = false
		if (!res.ruleset) {
			if (!untrack(() => detail)) missing = res.error ?? "There is no such ruleset."
			return
		}
		const next = res.ruleset
		const doc = docOf(next)
		untrack(() => {
			const textChanged = documentChanged
			detail = next
			savedDoc = doc
			if (!textChanged) documentText = prettyDocument(doc)
			edits.adoptSaved(sectionsFormOf(doc, next.label), (f) => {
				form = f
				liveFindings = null
				recheckSeq++
				mapFindings(f, next.findings)
			})
		})
	}

	onMount(() => {
		if (!userCtx.user?.isAdmin) goto("/")
	})

	/** This ruleset's detail, asked for and listened for in one; its refusal on the same handler. */
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const releases = [
			interest.declareInterest<"rulesets:detail:error">("rulesets:detail:error", onDetail),
			interest.requestWithInterest("rulesets:detail", { rulesetId: untrack(() => rulesetId) }, onDetail)
		]
		return () => {
			for (const release of releases) release()
		}
	})

	/* ── the draft as it stands, for every run ──────────────────────── */

	/** What a Save would send (the forms over the saved draft, or the Document's text); the saved draft when nothing changed. */
	function currentDoc(): Json | null {
		if (!savedDoc) return null
		if (!editable || !dirty) return savedDoc
		const plan = documentToSave({
			saved: savedDoc,
			form: $state.snapshot(form) as SectionsForm,
			formsChanged,
			documentText,
			documentChanged
		})
		return plan.ok ? ({ ...plan.document, id: rulesetId } as Json) : savedDoc
	}
	/** The same, a moment after the typing stops (a copied library can hold hundreds of rows). */
	let typedDoc = $state.raw<Json | null>(null)
	$effect(() => {
		const changed = editable && dirty
		if (changed) void JSON.stringify($state.snapshot(form)), documentText, savedDoc
		if (!changed) {
			typedDoc = null
			return
		}
		const timer = setTimeout(() => (typedDoc = untrack(currentDoc)), 250)
		return () => clearTimeout(timer)
	})
	const liveDoc = $derived<Json | null>(editable && dirty ? (typedDoc ?? savedDoc) : savedDoc)
	/** What the preview sends as `document`: the unsaved draft, only when there is one. */
	const runDoc = $derived(editable && dirty ? liveDoc : null)
	/** What a run sends as `document`, worked out as it is sent. */
	const docToRun = (): Json | null => (editable && dirty ? currentDoc() : null)

	/* ── 🚧 judged again after a removal (RF fix 6) ─────────────────── */

	let recheckSeq = 0
	let recheckTimer: ReturnType<typeof setTimeout> | null = null
	/** Judge the draft as it stands: its findings laid on the rows, and counted in the rail's note. */
	async function recheck() {
		recheckTimer = null
		const doc = currentDoc()
		if (!doc || !editable) return
		const mine = ++recheckSeq
		const found = await draftFindings(socket, { rulesetId, document: doc as Record<string, unknown> })
		if (mine !== recheckSeq || found === null) return
		liveFindings = found
		mapFindings(form, found)
	}
	const recheckSoon = () => {
		if (recheckTimer) clearTimeout(recheckTimer)
		recheckTimer = setTimeout(() => void recheck(), 300)
	}
	$effect(() => () => {
		if (recheckTimer) clearTimeout(recheckTimer)
	})
	/** The rows on the form: a row gone from the same form is a removal (a form read afresh is not). */
	let seenForm: SectionsForm | null = null
	let seenRows = new Set<string>()
	$effect(() => {
		const f = form
		const now = new Set([...f.attributes, ...f.functions, ...f.entryTypes, ...f.zoneTypes, ...f.outcomes].map((r) => r.uid))
		untrack(() => {
			const removed = seenForm === f && [...seenRows].some((u) => !now.has(u))
			seenForm = f
			seenRows = now
			if (!removed) return
			recheckSoon()
			// A scene's change that names a function the form does not list is reset to nothing.
			if (scene.change.kind === "function" && !f.functions.some((x) => x.key === scene.change.key)) scene.change = { ...scene.change, kind: "none", key: "" }
		})
	})

	/* ── which view ─────────────────────────────────────────────────── */

	const VIEW_IDS: readonly ViewId[] = [...SECTION_VIEWS.map((s) => s.id), "document", "playtest", "publish"]
	const asView = (v: string | null | undefined): ViewId | null => (v && (VIEW_IDS as readonly string[]).includes(v) ? (v as ViewId) : null)
	let view = $state<ViewId>(asView(page.url.searchParams.get("view")) ?? "attributes")
	const isSection = $derived(SECTION_VIEWS.some((s) => s.id === view))

	/** Show one view, keep its address, and bring it into view. */
	async function goToView(id: ViewId, focusId?: string) {
		view = id
		const q = new URLSearchParams(page.url.search)
		q.set("view", id)
		adminRouter.setQuery?.(`?${q}`)
		await tick()
		const el = (focusId && document.getElementById(focusId)) || document.getElementById("ruleset-view")
		el?.scrollIntoView?.({ behavior: "smooth", block: "start" })
		if (focusId) (el as HTMLElement | null)?.focus?.({ preventScroll: true })
	}

	/* ── the scene: the preview's party and the playtest's ──────────── */

	let scene = $state<PlaytestScene>({ party: [], situation: "", change: { kind: "none", owner: "", key: "", attribute: "", op: "add", value: "", entryType: "", row: "", aimedAt: "" }, rigour: "mechanics", seed: "" })
	/** The scene is made once per ruleset, when its detail first arrives. */
	let sceneFor = ""
	$effect(() => {
		const d = detail
		if (!d || sceneFor === d.rulesetId) return
		sceneFor = d.rulesetId
		untrack(() => (scene = sceneOf(d.rulesetId, sectionsFormOf(docOf(d), d.label), d.playtest ?? null)))
	})
	let previewRigour = $state<Rigour>("mechanics")
	/** The preview reads the scene's first member: a sample character. */
	const previewParty = $derived(partyParams(rulesetId, form, scene.party.slice(0, 1)))

	/* ── what the sections read ─────────────────────────────────────── */

	const choices = $derived<readonly FunctionChoice[]>(detail?.functionChoices ?? [])
	const slotChoices = $derived(detail?.slotChoices ?? [])
	/** The scope functions a visibility or a binding may name: the catalogue's and this ruleset's own. */
	const scopes = $derived([
		...choices.filter((c) => c.kind === "scope").map((c) => ({ value: c.id, label: c.name })),
		...form.functions
			.filter((f) => f.module && (f.module as { kind?: unknown }).kind === "scope")
			.map((f) => ({ value: f.ref, label: i18nText((f.module as { name?: never }).name) ?? f.key }))
	])
	const targets = $derived({
		// 🚧 Each says the kinds it may be read as (RF fix 6): its own, or its slot's.
		attribute: form.attributes
			.filter((a) => a.id)
			.map((a) => ({
				value: a.id,
				label: attributeName(a, slotChoices),
				kinds: a.kind ? [a.kind] : attributeKindsOfSlotType(slotChoices.find((c) => c.id === a.slot)?.type)
			})),
		"entry-type": form.entryTypes.filter((e) => e.id).map((e) => ({ value: e.id, label: e.name || e.id })),
		// 🚧 RF fix 2, item 4: the author's own zone types only — the host's carried list is no type of theirs.
		"zone-type": form.zoneTypes.filter((z) => z.id).map((z) => ({ value: z.id, label: z.name || z.id })),
		scope: scopes,
		owner: OWNER_OPTIONS.map((o) => ({ ...o })),
		// 🚧 An entry's field, for a role that takes one (`entryFields` — rungs over a tie's affection, lane T3), with its type (RF fix 6).
		"entry-field": form.entryTypes
			.filter((e) => e.id)
			.flatMap((e) =>
				e.fields
					.filter((f) => f.key && (ENTRY_FIELD_BINDING_TYPES as readonly string[]).includes(f.type))
					.map((f) => ({ value: `${e.id}.${f.key}`, label: `${f.label || f.key} on a ${(e.name || e.id).toLowerCase()}`, type: f.type }))
			)
	})
	const nameOf = (id: string): string =>
		targets.attribute.find((x) => x.value === id)?.label ??
		targets["entry-type"].find((x) => x.value === id)?.label ??
		targets["zone-type"].find((x) => x.value === id)?.label ??
		scopes.find((x) => x.value === id)?.label ??
		targets["entry-field"].find((x) => x.value === id)?.label ??
		OWNER_OPTIONS.find((x) => x.value === id)?.label.toLowerCase() ??
		id
	const counts = $derived(railCounts(form))
	const note = $derived(playableNote(form, slotChoices, editable ? (liveFindings ?? detail?.findings ?? []).length : 0))
	const next = $derived(nextSteps(form))
	const used = $derived(new Set(form.functions.map((f) => f.ref)))

	/** A catalogue function added to the ruleset: a reference, or — one another ruleset carries — a fork of it. */
	async function addFunction(choice: FunctionChoice) {
		if (!editable) return
		let row: FunctionRow
		if (choice.from === "ruleset") {
			const copy = forkFunction(choice.decl as FunctionDecl, rulesetId)
			row = newFunctionRow(form, copy.id, choice.name, copy as never, JSON.parse(JSON.stringify(copy)))
		} else row = newFunctionRow(form, choice.id, choice.name, choice.decl as never)
		form.functions = [...form.functions, row]
		if (view !== "functions") await goToView("functions")
		await tick()
		document.querySelector(`[data-function="${CSS.escape(row.key)}"]`)?.scrollIntoView?.({ behavior: "smooth", block: "center" })
	}

	function tryFunction(row: FunctionRow) {
		const doc = docToRun()
		return runTryOut(socket, {
			rulesetId,
			rigour: previewRigour,
			party: partyParams(rulesetId, form, scene.party),
			fn: row.key,
			...(doc ? { document: doc } : {})
		})
	}

	/* ── save: one saveDraft with the whole document ────────────────── */

	let saving = $state(false)
	let formErrors = $state<string[]>([])
	let labelError = $state<string | null>(null)

	function land(intent: AdminSaveIntent) {
		if (intent === "save") void goto("/admin/rulesets")
	}

	async function save(intent: AdminSaveIntent): Promise<boolean> {
		if (!detail || !editable || saving) return false
		formErrors = []
		labelError = null
		if (!dirty) {
			land(intent)
			return true
		}
		const label = form.label.trim()
		if (!label) {
			labelError = "Give it a label: it is what Admin lists it as."
			return false
		}
		// 🚧 A draft always saves (RF fix 2, item 8): whatever it still lacks
		// is the server's to name, on the rows, and only Publish waits for it.
		// The Document's text, when it changed, is saved whatever the forms hold.
		const plan = documentToSave({
			saved: savedDoc ?? {},
			form: $state.snapshot(form) as SectionsForm,
			formsChanged,
			documentText,
			documentChanged
		})
		if (!plan.ok) {
			formErrors = [plan.error]
			return false
		}
		// The server keeps the row's own id whatever the text says.
		const doc = { ...plan.document, id: rulesetId }
		saving = true
		let res: Sockets.Rulesets.SaveDraft.Response
		try {
			res = await awaitReply({
				socket,
				event: "rulesets:saveDraft",
				errorEvent: "rulesets:saveDraft:error",
				matchError: ownRefusal,
				params: { rulesetId, draft: doc, label },
				match: (r) => r.rulesetId === rulesetId
			})
		} catch (e) {
			saving = false
			formErrors = [e instanceof Error ? e.message : String(e)]
			return false
		}
		saving = false
		// What was sent is the saved draft now: the forms and the Document start again from it.
		savedDoc = doc
		documentText = prettyDocument(doc)
		form = sectionsFormOf(doc, label)
		edits.markSaved()
		liveFindings = null
		recheckSeq++
		if (detail && res.findings) detail = { ...detail, findings: res.findings, label }
		mapFindings(form, res.findings ?? detail?.findings)
		toaster.success({ title: plan.documentWon ? `Saved ${label} from the Document` : `Saved ${label}` })
		land(intent)
		return true
	}

	/* ── the Document's Check ───────────────────────────────────────── */

	let checked = $state(false)
	let checking = $state(false)
	async function check() {
		if (dirty) {
			checking = true
			const ok = await save("continue")
			checking = false
			if (!ok) return
		}
		checked = true
	}

	/* ── publish ────────────────────────────────────────────────────── */

	let versionTyped = $state<string | null>(null)
	let acknowledged = $state(false)
	let publishing = $state(false)
	let publishError = $state<string | null>(null)
	const publishedVersion = $derived(detail?.version ?? null)
	const publishVersion = $derived(versionTyped ?? suggestedVersion(typeof savedDoc?.version === "string" ? savedDoc.version : null, publishedVersion))
	const versionIssue = $derived(versionProblem(publishVersion, publishedVersion))
	const findings = $derived(detail?.findings ?? [])
	const upgrade = $derived(dataUpgradeFindings(detail?.upgradeFindings ?? []))
	const nothingToPublish = $derived(detail?.state === "published" && !detail.draftChanged)
	/** Why Publish is not offered, in one line; null when it is. */
	const publishBlocked = $derived(
		dirty
			? "Save your changes first: Publish puts the saved draft live."
			: findings.length
				? "Fix the problems above first."
				: nothingToPublish
					? "The draft is what is published. Change something to publish a new version."
					: versionIssue
						? versionIssue
						: upgrade.length && !acknowledged
							? "Tick the box above to publish."
							: null
	)

	async function publish() {
		if (!detail || publishBlocked || publishing) return
		publishError = null
		publishing = true
		const params: Sockets.Rulesets.Publish.Params = { rulesetId, version: publishVersion.trim() }
		if (upgrade.length && acknowledged) params.acknowledgeUpgrade = true
		try {
			const res = await awaitReply({
				socket,
				event: "rulesets:publish",
				errorEvent: "rulesets:publish:error",
				matchError: ownRefusal,
				params,
				match: (r) => r.rulesetId === rulesetId
			})
			versionTyped = null
			acknowledged = false
			toaster.success({ title: `Published ${detail.label} ${res.version ?? ""}`.trim() })
		} catch (e) {
			publishError = e instanceof Error ? e.message : String(e)
		} finally {
			publishing = false
		}
	}

	/* ── retire, unretire, delete ───────────────────────────────────── */

	let retiring = $state(false)
	async function setRetired(retired: boolean) {
		if (!detail || retiring) return
		formErrors = []
		retiring = true
		try {
			await awaitReply({
				socket,
				event: "rulesets:retire",
				errorEvent: "rulesets:retire:error",
				matchError: ownRefusal,
				params: { rulesetId, retired },
				match: (r) => r.rulesetId === rulesetId
			})
			toaster.success({ title: retired ? `Retired ${detail.label}` : `${detail.label} can be picked again` })
		} catch (e) {
			formErrors = [e instanceof Error ? e.message : String(e)]
		} finally {
			retiring = false
		}
	}

	function deletion(): AdminDeletion {
		const d = detail!
		const played = d.playedBy.sessions + d.playedBy.lorebooks > 0
		return played
			? {
					title: `Delete ${d.label}?`,
					summary: `${playedBySentence(d.playedBy)} It stays while they play it. Retire it instead: they keep playing it, and nobody new can pick it.`,
					objects: [],
					confirmLabel: "Delete ruleset"
				}
			: {
					title: `Delete ${d.label}?`,
					summary: "It leaves Admin and Rules for good. The attributes it made stay, as attributes of their own.",
					objects: [{ label: d.label }],
					confirmLabel: "Delete ruleset"
				}
	}

	async function remove() {
		if (!detail) return
		formErrors = []
		const label = detail.label
		try {
			await awaitReply({
				socket,
				event: "rulesets:delete",
				errorEvent: "rulesets:delete:error",
				matchError: ownRefusal,
				params: { rulesetId },
				match: (r) => r.rulesetId === rulesetId
			})
		} catch (e) {
			formErrors = [e instanceof Error ? e.message : String(e)]
			return
		}
		edits.forget()
		documentText = prettyDocument(savedDoc)
		toaster.success({ title: `Deleted ${label}` })
		void goto("/admin/rulesets", { replaceState: true })
	}

	/* ── what the page shows ────────────────────────────────────────── */

	const copyHref = $derived(`/admin/rulesets/new?from=${encodeURIComponent(rulesetId)}`)
	const title = $derived(detail ? (isPub ? detail.label : detail.name) : "Ruleset")
	const ownerWords = $derived(detail ? originLabel(detail.origin, rulesetId, detail.pluginName) : "")
	const basedOn = $derived(detail?.basedOn ? { name: detail.basedOnName ?? null, id: detail.basedOn } : null)
	const libraryName = $derived(form.name.trim() || detail?.name || "")
	const owner = $derived(parseRulesetId(rulesetId)?.owner ?? "")
	const voiceHelp = (r: string) =>
		r === "prose"
			? "What the model reads about how play runs, at every level of How strict. Optional: from scratch, there is none."
			: `Read instead of the ${rigourLabel("prose")} voice when a session plays at ${rigourLabel(r)}. Left empty, that one is read.`
</script>

<svelte:head>
	<title>{title} · Admin · Serene Pub</title>
</svelte:head>

{#snippet headerChips()}
	{#if detail}
		<div class="flex flex-wrap items-center gap-1.5 text-xs">
			<span class="preset-tonal-surface rounded-full px-2 py-0.5" data-ruleset-state={detail.state}>
				{stateLabel(detail.state, detail.draftChanged)}
			</span>
			<span class="text-surface-600-400">
				{detail.version ? `Version ${detail.version}` : isPub ? "Not published yet" : ""}
			</span>
			<span class="text-surface-600-400 font-mono break-all">{rulesetId}</span>
		</div>
		<FieldHelp>
			{#if !isPub}
				{ownerWords}'s rulesets stay as written. Copy this one to change it.
			{:else if detail.state === "retired"}
				Retired: what plays it keeps it, and nobody new can pick it. Unretire it to edit it.
			{:else if basedOn?.name}
				Made on this pub, copied from {basedOn.name}
				(<span class="font-mono text-xs break-all">{basedOn.id}</span>).
			{:else if basedOn}
				Made on this pub, copied from <span class="font-mono text-xs break-all">{basedOn.id}</span>, which is no longer installed.
			{:else}
				Made on this pub{owner ? ` under ${owner}` : ""}.
			{/if}
			{playedBySentence(detail.playedBy)}
		</FieldHelp>
	{/if}
{/snippet}

{#snippet viewActions()}
	<button type="button" class="btn btn-sm preset-tonal-surface" aria-current={view === "playtest" ? "page" : undefined} onclick={() => goToView("playtest")} data-open-playtest>
		<Icons.Play size={14} aria-hidden="true" /> Playtest
	</button>
	<button type="button" class="btn btn-sm preset-tonal-surface" onclick={() => goToView("playtest", "handbook")} data-open-handbook>
		<Icons.BookOpen size={14} aria-hidden="true" /> Handbook
	</button>
{/snippet}

{#snippet copyLink()}
	<a class="btn btn-sm preset-tonal-surface" href={copyHref}>
		<Icons.Copy size={14} aria-hidden="true" /> Copy…
	</a>
{/snippet}

{#snippet aboutFieldset(ro: boolean)}
	<AdminFieldset
		id="name-and-voice"
		title="Name and voice"
		description="What people see under Rules, and — if you want one — a short voice the model reads about how play runs at each level of How strict. A voice is at most {VOICE_MAX} characters (about 60 tokens): it rides in every prompt at its level."
	>
		{#if ro}
			<div class="grid gap-4 @min-[36rem]/content:grid-cols-2">
				<AdminField id="ruleset-name" label="Name" value={form.name} />
				<AdminField id="ruleset-description" label="Description" value={form.description} />
				{#each VOICE_RIGOURS as r (r)}
					{#if form.voice[r]}<AdminField id="ruleset-voice-{r}" label="Voice at {rigourLabel(r)}" value={form.voice[r]} class="@min-[36rem]/content:col-span-2" />{/if}
				{/each}
			</div>
		{:else}
			<div class="grid gap-4 @min-[36rem]/content:grid-cols-2">
				<AdminField id="ruleset-name" label="Name" required help="What people see under Rules.">
					<input id="ruleset-name" class="input" type="text" bind:value={form.name} aria-describedby={describedBy("ruleset-name", false)} />
				</AdminField>
				<AdminField id="ruleset-description" label="Description" help="One line under its name where people pick it.">
					<input id="ruleset-description" class="input" type="text" bind:value={form.description} aria-describedby={describedBy("ruleset-description", false)} />
				</AdminField>
				{#each VOICE_RIGOURS as r (r)}
					{@const length = form.voice[r].length}
					<AdminField id="ruleset-voice-{r}" label="Voice at {rigourLabel(r)}" help={voiceHelp(r)} class="@min-[36rem]/content:col-span-2">
						<textarea
							id="ruleset-voice-{r}"
							class="textarea"
							rows={2}
							bind:value={form.voice[r]}
							aria-invalid={length > VOICE_MAX}
							aria-describedby="{describedBy(`ruleset-voice-${r}`, false)} ruleset-voice-{r}-count"
						></textarea>
						<p id="ruleset-voice-{r}-count" class="self-end text-xs tabular-nums {length > VOICE_MAX ? 'text-error-600-400' : 'text-surface-600-400'}">
							{length} / {VOICE_MAX}{length > VOICE_MAX ? ": shorten it" : ""}
						</p>
					</AdminField>
				{/each}
			</div>
		{/if}
	</AdminFieldset>
{/snippet}

{#snippet publishView()}
	{#if editable}
		<AdminFieldset id="publish" title="Check and publish" description="Publishing puts the saved draft under Rules, for new lorebooks and sessions, as the version below.">
			<div class="flex flex-col gap-2">
				<h3 class="text-sm font-medium">Problems</h3>
				<RulesetFindingsList {findings} id="ruleset-findings" />
			</div>
			{#if upgrade.length}
				<div class="flex flex-col gap-2" data-upgrade>
					<h3 class="text-sm font-medium">What changes for stored data</h3>
					<p class="text-surface-600-400 text-xs">Publishing this draft over version {publishedVersion} changes how data stored under it reads:</p>
					<RulesetFindingsList findings={upgrade} tone="warning" meaning={upgradeMeaning} />
					<label class="flex min-h-10 items-center gap-2 text-sm">
						<input type="checkbox" class="checkbox" bind:checked={acknowledged} />
						I understand what changes for stored data
					</label>
				</div>
			{/if}
			<div class="max-w-xs">
				<AdminField
					id="ruleset-publish-version"
					label="Publish as version"
					error={dirty ? null : versionIssue}
					help={publishedVersion ? `Version ${publishedVersion} is published. Three numbers with dots; each publish moves it forward.` : "Three numbers with dots."}
				>
					<input
						id="ruleset-publish-version"
						class="input font-mono"
						type="text"
						value={publishVersion}
						oninput={(e) => (versionTyped = e.currentTarget.value)}
						aria-invalid={!dirty && !!versionIssue}
						aria-describedby={describedBy("ruleset-publish-version", !dirty && !!versionIssue)}
					/>
				</AdminField>
			</div>
			<div class="flex flex-wrap items-center gap-3">
				<button type="button" class="btn btn-sm preset-tonal-primary" disabled={!!publishBlocked || publishing} aria-describedby={publishBlocked ? "ruleset-publish-blocked" : undefined} onclick={publish} data-publish>
					{#if publishing}
						<Icons.LoaderCircle size={14} class="animate-spin" aria-hidden="true" /> Publishing…
					{:else}
						<Icons.Send size={14} aria-hidden="true" /> Publish
					{/if}
				</button>
				{#if publishBlocked}<p id="ruleset-publish-blocked" class="text-surface-600-400 text-xs">{publishBlocked}</p>{/if}
			</div>
			{#if publishError}<p class="text-error-600-400 text-sm whitespace-pre-line" role="alert">{publishError}</p>{/if}
		</AdminFieldset>
	{:else}
		<AdminFieldset id="publish" title="Check and publish">
			<p class="text-surface-600-400 text-sm">
				{isPub ? "Retired: unretire it to publish again." : "It is offered under Rules as written. Copy it to make a version of your own."}
			</p>
		</AdminFieldset>
	{/if}
{/snippet}

{#snippet viewBody(ro: boolean)}
	{#if view === "attributes"}
		<RulesetAttributesSection bind:form {slotChoices} {scopes} findings={rowFindings} readonly={ro} onOpenFunctions={() => goToView("functions")} />
	{:else if view === "functions"}
		<RulesetFunctionsSection
			bind:form
			{choices}
			{rulesetId}
			{targets}
			{nameOf}
			findings={rowFindings}
			readonly={ro}
			onTry={tryFunction}
			onFindMore={() => {
				document.querySelector<HTMLElement>("[data-catalogue-search]")?.focus()
				document.querySelector("[data-catalogue]")?.scrollIntoView?.({ behavior: "smooth", block: "start" })
			}}
		/>
	{:else if view === "entryTypes"}
		<RulesetEntryTypesSection bind:form {scopes} findings={rowFindings} readonly={ro} onOpenFunctions={() => goToView("functions")} onOpenLibrary={() => goToView("library")} />
	{:else if view === "zoneTypes"}
		<RulesetZoneTypesSection bind:form {scopes} {choices} {slotChoices} findings={rowFindings} member={scene.party[0] ?? null} readonly={ro} />
	{:else if view === "outcomes"}
		<RulesetOutcomesTimeSection bind:form findings={rowFindings} readonly={ro} />
	{:else if view === "library"}
		{#if rowFindings.sections.library?.length}
			<RulesetRowFindings findings={rowFindings.sections.library} label="The library" />
		{/if}
		<RulesetLibraryField
			bind:library={form.library}
			savedDoc={libraryView(savedDoc)}
			entryTypes={libraryEntryTypes(rulesetId, savedDoc)}
			repertoires={form.entryTypes.map((e) => ({ id: e.id, label: e.name || e.id, entryable: (e.original as { entryable?: unknown } | null)?.entryable !== false, original: e.original ? { id: e.original.id } : null }))}
			name={libraryName}
			readonly={ro}
		/>
	{:else if view === "options"}
		{#if rowFindings.sections.options?.length}
			<RulesetRowFindings findings={rowFindings.sections.options} label="Options" />
		{/if}
		<RulesetOptionsSection bind:form readonly={ro} onOpenDocument={() => goToView("document")} />
	{:else if view === "playtest"}
		<RulesetPlaytestView {rulesetId} bind:form bind:scene getDocument={docToRun} {slotChoices} {choices} readonly={ro} />
		<RulesetHandbook bind:form {slotChoices} {choices} readonly={ro} />
	{:else if view === "publish"}
		{@render publishView()}
	{:else if view === "document"}
		{@render aboutFieldset(ro)}
		<AdminFieldset
			id="document"
			title="Document"
			description={ro
				? "The whole ruleset as JSON, as it is written."
				: "The whole draft as JSON: what every section edits, and anything they do not. A change here is saved as written, over the sections' unsaved changes."}
		>
			<RulesetDocumentField
				value={documentText}
				oninput={(v) => (documentText = v)}
				readonly={ro}
				changed={documentChanged}
				conflict={documentChanged && formsChanged}
				{findings}
				{checked}
				{checking}
				onCheck={check}
				onRevert={() => (documentText = prettyDocument(savedDoc))}
			/>
		</AdminFieldset>
	{/if}
{/snippet}

{#snippet editor(ro: boolean)}
	<div class="@container/editor min-w-0">
		<div class="grid min-w-0 items-start gap-4 @min-[50rem]/editor:grid-cols-[12rem_minmax(0,1fr)] {isSection ? '@min-[66rem]/editor:grid-cols-[12rem_minmax(0,1fr)_18rem]' : ''}">
			<div class="min-w-0 @min-[50rem]/editor:sticky @min-[50rem]/editor:top-3">
				<RulesetRail current={view} {counts} {note} onPick={(id) => goToView(id)} onProblems={() => goToView("publish")} />
			</div>
			<div id="ruleset-view" tabindex="-1" class="flex min-w-0 flex-col gap-3 outline-none" data-view={view} aria-label={viewLabel(view)}>
				{@render viewBody(ro)}
			</div>
			{#if isSection}
				<div class="min-w-0 @min-[50rem]/editor:col-start-2 @min-[66rem]/editor:col-start-3 @min-[66rem]/editor:sticky @min-[66rem]/editor:top-3">
					{#if view === "functions"}
						<RulesetCatalogue {choices} {used} readonly={ro} onAdd={addFunction} />
					{:else}
						<RulesetModelReads
							{rulesetId}
							document={runDoc}
							party={previewParty}
							rigour={previewRigour}
							onRigour={(r) => (previewRigour = r)}
							next={ro ? [] : next}
							onGo={(v) => goToView(v)}
						/>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/snippet}

{#if loading}
	<div class="text-surface-600-400 flex items-center justify-center gap-2 py-16 text-sm" role="status">
		<Icons.LoaderCircle size={16} class="animate-spin" aria-hidden="true" />
		Loading ruleset…
	</div>
{:else if !detail}
	<div class="m-auto flex flex-col items-center gap-3 py-16 text-center">
		<p class="text-surface-600-400 text-sm">{missing ?? "This ruleset no longer exists."}</p>
		<a href="/admin/rulesets" class="btn btn-sm preset-tonal-surface">All rulesets</a>
	</div>
{:else if !isPub}
	<!-- Shipped or a plugin's: read-only, no save row (STYLE-GUIDE §6.11). -->
	<AdminPageHeader {title} purpose={detail.description || undefined}>
		{#snippet actions()}
			{@render viewActions()}
			{@render copyLink()}
		{/snippet}
		{@render headerChips()}
	</AdminPageHeader>
	{@render editor(true)}
{:else}
	<AdminChangeForm
		mode="change"
		{title}
		purpose={detail.description || undefined}
		noun="ruleset"
		changelistHref="/admin/rulesets"
		changelistLabel="Rulesets"
		{dirty}
		{saving}
		canSave={editable && dirty && !saving}
		addAnother={false}
		errors={formErrors}
		fieldErrors={{ "ruleset-label": labelError }}
		{deletion}
		onDelete={remove}
		onSave={save}
	>
		{#snippet headerActions()}
			{@render viewActions()}
			{#if editable}
				<button type="button" class="btn btn-sm preset-tonal-primary" onclick={() => goToView("publish")} data-open-publish>
					<Icons.Send size={14} aria-hidden="true" /> Publish…
				</button>
				<button type="button" class="btn btn-sm preset-tonal-surface" disabled={retiring || dirty} title={dirty ? "Save or discard your changes first." : undefined} onclick={() => setRetired(true)}>
					<Icons.Archive size={14} aria-hidden="true" /> Retire
				</button>
			{:else}
				<button type="button" class="btn btn-sm preset-tonal-surface" disabled={retiring} onclick={() => setRetired(false)}>
					<Icons.ArchiveRestore size={14} aria-hidden="true" /> Unretire
				</button>
			{/if}
			{@render copyLink()}
		{/snippet}
		{#snippet headerExtra()}
			{@render headerChips()}
			{#if editable}
				<div class="max-w-sm">
					<AdminField id="ruleset-label" label="Label" required error={labelError} help="What Admin lists it as.">
						<input
							id="ruleset-label"
							class="input"
							type="text"
							bind:value={form.label}
							aria-invalid={!!labelError}
							aria-describedby={describedBy("ruleset-label", !!labelError)}
						/>
					</AdminField>
				</div>
			{/if}
		{/snippet}

		{@render editor(readonly)}
	</AdminChangeForm>
{/if}
