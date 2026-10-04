<script lang="ts">
	/**
	 * One pipeline's configuration, rendered from declarations — the body of
	 * the pipeline view (05 §0a), extracted so any surface can host it: the
	 * Pipelines sidebar, and the graph builder page's step controls.
	 *
	 * Everything here arrives from the server as declarations — label,
	 * control, range, options, current value, which layer it came from — and
	 * this file renders whatever arrives, in the server's **settings groups**
	 * (owner rulings 2026-09-30): one tonal block per model call — its switch
	 * in the header, its purpose line, its Prompt, Model and Sampling, then one
	 * Advanced fold with a fieldset per step — and *Whole pipeline* last. The
	 * grouping is derived from the graph on the server; this file never
	 * derives it. A non-admin receives only what is theirs to touch (prompts)
	 * and the model by name, so the same render serves both audiences.
	 *
	 * Writes carry no scope (the layer simplification, 2026-08-24): inside a
	 * session they land at the session's override, and globally they land in the
	 * selected configuration itself — the server resolves which, and refuses
	 * a shipped configuration with the duplicate suggestion.
	 *
	 * Socket events are shared channels, so every listener filters by slug
	 * AND scope: two of these panels — different pipelines, or one pipeline at
	 * a session's scope and at its configuration's — must not clobber each
	 * other's responses.
	 */
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { getContext, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import ShareBar from "$lib/client/components/pipelines/ShareBar.svelte"
	import StrengthBars from "$lib/client/components/pipelines/StrengthBars.svelte"
	// The ONE spelling of what a connection slot stores, shared with the three
	// server readers — see `$lib/shared/connections/slotRef`.
	import {
		connectionSlotValue,
		slotConnectionId,
		slotModelId
	} from "$lib/shared/connections/slotRef"
	import { languageOf } from "$lib/shared/pipelines/templateEngines"
	import TemplateEditor from "$lib/client/components/templates/TemplateEditor.svelte"
	import type { ScopeDeclarer } from "$lib/shared/utils/templateAssist"
	// The value-decl controls (24 T6c): the simple editors live in
	// @serene-pub/controls now — one component per value-type id, the render
	// leg of the four-way registry. This panel keeps the behavioural wiring
	// (drafts, set/clear, write scopes); the components are presentational.
	import {
		BooleanControl,
		NumberControl,
		SelectControl,
		TextControl
	} from "@serene-pub/controls"
	import {
		advancedSummary,
		builderStepsOf,
		drawnGroups,
		optionsOf,
		rowLabelOf,
		type PanelMode
	} from "$lib/client/components/pipelines/settingsGroups"
	import { SvelteSet } from "svelte/reactivity"
	import DocPeek from "$lib/client/components/docs/DocPeek.svelte"
	import { docsHref } from "$lib/shared/utils/docsHref"

	interface Props {
		slug: string
		/** Set when hosted inside a session — writes land at session scope. */
		sessionId?: number
		/**
		 * Which surface this is (see `PanelMode`): the Pipelines view and the
		 * graph panel (`config`, the default), a session's settings
		 * (`session`), or the admin builder (`builder`).
		 */
		mode?: PanelMode
		/** A session card's title — the pipeline's or the action's name. */
		title?: string
		/** A session card that starts closed, with its model in the summary. */
		collapsed?: boolean
		/**
		 * Opened from inside a session that does not run this pipeline (owner
		 * Q7): the view is the configuration's, and the scope note says so.
		 */
		sessionDoesNotRun?: boolean
		/** Called whenever a fresh view arrives, e.g. to title a header. */
		onLoaded?: (detail: Sockets.Pipelines.NamespaceDetail) => void
		/**
		 * Render one step only — the builder's inspector, where the flow beside
		 * it is what does the choosing.
		 *
		 * Bound reactively rather than remounting per node: the component holds
		 * the whole view, so switching nodes is a filter and not a refetch, and
		 * an in-flight draft in another step survives being looked away from.
		 */
		stepKey?: string
		/**
		 * Edit the configuration itself instead of overriding it.
		 *
		 * Set by the builder, which authors configurations; unset in the
		 * sidebar, which overrides one for you or this session. Without it every
		 * edit landed at instance scope — which *outranks* `preset`, where a
		 * configuration's own values live — so a change made with one
		 * configuration selected followed you to every other one, and
		 * duplicating a configuration to change a single setting changed it
		 * everywhere instead.
		 */
		editsConfigId?: number
		/**
		 * Draft mode (22 §2.1): value edits go to the host's pending map
		 * instead of the database — every `set`/`clear` becomes a callback,
		 * and nothing writes until the host's explicit Save. The prompt/
		 * template/layout sub-editors keep their own explicit Save flows (they
		 * edit shared entity rows, not this configuration) — but the *selection*
		 * a clone makes rides the draft like any other value.
		 */
		onDraftSet?: (option: Sockets.Pipelines.Option, value: unknown) => void
		onDraftClear?: (option: Sockets.Pipelines.Option) => void
		/** The host's pending values, overlaid onto what renders. */
		pending?: Record<string, unknown>
		/** Option ids queued to reset to inherited. */
		pendingClears?: string[]
	}

	let {
		slug,
		sessionId,
		mode = "config",
		title,
		collapsed = false,
		sessionDoesNotRun = false,
		onLoaded,
		stepKey,
		editsConfigId,
		onDraftSet,
		onDraftClear,
		pending,
		pendingClears
	}: Props = $props()

	/** Draft mode is simply "the host gave us somewhere to put edits". */
	const draftMode = $derived(!!onDraftSet)

	const socket = useTypedSocket()

	let detail = $state<Sockets.Pipelines.NamespaceDetail | null>(null)
	const userCtx: UserCtx | undefined = getContext("userCtx")
	const isAdmin = $derived(!!userCtx?.user?.isAdmin)
	/**
	 * The inline editors (prompt, template and layout wording, create and
	 * duplicate) belong to the Pipelines view and the builder. A session's
	 * settings choose among rows; the wording is edited where it lives.
	 */
	const editors = $derived(mode !== "session")

	/**
	 * The value being edited, keyed by option id. Text areas commit on blur;
	 * numbers and toggles commit immediately. Keeping in-flight text here
	 * rather than writing through to `detail` means a server response arriving
	 * mid-edit refreshes every *other* option without yanking the one under
	 * the cursor.
	 */
	let drafts = $state<Record<string, string>>({})
	/** The "Add…" pickers (script chains, lists): an action, so each goes
	 *  back to empty once its pick is applied. */
	let addPicks = $state<Record<string, string>>({})

	/**
	 * The prompt editor's in-flight text, keyed by option id.
	 *
	 * The editor is always on screen — a prompt's whole point is its wording,
	 * and hiding that behind a pencil made the selector a dropdown onto
	 * nothing. So there is no "editing" flag: a draft appears the moment
	 * someone types, and Save/Cancel appear with it.
	 *
	 * Each draft records the prompt row it belongs to, so text typed against
	 * one prompt is never rendered — or saved — against another after the
	 * selection changes underneath it. Anything that does not match the
	 * current row is ignored and falls back to the row's own text.
	 */
	let promptDrafts = $state<
		Record<
			string,
			{ id: number; name: string; fields: Record<string, string> }
		>
	>({})
	/**
	 * The layout editor's in-flight source, keyed by option id.
	 *
	 * Same shape and same rules as `promptDrafts` — always-on editor, no
	 * editing flag, and the draft records which row it belongs to so text
	 * typed against one layout is never saved onto another after the
	 * selection changes underneath it.
	 */
	let layoutDrafts = $state<
		Record<string, { id: number; name: string; source: string }>
	>({})
	/**
	 * The context-template editor's in-flight source, keyed by option id.
	 *
	 * Same shape and same rules as the two above. Kept separate rather than
	 * folded into `layoutDrafts` because the two editors sit on the same step
	 * and one shared map would let a story string be saved onto a layout after
	 * a selection changed underneath it — which is the exact bug the
	 * row-id-in-the-draft rule exists to make impossible.
	 */
	let templateDrafts = $state<
		Record<string, { id: number; name: string; source: string }>
	>({})
	/** The option a clone was requested from, so the copy can be selected. */
	let cloningFor: string | null = null
	let cloningLayoutFor: string | null = null
	let cloningTemplateFor: string | null = null

	/**
	 * Where this panel's edits land, in one sentence (owner Q7): the session
	 * inside a session that runs this pipeline; otherwise the configuration —
	 * an administrator's to change, read-only for everyone else.
	 */
	const scopeNote = $derived.by(() => {
		if (!detail) return ""
		if (detail.scope.kind === "session")
			return (
				detail.scope.readOnlyBecause ??
				"Changes here apply to this session only, and save as you make them."
			)
		const lead = sessionDoesNotRun ? "This session does not run this pipeline. " : ""
		const config = detail.selectedConfig
			? `everyone using the “${detail.selectedConfig.name}” configuration`
			: "everyone"
		if (isAdmin)
			return `${lead}Changes here apply to ${config}.`
		return `${lead}Only an administrator can change it.`
	})

	/**
	 * Why this session's values here are read-only, when they are — its
	 * creation pipeline once it is created (owner ruling 2026-09-30).
	 */
	const readOnlyBecause = $derived(
		detail?.scope.kind === "session" ? detail.scope.readOnlyBecause : undefined
	)

	/** The scope a view must carry for this panel to take it. */
	const takesView = (v: Sockets.Pipelines.NamespaceDetail) =>
		v.slug === slug &&
		(v.scope.kind === "session"
			? v.scope.sessionId === sessionId
			: // A panel asking at a session's scope may be answered at the
				// configuration's: the server gives session scope only for a
				// session its asker owns and runs this pipeline in. That
				// answer is taken until a session-scoped one has been.
				sessionId == null || detail?.scope.kind !== "session")

	/**
	 * Where this edit belongs. Authoring a named configuration and letting the
	 * server resolve the target are different acts — so the id travels when
	 * the builder set one, and nothing else does.
	 */
	const targetOf = () =>
		editsConfigId != null ? { configId: editsConfigId } : {}

	function set(option: Sockets.Pipelines.Option, value: unknown) {
		if (onDraftSet) {
			onDraftSet(option, value)
			return
		}
		socket.emit("pipelines:setOption", {
			slug,
			optionId: option.id,
			value,
			sessionId,
			...targetOf()
		})
	}

	function clear(option: Sockets.Pipelines.Option) {
		if (onDraftClear) {
			onDraftClear(option)
			return
		}
		socket.emit("pipelines:clearOption", {
			slug,
			optionId: option.id,
			sessionId,
			...targetOf()
		})
	}

	function chooseConfig(raw: string) {
		const configId = parseInt(raw, 10)
		if (Number.isNaN(configId)) return
		socket.emit("pipelines:selectConfig", { slug, configId, sessionId })
	}

	/** Numbers arrive from `<input>` as strings; an empty box means "unset". */
	function numeric(option: Sockets.Pipelines.Option, raw: string) {
		if (raw.trim() === "") return clear(option)
		const n =
			option.control === "integer" ? parseInt(raw, 10) : parseFloat(raw)
		if (Number.isNaN(n)) return
		set(option, n)
	}

	/* --- script chains ----------------------------------------------- */

	/**
	 * The chain as ids, from the hydrated entries. Every write sends the whole
	 * ordered list — the chain is one value, so reordering is one write, and
	 * an explicit `[]` means "no scripts here" while Reset means "inherit".
	 */
	const chainIds = (option: Sockets.Pipelines.Option) =>
		(option.scripts ?? []).map((s) => s.id)

	function chainAdd(option: Sockets.Pipelines.Option, raw: string) {
		const id = parseInt(raw, 10)
		if (Number.isNaN(id)) return
		const ids = chainIds(option)
		if (!ids.includes(id)) set(option, [...ids, id])
	}

	function chainRemove(option: Sockets.Pipelines.Option, id: number) {
		set(
			option,
			chainIds(option).filter((x) => x !== id)
		)
	}

	function chainMove(
		option: Sockets.Pipelines.Option,
		index: number,
		delta: number
	) {
		const ids = chainIds(option)
		const j = index + delta
		if (j < 0 || j >= ids.length) return
		;[ids[index], ids[j]] = [ids[j]!, ids[index]!]
		set(option, ids)
	}

	/* --- ordered lists (a `list` param) ------------------------------ */

	/**
	 * An ordered list is **one value**, written whole.
	 *
	 * Exactly the rule the script chain states one block above, and for the
	 * same reason: the order is part of the value, so reordering is one write
	 * and Reset is the only way back to inheriting. The rows are the resolved
	 * value — which is the declared default until somebody departs from it —
	 * so the first drag writes the whole pack rather than a delta nobody could
	 * read.
	 */
	const listRows = (
		option: Sockets.Pipelines.Option
	): Record<string, unknown>[] =>
		Array.isArray(option.value)
			? (option.value as unknown[]).map((r) => ({
					...((r ?? {}) as Record<string, unknown>)
				}))
			: []

	/** The row member that names it — an enum or a string, the first of either. */
	const listIdField = (option: Sockets.Pipelines.Option) =>
		option.item?.fields.find(
			(f) => f.control === "enum" || f.control === "string"
		)

	/** What a row is called: the declaration's label for its id, or the id. */
	function listRowLabel(
		option: Sockets.Pipelines.Option,
		row: Record<string, unknown>
	): string {
		const idField = listIdField(option)
		if (!idField) return ""
		const value = String(row[idField.key] ?? "")
		return idField.members?.find((m) => m.key === value)?.label ?? value
	}

	/** Rows this list could still gain — the id member's options, minus what is in. */
	function listAvailable(option: Sockets.Pipelines.Option) {
		const idField = listIdField(option)
		if (!idField?.of) return []
		const present = new Set(
			listRows(option).map((r) => String(r[idField.key] ?? ""))
		)
		return idField.of
			.filter((key) => !present.has(key))
			.map((key) => ({
				key,
				label: idField.members?.find((m) => m.key === key)?.label ?? key
			}))
	}

	function listMove(
		option: Sockets.Pipelines.Option,
		from: number,
		to: number
	) {
		const rows = listRows(option)
		if (from === to || to < 0 || to >= rows.length) return
		const [moved] = rows.splice(from, 1)
		rows.splice(to, 0, moved!)
		set(option, rows)
	}

	function listRemove(option: Sockets.Pipelines.Option, index: number) {
		const rows = listRows(option)
		rows.splice(index, 1)
		set(option, rows)
	}

	function listAdd(option: Sockets.Pipelines.Option, key: string) {
		const idField = listIdField(option)
		if (!idField || !key) return
		// The declared defaults for the other members, so an added row is a
		// complete one rather than a half-row the reader has to finish.
		const row: Record<string, unknown> = { [idField.key]: key }
		for (const f of option.item?.fields ?? [])
			if (f.key !== idField.key && f.default !== undefined)
				row[f.key] = f.default
		set(option, [...listRows(option), row])
	}

	function listSet(
		option: Sockets.Pipelines.Option,
		index: number,
		field: string,
		value: unknown
	) {
		const rows = listRows(option)
		if (!rows[index]) return
		rows[index]![field] = value
		set(option, rows)
	}

	/**
	 * The row being dragged, as (option, index).
	 *
	 * The option id rides along so a drag started in one list cannot drop into
	 * another — two `list` options on one step is an ordinary arrangement, and
	 * an index alone would let a block land in somebody else's pack.
	 */
	let listDrag = $state<{ optionId: string; from: number } | null>(null)

	/* --- prompt create / clone / edit / delete ----------------------- */

	/**
	 * Every prompt mutation names the **option**, not just the pipeline.
	 *
	 * A prompt row is shared across pipelines now — it follows its node — so
	 * "does this belong to this spec" has no true answer for one, and the slug
	 * alone can no longer authorize the write. The option handle proves the
	 * caller is operating a control this pipeline actually offers them, and the
	 * setting's pool is what the target row has to match. Exactly the move the
	 * layout mutations made when layouts became shared.
	 */
	function createPrompt(option: Sockets.Pipelines.Option) {
		cloningFor = option.id
		socket.emit("pipelines:createPrompt", {
			slug,
			optionId: option.id,
			name: "New prompt",
			// One empty box per field the step declares, rather than an empty
			// row: a create that produced no fields would open an editor with
			// nothing in it, which reads as broken rather than as blank.
			// `option.promptFields`, not `option.prompt?.declared`: the latter only
			// exists once a prompt is SELECTED, so creating the first prompt for
			// an empty slot — the one case this button is for — produced a row
			// with no fields and an editor with nothing in it.
			fields: Object.fromEntries(
				(option.promptFields ?? option.prompt?.declared ?? []).map(
					(f) => [f, ""]
				)
			),
			sessionId
		})
	}

	function clonePrompt(option: Sockets.Pipelines.Option) {
		if (!option.prompt) return
		cloningFor = option.id
		socket.emit("pipelines:clonePrompt", {
			slug,
			optionId: option.id,
			promptId: option.prompt.id,
			sessionId
		})
	}

	/** The draft for this option, but only while it belongs to the shown row. */
	function draftOf(option: Sockets.Pipelines.Option) {
		const d = promptDrafts[option.id]
		return d && option.prompt && d.id === option.prompt.id ? d : undefined
	}

	/** What a field box shows: the draft if one is open, else the stored text. */
	const fieldValue = (option: Sockets.Pipelines.Option, field: string) =>
		draftOf(option)?.fields[field] ?? option.prompt?.fields[field] ?? ""

	const nameValue = (option: Sockets.Pipelines.Option) =>
		draftOf(option)?.name ?? option.prompt?.name ?? ""

	/**
	 * Seed a draft from the stored row on the first keystroke.
	 *
	 * ⚠ **Archived keys are kept out of the draft**, and this is load-bearing
	 * rather than tidy. `fields` and `archived_fields` are two columns, and the
	 * boot sweep moves a key the slot no longer declares out of the first into
	 * the second. This used to copy `{...row.fields}` wholesale; the moment the
	 * two were separate columns that was still correct — but a draft seeded
	 * from the *union* would write the archived text straight back into
	 * `fields` on the next save, and the next boot would sweep it out again.
	 * The row would ping-pong between two shapes forever, with the panel
	 * showing whichever side of the loop it last loaded.
	 *
	 * So: only what the row currently has in `fields`, which is what the
	 * editors below render.
	 */
	function startDraft(option: Sockets.Pipelines.Option) {
		const existing = draftOf(option)
		if (existing) return existing
		const row = option.prompt!
		promptDrafts[option.id] = {
			id: row.id,
			name: row.name,
			fields: { ...row.fields }
		}
		return promptDrafts[option.id]!
	}

	/** Text somebody may still want, off a field the step stopped declaring. */
	const archivedOf = (option: Sockets.Pipelines.Option) =>
		Object.entries(option.prompt?.archived ?? {})

	/**
	 * Copy archived text to the clipboard.
	 *
	 * The whole recovery affordance, and deliberately a copy rather than a
	 * "restore": the field is gone from the step's declaration, so restoring it
	 * would put text back where nothing reads it. Copying hands it to the
	 * person, who knows which other prompt or pipeline it belongs in now.
	 */
	async function copyArchived(text: string) {
		try {
			await navigator.clipboard.writeText(text)
			toaster.success({ title: "Copied to the clipboard" })
		} catch {
			// A denied clipboard permission is not an error worth a red toast —
			// the text is on screen and selectable, which is the fallback.
			toaster.error({
				title: "Could not reach the clipboard. Select the text and copy it."
			})
		}
	}

	function editField(
		option: Sockets.Pipelines.Option,
		field: string,
		value: string
	) {
		startDraft(option).fields[field] = value
	}

	function editName(option: Sockets.Pipelines.Option, value: string) {
		startDraft(option).name = value
	}

	/** Unsaved changes — what puts Save and Cancel on screen. */
	function isDirty(option: Sockets.Pipelines.Option) {
		const d = draftOf(option)
		if (!d || !option.prompt) return false
		if (d.name !== option.prompt.name) return true
		return Object.keys(d.fields).some(
			(f) => d.fields[f] !== (option.prompt!.fields[f] ?? "")
		)
	}

	function savePrompt(option: Sockets.Pipelines.Option) {
		const draft = draftOf(option)
		if (!draft) return
		socket.emit("pipelines:updatePrompt", {
			slug,
			optionId: option.id,
			promptId: draft.id,
			name: draft.name,
			fields: draft.fields,
			sessionId
		})
		delete promptDrafts[option.id]
	}

	function deletePrompt(option: Sockets.Pipelines.Option) {
		if (!option.prompt) return
		if (
			!confirm(
				`Delete the prompt '${option.prompt.name}'? Your selection ` +
					`here goes back to what it inherits. Prompts are shared ` +
					`between pipelines that use this step, so if another one ` +
					`still points at it the server refuses.`
			)
		)
			return
		delete promptDrafts[option.id]
		socket.emit("pipelines:deletePrompt", {
			slug,
			optionId: option.id,
			promptId: option.prompt.id,
			sessionId
		})
	}

	/* --- layout clone / edit / delete -------------------------------- */

	function cloneLayout(option: Sockets.Pipelines.Option) {
		if (!option.variableTemplate) return
		cloningLayoutFor = option.id
		socket.emit("pipelines:cloneVariableTemplate", {
			slug,
			optionId: option.id,
			templateId: option.variableTemplate.id,
			sessionId
		})
	}

	function layoutDraftOf(option: Sockets.Pipelines.Option) {
		const d = layoutDrafts[option.id]
		return d &&
			option.variableTemplate &&
			d.id === option.variableTemplate.id
			? d
			: undefined
	}

	const layoutSource = (option: Sockets.Pipelines.Option) =>
		layoutDraftOf(option)?.source ?? option.variableTemplate?.source ?? ""

	const layoutName = (option: Sockets.Pipelines.Option) =>
		layoutDraftOf(option)?.name ?? option.variableTemplate?.name ?? ""

	function startLayoutDraft(option: Sockets.Pipelines.Option) {
		const existing = layoutDraftOf(option)
		if (existing) return existing
		const row = option.variableTemplate!
		layoutDrafts[option.id] = {
			id: row.id,
			name: row.name,
			source: row.source
		}
		return layoutDrafts[option.id]!
	}

	function editLayout(
		option: Sockets.Pipelines.Option,
		patch: { name?: string; source?: string }
	) {
		const draft = startLayoutDraft(option)
		if (patch.name !== undefined) draft.name = patch.name
		if (patch.source !== undefined) draft.source = patch.source
	}

	function layoutDirty(option: Sockets.Pipelines.Option) {
		const d = layoutDraftOf(option)
		if (!d || !option.variableTemplate) return false
		return (
			d.name !== option.variableTemplate.name ||
			d.source !== option.variableTemplate.source
		)
	}

	function saveLayout(option: Sockets.Pipelines.Option) {
		const draft = layoutDraftOf(option)
		if (!draft) return
		socket.emit("pipelines:updateVariableTemplate", {
			slug,
			optionId: option.id,
			templateId: draft.id,
			name: draft.name,
			source: draft.source,
			sessionId
		})
		delete layoutDrafts[option.id]
	}

	function deleteLayout(option: Sockets.Pipelines.Option) {
		if (!option.variableTemplate) return
		if (
			!confirm(
				`Delete the layout '${option.variableTemplate.name}'? Your ` +
					`selection here goes back to what it inherits. Layouts are ` +
					`shared between pipelines, so if another one still uses this ` +
					`the server refuses.`
			)
		)
			return
		delete layoutDrafts[option.id]
		socket.emit("pipelines:deleteVariableTemplate", {
			slug,
			optionId: option.id,
			templateId: option.variableTemplate.id,
			sessionId
		})
	}

	/* --- context template create / clone / edit / delete -------------- */

	/**
	 * `engine` is sent, never inferred: a slot that renders two languages has
	 * no way to know which one the click meant, and the server's fallback is
	 * the slot's first — so a person wanting the second would silently get the
	 * first.
	 */
	function createTemplate(option: Sockets.Pipelines.Option, engine?: string) {
		cloningTemplateFor = option.id
		socket.emit("pipelines:createContextTemplate", {
			slug,
			optionId: option.id,
			...(engine ? { engine } : {}),
			sessionId
		})
	}

	/**
	 * The languages this slot renders. One is the ordinary case and gets one
	 * unlabelled button; a language name on every button of a single-language
	 * slot is a constant repeated in the only place a person is choosing.
	 */
	const acceptedEngines = (option: Sockets.Pipelines.Option): string[] =>
		option.acceptedEngines?.length ? option.acceptedEngines : []

	function cloneTemplate(option: Sockets.Pipelines.Option) {
		if (!option.contextTemplate) return
		cloningTemplateFor = option.id
		socket.emit("pipelines:cloneContextTemplate", {
			slug,
			optionId: option.id,
			templateId: option.contextTemplate.id,
			sessionId
		})
	}

	function templateDraftOf(option: Sockets.Pipelines.Option) {
		const d = templateDrafts[option.id]
		return d && option.contextTemplate && d.id === option.contextTemplate.id
			? d
			: undefined
	}

	const templateSource = (option: Sockets.Pipelines.Option) =>
		templateDraftOf(option)?.source ?? option.contextTemplate?.source ?? ""

	const templateName = (option: Sockets.Pipelines.Option) =>
		templateDraftOf(option)?.name ?? option.contextTemplate?.name ?? ""

	function startTemplateDraft(option: Sockets.Pipelines.Option) {
		const existing = templateDraftOf(option)
		if (existing) return existing
		const row = option.contextTemplate!
		templateDrafts[option.id] = {
			id: row.id,
			name: row.name,
			source: row.source
		}
		return templateDrafts[option.id]!
	}

	function editTemplate(
		option: Sockets.Pipelines.Option,
		patch: { name?: string; source?: string }
	) {
		const draft = startTemplateDraft(option)
		if (patch.name !== undefined) draft.name = patch.name
		if (patch.source !== undefined) draft.source = patch.source
	}

	function templateDirty(option: Sockets.Pipelines.Option) {
		const d = templateDraftOf(option)
		if (!d || !option.contextTemplate) return false
		return (
			d.name !== option.contextTemplate.name ||
			d.source !== option.contextTemplate.source
		)
	}

	function saveTemplate(option: Sockets.Pipelines.Option) {
		const draft = templateDraftOf(option)
		if (!draft) return
		socket.emit("pipelines:updateContextTemplate", {
			slug,
			optionId: option.id,
			templateId: draft.id,
			name: draft.name,
			source: draft.source,
			sessionId
		})
		delete templateDrafts[option.id]
	}

	function deleteTemplate(option: Sockets.Pipelines.Option) {
		if (!option.contextTemplate) return
		if (
			!confirm(
				`Delete the context template '${option.contextTemplate.name}'? ` +
					`Your selection here goes back to what it inherits. ` +
					`Templates are shared between pipelines, so if another one ` +
					`still uses this the server refuses.`
			)
		)
			return
		delete templateDrafts[option.id]
		socket.emit("pipelines:deleteContextTemplate", {
			slug,
			optionId: option.id,
			templateId: option.contextTemplate.id,
			sessionId
		})
	}

	/** `postHistoryInstructions` shows as `Post History Instructions`. */
	function humanize(key: string): string {
		return key
			.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
			.replace(/[_-]+/g, " ")
			.replace(/\s+/g, " ")
			.trim()
			.split(" ")
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
			.join(" ")
	}

	// Named handlers, and `off` is handed the handler — two of these panels
	// can be mounted at once (the sidebar and the graph page), and an
	// argument-less `off` would deafen whichever one survives.
	const onGet = (res: Sockets.Pipelines.Get.Response) => {
		if (res.error) {
			toaster.error({ title: res.error })
			return
		}
		// A shared channel: another panel's pipeline, or this pipeline at
		// another scope, is not this one's.
		if (!res.pipeline || !takesView(res.pipeline)) return
		detail = res.pipeline
		drafts = {}
		onLoaded?.(res.pipeline)
	}
	// A clone answers with the copy's id: select it for this option and open
	// the editor — clone-and-edit is one gesture, not three.
	const onCloned = (
		res:
			| Sockets.Pipelines.ClonePrompt.Response
			| Sockets.Pipelines.CreatePrompt.Response
	) => {
		if (res.error) return
		if (!res.pipeline || res.pipeline.slug !== slug) return
		const optionId = cloningFor
		cloningFor = null
		if (!optionId || res.promptId == null) return
		const opt = optionsOf(res.pipeline.groups).find(
			(o) => o.id === optionId
		)
		if (opt) set(opt, res.promptId)
		// No draft is seeded: the copy's text is the original's, the editor is
		// always on screen, and the refreshed view carries the copy's row —
		// so the boxes fill themselves and stay clean until someone types.
		delete promptDrafts[optionId]
	}
	// The layout clone answers the same way, and selects the copy for this
	// option so "duplicate and rewrite it as prose" is one gesture.
	const onLayoutCloned = (
		res: Sockets.Pipelines.CloneVariableTemplate.Response
	) => {
		if (res.error) return
		if (!res.pipeline || res.pipeline.slug !== slug) return
		const optionId = cloningLayoutFor
		cloningLayoutFor = null
		if (!optionId || res.templateId == null) return
		const opt = optionsOf(res.pipeline.groups).find(
			(o) => o.id === optionId
		)
		if (opt) set(opt, res.templateId)
		delete layoutDrafts[optionId]
	}
	// Create and clone answer the same way, and select the new row for this
	// option so "start from this and rewrite it" is one gesture.
	const onTemplateCloned = (
		res:
			| Sockets.Pipelines.CloneContextTemplate.Response
			| Sockets.Pipelines.CreateContextTemplate.Response
	) => {
		if (res.error) return
		if (!res.pipeline || res.pipeline.slug !== slug) return
		const optionId = cloningTemplateFor
		cloningTemplateFor = null
		if (!optionId || res.templateId == null) return
		const opt = optionsOf(res.pipeline.groups).find(
			(o) => o.id === optionId
		)
		if (opt) set(opt, res.templateId)
		delete templateDrafts[optionId]
	}
	// The server's refusals are written for a person — "connections stay
	// with the administrator so credentials and compute do" — so they are
	// shown, not replaced with a status.
	const showRefusal = (res: { error?: string }) => {
		if (res?.error) toaster.error({ title: res.error })
	}

	/**
	 * Every event this panel reads, declared on the interest registry — which
	 * owns the one listener per event name and releases this panel's
	 * subscribers when it is destroyed. That is what the twenty named
	 * `socket.off` calls were doing by hand, minus the hazard that a bare
	 * `off(event)` would have torn down every other view's listener with them.
	 *
	 * ⚠ `pipelines:get` is STANDING, not a one-shot around the request below:
	 * every write handler re-emits the view on it (set, clear, select, prompt
	 * and template writes all cascade to `pipelines:get`), so the key has to be
	 * held for as long as the panel is mounted or a save would land and the
	 * panel would never see the result.
	 *
	 * ⚠ BARE keys throughout: none of these events has an entry in
	 * `SCOPED_EVENTS`, and a `#<slug>` key for an unscoped event matches NO
	 * payload at all. Each handler's own `res.pipeline.slug !== slug` check
	 * stays the filter — two of these panels on different pipelines still must
	 * not clobber each other.
	 *
	 * Declared ahead of the `onMount` below, because effects run in declaration
	 * order: the key is held before the request goes out (which flushes the
	 * interest sync itself — plan ruling 3).
	 */
	useInterest<"pipelines:get">("pipelines:get", onGet)
	useInterest<"pipelines:clonePrompt">("pipelines:clonePrompt", onCloned)
	useInterest<"pipelines:createPrompt">("pipelines:createPrompt", onCloned)
	useInterest<"pipelines:createContextTemplate">(
		"pipelines:createContextTemplate",
		onTemplateCloned
	)
	useInterest<"pipelines:cloneContextTemplate">(
		"pipelines:cloneContextTemplate",
		onTemplateCloned
	)
	useInterest<"pipelines:cloneVariableTemplate">(
		"pipelines:cloneVariableTemplate",
		onLayoutCloned
	)
	// The refusals. Never gated (plan ruling 2 — an error is not an output to
	// skip), but the registry is the only listener path, so they are declared
	// like the rest.
	useInterest<"pipelines:createPrompt:error">(
		"pipelines:createPrompt:error",
		showRefusal
	)
	useInterest<"pipelines:setOption:error">(
		"pipelines:setOption:error",
		showRefusal
	)
	useInterest<"pipelines:clearOption:error">(
		"pipelines:clearOption:error",
		showRefusal
	)
	useInterest<"pipelines:selectConfig:error">(
		"pipelines:selectConfig:error",
		showRefusal
	)
	useInterest<"pipelines:clonePrompt:error">(
		"pipelines:clonePrompt:error",
		showRefusal
	)
	useInterest<"pipelines:updatePrompt:error">(
		"pipelines:updatePrompt:error",
		showRefusal
	)
	useInterest<"pipelines:deletePrompt:error">(
		"pipelines:deletePrompt:error",
		showRefusal
	)
	useInterest<"pipelines:createContextTemplate:error">(
		"pipelines:createContextTemplate:error",
		showRefusal
	)
	useInterest<"pipelines:cloneContextTemplate:error">(
		"pipelines:cloneContextTemplate:error",
		showRefusal
	)
	useInterest<"pipelines:updateContextTemplate:error">(
		"pipelines:updateContextTemplate:error",
		showRefusal
	)
	useInterest<"pipelines:deleteContextTemplate:error">(
		"pipelines:deleteContextTemplate:error",
		showRefusal
	)
	useInterest<"pipelines:cloneVariableTemplate:error">(
		"pipelines:cloneVariableTemplate:error",
		showRefusal
	)
	useInterest<"pipelines:updateVariableTemplate:error">(
		"pipelines:updateVariableTemplate:error",
		showRefusal
	)
	useInterest<"pipelines:deleteVariableTemplate:error">(
		"pipelines:deleteVariableTemplate:error",
		showRefusal
	)

	onMount(() => {
		// The key above is already held; the typed `emit` flushes its interest
		// sync ahead of this packet on the same socket (plan ruling 3).
		socket.emit("pipelines:get", { slug, sessionId })
	})

	/**
	 * The draft overlaid onto what renders (22 §2.1): a pending value shows as
	 * the value, a pending reset shows as the inherited default. The overlay
	 * lives at this one derivation so every read downstream sees the draft
	 * without knowing it exists.
	 */
	const overlay = (o: Sockets.Pipelines.Option): Sockets.Pipelines.Option => {
		if (!draftMode) return o
		if (pendingClears?.includes(o.id))
			return {
				...o,
				value: o.authorDefault ?? null,
				overriddenHere: false,
				// The changed marker follows the draft too, or a queued reset
				// would keep its dot until Save all and the panel would be
				// saying the opposite of what the draft bar says.
				changed: false,
				source: "author"
			}
		if (pending && o.id in pending)
			return {
				...o,
				value: pending[o.id],
				overriddenHere: true,
				changed: true
			}
		return o
	}

	/** Is this option carrying an unsaved edit? Drives the pending marker. */
	const isPending = (id: string) =>
		!!(pending && id in pending) || !!pendingClears?.includes(id)

	/** The server's groups, with the draft overlaid, shaped for this surface. */
	const groups = $derived.by(() => {
		if (!detail) return []
		const overlaid = draftMode
			? detail.groups.map((g) => ({
					...g,
					...(g.enabled ? { enabled: overlay(g.enabled) } : {}),
					front: g.front.map(overlay),
					advanced: g.advanced.map((st) => ({
						...st,
						options: st.options.map(overlay)
					}))
				}))
			: detail.groups
		return drawnGroups(overlaid, mode)
	})

	/** The builder's one step: every row it owns, front and Advanced alike. */
	const builderStep = $derived(
		mode === "builder" && stepKey != null
			? (builderStepsOf(groups).find((st) => st.key === stepKey) ?? null)
			: null
	)

	/**
	 * Which Advanced folds are open, by group key, for as long as this panel
	 * is mounted — a fresh view after a save must not close the fold the
	 * person was working in.
	 */
	const openFolds = new SvelteSet<string>()

	/**
	 * The block to move focus to for a Model row that is another group's
	 * pointer, and the id each block's heading carries for it.
	 */
	const headingId = (groupKey: string) => `grp-${slug}-${groupKey}`.replace(/[^\w-]/g, "-")

	/**
	 * A row's provenance line: the server's for a Model or Sampling row;
	 * for any other row, said only once a value was set somewhere.
	 */
	function provenanceOf(o: Sockets.Pipelines.Option): string | undefined {
		if (o.provenance) return o.provenance.label
		if (o.source === "session") return "Set for this session"
		if (o.source === "config")
			return detail?.scope.kind === "session"
				? `From the “${detail.selectedConfig?.name ?? "selected"}” configuration`
				: "Set in this configuration"
		return undefined
	}

	/** What a readonly row shows: the value's NAME, never an id. */
	function readonlyValue(o: Sockets.Pipelines.Option): string {
		if (o.valueLabel) return o.valueLabel
		if (o.value == null)
			return (
				o.inherits?.label ??
				(o.control === "connection-ref" ? "No model set" : "—")
			)
		if (typeof o.value === "boolean") return o.value ? "On" : "Off"
		if (Array.isArray(o.value)) return o.value.join(", ") || "—"
		if (typeof o.value === "object") return "Set"
		return String(o.value)
	}

	/** The model-call choices every group fronts under fixed labels. */
	const FRONT_CHOICES = new Set(["prompts-ref", "connection-ref", "sampling-ref"])

	/** A session card's summary line: its first model's name. */
	const cardSummary = $derived.by(() => {
		const model = groups
			.flatMap((g) => g.front)
			.find((o) => o.control === "connection-ref")
		return model ? readonlyValue(model) : ""
	})

	/**
	 * Model and Sampling sit side by side on a wide view, so the front is
	 * split into runs: the pair picker and its sampling as one run, every
	 * other row on its own.
	 */
	const frontRuns = (front: Sockets.Pipelines.Option[]) => {
		const runs: Sockets.Pipelines.Option[][] = []
		for (const o of front) {
			const last = runs.at(-1)
			if (
				o.control === "sampling-ref" &&
				last?.length === 1 &&
				last[0]!.control === "connection-ref"
			)
				last.push(o)
			else runs.push([o])
		}
		return runs
	}
</script>

{#snippet optionRow(
	option: Sockets.Pipelines.Option,
	/** A label other than the row's own — the builder's source switches. */
	labelOverride?: string
)}
	{@const label = labelOverride ?? rowLabelOf(option)}
	<!-- The wrapper carries the option's address so a host's search or diff
	     view can scroll to it (22 §2.3/§2.6). -->
	<div
		class="flex min-w-0 flex-col gap-1"
		data-option-id={option.id}
		data-option-row={option.control}
	>
		<div class="flex items-center gap-2">
			<label
				class="text-surface-700-300 min-w-0 flex-1 text-xs font-medium break-words"
				for="opt-{option.id}"
				data-row-label
			>
				{label}
			</label>
			{#if option.control === "connection-ref" && mode !== "builder"}
				<DocPeek
					href={docsHref("pipelines", "model-and-sampling")}
					topic="choosing a model"
				/>
			{/if}
			{#if draftMode && isPending(option.id)}
				<span
					class="preset-tonal-warning shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
					title="Unsaved — lands with Save"
				>
					pending
				</span>
			{/if}
		</div>

		{#if option.description && !FRONT_CHOICES.has(option.control)}
			<!-- A hint, kept but not shouted: read once, then the control is
			     what is read. `title` carries the full text at any size. The
			     three model-call choices read alike in every group and are
			     explained once, by the Model row's peek. -->
			<p
				class="text-surface-600-400 text-[11px] leading-snug"
				title={option.description}
			>
				{option.description}
			</p>
		{/if}

		{#if !option.writable}
			<!-- A readonly value, never a disabled input (STYLE-GUIDE §6.11):
			     the value's NAME, where it came from, and who changes it. A
			     session names no model (ruled 2026-09-30), so there an
			     administrator's Model row is this; nobody else is sent one. -->
			<div class="flex flex-col gap-0.5" id="opt-{option.id}">
				<p class="text-sm break-words">{readonlyValue(option)}</p>
				<p
					class="text-surface-600-400 flex flex-wrap gap-x-2 text-xs"
				>
					{#if option.provenance && option.provenance.label !== readonlyValue(option)}
						<span>{option.provenance.label}</span>
					{/if}
					{#if readOnlyBecause}
						<!-- The card's one note says why; nobody changes it now. -->
					{:else if isAdmin}
						<a
							class="underline"
							href="/admin/pipelines/{encodeURIComponent(slug)}"
						>
							Change in Pipelines
						</a>
					{:else}
						<span>Set by an administrator</span>
					{/if}
				</p>
			</div>
		{:else if option.control === "template"}
			<!-- An empty template is not an empty setting: it means the step
			     renders with its built-in wording. Saying so is the difference
			     between "nothing is configured here" and "nothing is
			     overridden here". -->
			<textarea
				id="opt-{option.id}"
				class="textarea w-full font-mono text-xs"
				placeholder="Empty — using the built-in wording"
				rows={8}
				value={drafts[option.id] ??
					(option.value == null ? "" : String(option.value))}
				oninput={(e) => (drafts[option.id] = e.currentTarget.value)}
				onblur={(e) => {
					const next = e.currentTarget.value
					const current =
						option.value == null ? "" : String(option.value)
					if (next === current) return
					if (next === "") clear(option)
					else set(option, next)
				}}
			></textarea>
		{:else if (option.control === "text" || option.control === "string") && option.decl}
			<TextControl
				id="opt-{option.id}"
				decl={option.decl}
				value={option.value}
				oncommit={(next) =>
					next === undefined ? clear(option) : set(option, next)}
			/>
		{:else if option.control === "boolean" && option.decl}
			<BooleanControl
				id="opt-{option.id}"
				decl={option.decl}
				value={option.value}
				oncommit={(next) => set(option, next)}
			/>
		{:else if option.control === "enum" && option.decl}
			<SelectControl
				id="opt-{option.id}"
				decl={option.decl}
				value={option.value}
				oncommit={(next) => set(option, next)}
			/>
		{:else if (option.control === "number" || option.control === "integer") && option.decl}
			<NumberControl
				id="opt-{option.id}"
				decl={option.decl}
				value={option.value}
				oncommit={(next) =>
					next === undefined ? clear(option) : set(option, next)}
			/>
		{:else if option.control === "share"}
			<!-- Normalised, so there is no invalid state to report: the total is
			     always 100% and zero is a band's off switch. -->
			<ShareBar
				members={option.members ?? []}
				value={(option.value ?? option.authorDefault) as Record<
					string,
					number
				>}
				readonly={false}
				windowTokens={option.windowTokens}
				onchange={(next) => set(option, next)}
			/>
		{:else if option.control === "strengths"}
			<!-- ⚠ **A different shape from the bar above on purpose.** That one
			     divides one budget between sources, so raising a band lowers the
			     others; these are independent strengths and every one of them
			     may be full at once. Drawing them alike would say "these
			     compete" in the only language a stacked bar has. -->
			<StrengthBars
				members={option.members ?? []}
				value={option.value as Record<string, number> | undefined}
				authorDefault={option.authorDefault as
					| Record<string, number>
					| undefined}
				min={option.min}
				max={option.max}
				readonly={false}
				onchange={(next) => set(option, next)}
			/>
		{:else if option.control === "per-member"}
			<!-- Same declared bands as the bar above it, so a ceiling and a
			     share read as the same five things in the same order and the
			     same colours. -->
			<ul class="flex flex-col gap-1">
				{#each option.members ?? [] as m (m.key)}
					<li class="flex items-center gap-2 text-xs">
						<span
							class="min-w-0 flex-1 truncate"
							title={m.description}
						>
							{m.label ?? m.key}
						</span>
						<input
							type="number"
							class="input w-24 text-right"
							min="0"
							step="1"
							disabled={false}
							aria-label={m.label ?? m.key}
							value={String(
								(
									(option.value ??
										option.authorDefault ??
										{}) as Record<string, number>
								)[m.key] ?? 0
							)}
							onchange={(e) => {
								const base = {
									...(((option.value ??
										option.authorDefault ??
										{}) as Record<string, number>) ?? {})
								}
								const n = parseInt(e.currentTarget.value, 10)
								if (Number.isNaN(n)) return
								base[m.key] = n
								set(option, base)
							}}
						/>
					</li>
				{/each}
			</ul>
		{:else if option.control === "prompts-ref"}
			<!-- A prompt is a swappable entity: the dropdown selects the row,
			     the editor below edits that row. The editor is always on
			     screen because the wording *is* the setting — a dropdown onto
			     text nobody can see is half a control. A shipped prompt shows
			     the same boxes, read-only, with Duplicate as the way in.

			     Prompts are pooled by the STEP that consumes them, but the
			     server offers only this pipeline's share of the pool (owner
			     note 37, 2026-10-02, `promptsForPipeline`): rows written for
			     it, rows shipped for no pipeline in particular, and rows
			     written for none. A row written for another pipeline is not
			     offered unless it is the one selected. -->
			{@const promptGroups = [
				{ key: "usedHere", label: "Used in this pipeline" },
				{ key: "shipped", label: "Serene Pub ships" },
				{ key: "alsoFits", label: "Also fits" }
			]}
			<div class="flex items-center gap-1">
				<Select
					label={labelOverride ?? rowLabelOf(option)}
					labelHidden
					class="min-w-0 flex-1"
					options={[
						// Unset is a fallback, not an absence: the step resolves to the
						// prompt this pipeline ships for it, so a run never goes out
						// with empty instructions.
						{ value: "", label: "Pipeline default" },
						...promptGroups.flatMap((g) =>
							(option.choices ?? [])
								.filter((c: any) => (c.group ?? "alsoFits") === g.key)
								.map((choice: any) => ({
									value: String(choice.id),
									label: `${choice.label}${
										choice.description ? ` — ${choice.description}` : ""
									}`,
									group: g.label
								}))
						)
					]}
					value={option.value == null ? "" : String(option.value)}
					onValueChange={(raw) => {
						if (raw === "") return clear(option)
						set(option, Number(raw))
					}}
				/>
				{#if editors}
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface shrink-0"
						title="Write a new prompt for this step"
						aria-label="Write a new prompt for this step"
						onclick={() => createPrompt(option)}
					>
						<!-- Present even with rows in the pool, and required
						     without them: a step whose pool is empty — any
						     plugin node that ships no prose — would otherwise
						     be a picker with nothing in it and no way in. -->
						<Icons.Plus size={14} />
					</button>
				{/if}
				{#if option.prompt && editors}
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface shrink-0"
						title="Duplicate this prompt and edit the copy"
						aria-label="Duplicate this prompt and edit the copy"
						onclick={() => clonePrompt(option)}
					>
						<Icons.Copy size={14} />
					</button>
					{#if !option.prompt.readOnly}
						<button
							type="button"
							class="btn btn-sm preset-tonal-surface shrink-0"
							title="Delete this prompt"
							aria-label="Delete this prompt"
							onclick={() => deletePrompt(option)}
						>
							<Icons.Trash2 size={14} />
						</button>
					{/if}
				{/if}
			</div>

			{#if option.prompt && editors}
				{@const readOnly = option.prompt.readOnly}
				<div class="bg-surface-50-950 mt-1 space-y-3 rounded-[10px] p-3">
					{#if readOnly}
						<p class="text-surface-600-400 text-xs">
							<Icons.Lock size={11} class="inline" />
							One of the prompts Serene Pub ships. Duplicate it to
							make it yours.
						</p>
					{:else}
						<label class="flex flex-col gap-1 text-xs font-medium">
							Name
							<input
								type="text"
								class="input w-full"
								value={nameValue(option)}
								oninput={(e) =>
									editName(option, e.currentTarget.value)}
							/>
						</label>
					{/if}

					{#if option.prompt.origin}
						<!-- Answers the question the grouping raises: this row
						     is selectable here and was written elsewhere, and
						     editing it reaches there too. The same note the
						     template editor carries, because since prompts
						     became pooled it is the same situation. -->
						<p class="text-surface-600-400 text-xs">
							<Icons.Info size={11} class="inline" />
							Written {option.prompt.origin} — edits reach every pipeline
							using this step.
						</p>
					{/if}

					<!-- One box per declared field. The field list comes from
					     the prompt row, which was written against the node's
					     declaration — so a node that declares another field
					     grows another box here with no change to this file. -->
					<!--
						Only the fields this node declares. The graph builder's
						five steps share one prompt row of five texts and each
						declares one of them, so rendering the row put every
						text on every step. Falls back to the row's own keys so
						a plugin whose declaration cannot be read still shows
						its wording rather than an empty editor.
					-->
					{#each option.prompt.declared?.length ? option.prompt.declared : Object.keys(option.prompt.fields) as field (field)}
						<label class="flex flex-col gap-1 text-xs font-medium">
							{humanize(field)}
							<textarea
								class="textarea w-full text-xs"
								rows={readOnly ? 4 : 6}
								readonly={readOnly}
								value={fieldValue(option, field)}
								oninput={(e) =>
									editField(
										option,
										field,
										e.currentTarget.value
									)}
							></textarea>
						</label>
					{/each}

					{#if archivedOf(option).length}
						<!-- Text off a field this step stopped declaring.
						     Read-only and shown apart from the editors: left
						     folded into the boxes above it would be invisible,
						     because those render one box per DECLARED field —
						     so a prompt somebody spent an afternoon on would
						     become unfindable rather than merely unused.

						     Copy rather than Restore, deliberately. The field
						     is gone from the step, so putting the text back
						     would put it where nothing reads it. Copying hands
						     it to the person, who knows which prompt or
						     pipeline it belongs in now. -->
						<div
							class="border-surface-500/30 space-y-2 border-t pt-3"
						>
							<p class="text-surface-600-400 text-xs">
								<Icons.Archive size={11} class="inline" />
								Archived — this step no longer has
								{archivedOf(option).length === 1
									? "this field"
									: "these fields"}. Kept so you can copy the
								wording somewhere it is still used.
							</p>
							{#each archivedOf(option) as [field, text] (field)}
								<div class="flex flex-col gap-1">
									<div class="flex items-center gap-2">
										<span
											class="flex-1 text-xs font-medium"
										>
											{humanize(field)}
										</span>
										<button
											type="button"
											class="btn btn-sm preset-tonal-surface shrink-0"
											title="Copy this text"
											onclick={() => copyArchived(text)}
										>
											<Icons.Copy size={13} /> Copy
										</button>
									</div>
									<textarea
										class="textarea w-full text-xs opacity-70"
										rows="3"
										readonly
										value={text}
									></textarea>
								</div>
							{/each}
						</div>
					{/if}

					{#if isDirty(option)}
						<div class="flex items-center justify-end gap-2">
							<span class="text-surface-600-400 mr-auto text-xs">
								Unsaved changes
							</span>
							<button
								type="button"
								class="btn btn-sm preset-tonal-surface"
								onclick={() => delete promptDrafts[option.id]}
							>
								Cancel
							</button>
							<button
								type="button"
								class="btn btn-sm preset-filled-primary-500"
								onclick={() => savePrompt(option)}
							>
								<Icons.Save size={14} /> Save
							</button>
						</div>
					{/if}
				</div>
			{/if}
		{:else if option.control === "context-template-ref"}
			<!-- The story string. Same swappable-entity pattern as a prompt or
			     a layout, with one difference that shows on screen: the rows
			     are pooled by the *kind of step* that renders them rather than
			     by pipeline, so the list is grouped — this pipeline's own
			     first, then the ones Serene Pub ships, then everything else
			     that fits. The grouping is ordering, never permission. -->
			{@const groups = [
				{ key: "usedHere", label: "Used in this pipeline" },
				{ key: "shipped", label: "Serene Pub ships" },
				{ key: "alsoFits", label: "Also fits (from other pipelines)" }
			]}
			<div class="flex items-center gap-1">
				<!-- A row whose engine has no registered renderer is `disabled`
				     with its `reason`, never hidden — the rule the connection picker
				     established. A row that vanished when a plugin was disabled would
				     read as data loss, and "why isn't mine in the list" would be
				     unanswerable on the screen that raised the question. -->
				<Select
					label={labelOverride ?? rowLabelOf(option)}
					labelHidden
					class="min-w-0 flex-1"
					options={[
						// Unset still renders: the step falls back to the template
						// Serene Pub ships, so a prompt is never empty because a
						// selection went away.
						{ value: "", label: "Pipeline default" },
						...groups.flatMap((g) =>
							(option.choices ?? [])
								.filter((c: any) => (c.group ?? "alsoFits") === g.key)
								.map((choice: any) => ({
									value: String(choice.id),
									label: `${choice.label}${
										choice.description ? ` — ${choice.description}` : ""
									}`,
									group: g.label,
									disabled: !!choice.disabled,
									hint: choice.reason || undefined
								}))
						)
					]}
					value={option.value == null ? "" : String(option.value)}
					onValueChange={(raw) => {
						if (raw === "") return clear(option)
						set(option, Number(raw))
					}}
				/>
				{#if acceptedEngines(option).length > 1}
					{#each acceptedEngines(option) as engine (engine)}
						<button
							type="button"
							class="btn btn-sm preset-tonal-surface shrink-0"
							title="Write a new {languageOf(
								engine
							)} context template from scratch"
							onclick={() => createTemplate(option, engine)}
						>
							<Icons.Plus size={14} />
							<span class="text-xs">{languageOf(engine)}</span>
						</button>
					{/each}
				{:else}
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface shrink-0"
						title="Write a new context template from scratch"
						aria-label="Write a new context template from scratch"
						onclick={() => createTemplate(option)}
					>
						<Icons.Plus size={14} />
					</button>
				{/if}
				{#if option.contextTemplate && editors}
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface shrink-0"
						title="Duplicate this template and edit the copy"
						aria-label="Duplicate this template and edit the copy"
						onclick={() => cloneTemplate(option)}
					>
						<Icons.Copy size={14} />
					</button>
					{#if !option.contextTemplate.readOnly}
						<button
							type="button"
							class="btn btn-sm preset-tonal-surface shrink-0"
							title="Delete this template"
							aria-label="Delete this template"
							onclick={() => deleteTemplate(option)}
						>
							<Icons.Trash2 size={14} />
						</button>
					{/if}
				{/if}
			</div>

			{#if option.contextTemplate && editors}
				{@const readOnly = option.contextTemplate.readOnly}
				<div class="bg-surface-50-950 mt-1 space-y-3 rounded-[10px] p-3">
					{#if readOnly}
						<p class="text-surface-600-400 text-xs">
							<Icons.Lock size={11} class="inline" />
							One of the templates Serene Pub ships. Duplicate it to
							make it yours.
						</p>
					{:else}
						<label class="flex flex-col gap-1 text-xs font-medium">
							Name
							<input
								type="text"
								class="input w-full"
								value={templateName(option)}
								oninput={(e) =>
									editTemplate(option, {
										name: e.currentTarget.value
									})}
							/>
						</label>
					{/if}

					{#if option.contextTemplate.origin}
						<!-- Answers the question the grouping raises: this row
						     is selectable here and was written elsewhere, and
						     editing it reaches there too. -->
						<p class="text-surface-600-400 text-xs">
							<Icons.Info size={11} class="inline" />
							Written {option.contextTemplate.origin} — edits reach
							every pipeline using it.
						</p>
					{/if}

					<!-- Typed templates P7: this step's typed scope — completion,
					     hover, lint with did-you-mean fixes, and the variables
					     tree — rather than the library's name list. -->
					<div class="flex flex-col gap-1 text-xs font-medium">
						<span>Template</span>
						<TemplateEditor
							label="Template"
							rows={readOnly ? 6 : 16}
							readonly={readOnly}
							value={templateSource(option)}
							scope={option.scope}
							declarers={option.scopeDeclarers as
								| Record<string, ScopeDeclarer>
								| undefined}
							untyped={option.scopeUntyped?.map((u) => u.label)}
							engine={option.contextTemplate.engine}
							scopeNote="What this step supplies. A name outside it renders as nothing."
							oninput={(source) => editTemplate(option, { source })}
						/>
					</div>
					<p class="text-surface-600-400 text-xs">
						Message blocks, placement and loops. How
						each value is written out — headings, fences, JSON or
						prose — is a <strong>layout</strong>
						, set per variable below. Read variables with
						<code>&#123;&#123;&#123;x&#125;&#125;&#125;</code>
						; a double brace escapes the fences a layout writes.
					</p>

					{#if templateDirty(option)}
						<div class="flex items-center justify-end gap-2">
							<span class="text-surface-600-400 mr-auto text-xs">
								Unsaved changes
							</span>
							<button
								type="button"
								class="btn btn-sm preset-tonal-surface"
								onclick={() => {
									delete templateDrafts[option.id]
								}}
							>
								Cancel
							</button>
							<button
								type="button"
								class="btn btn-sm preset-filled-primary-500"
								onclick={() => saveTemplate(option)}
							>
								<Icons.Save size={14} /> Save
							</button>
						</div>
					{/if}
				</div>
			{/if}
		{:else if option.control === "variable-template-ref"}
			<!-- A layout is the same swappable-entity pattern as a prompt: the
			     dropdown selects the row, the editor below edits that row, and
			     a shipped one is duplicated rather than edited. The difference
			     worth knowing is that these rows are **shared between
			     pipelines** — a layout written here is offered anywhere the
			     same value is rendered, which is why the copy says so. -->
			<div class="flex items-center gap-1">
				<Select
					label={labelOverride ?? rowLabelOf(option)}
					labelHidden
					class="min-w-0 flex-1"
					options={[
						// Unset still renders: the step falls back to the layout Serene
						// Pub ships, so the prompt is never missing a section because a
						// selection went away.
						{ value: "", label: "Pipeline default" },
						...(option.choices ?? []).map((choice) => ({
							value: String(choice.id),
							label: choice.label
						}))
					]}
					value={option.value == null ? "" : String(option.value)}
					onValueChange={(raw) => {
						if (raw === "") return clear(option)
						set(option, Number(raw))
					}}
				/>
				{#if option.variableTemplate && editors}
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface shrink-0"
						title="Duplicate this layout and edit the copy"
						aria-label="Duplicate this layout and edit the copy"
						onclick={() => cloneLayout(option)}
					>
						<Icons.Copy size={14} />
					</button>
					{#if !option.variableTemplate.readOnly}
						<button
							type="button"
							class="btn btn-sm preset-tonal-surface shrink-0"
							title="Delete this layout"
							aria-label="Delete this layout"
							onclick={() => deleteLayout(option)}
						>
							<Icons.Trash2 size={14} />
						</button>
					{/if}
				{/if}
			</div>

			{#if option.variableTemplate && editors}
				{@const readOnly = option.variableTemplate.readOnly}
				<div class="bg-surface-50-950 mt-1 space-y-3 rounded-[10px] p-3">
					{#if readOnly}
						<p class="text-surface-600-400 text-xs">
							<Icons.Lock size={11} class="inline" />
							One of the layouts Serene Pub ships. Duplicate it to
							make it yours.
						</p>
					{:else}
						<label class="flex flex-col gap-1 text-xs font-medium">
							Name
							<input
								type="text"
								class="input w-full"
								value={layoutName(option)}
								oninput={(e) =>
									editLayout(option, {
										name: e.currentTarget.value
									})}
							/>
						</label>
					{/if}

					<label class="flex flex-col gap-1 text-xs font-medium">
						Layout
						<textarea
							class="textarea w-full font-mono text-xs"
							rows={readOnly ? 3 : 8}
							readonly={readOnly}
							spellcheck="false"
							value={layoutSource(option)}
							oninput={(e) =>
								editLayout(option, {
									source: e.currentTarget.value
								})}
						></textarea>
					</label>
					<p class="text-surface-600-400 text-xs">
						Handlebars. <code>
							&#123;&#123;&#123;json x 2&#125;&#125;&#125;
						</code>
						renders
						<code>x</code>
						as indented JSON; loop with
						<code>&#123;&#123;#each&#125;&#125;</code>
						to write prose instead. Layouts are shared — changing this
						one changes it in every pipeline that uses it.
					</p>

					{#if layoutDirty(option)}
						<div class="flex items-center justify-end gap-2">
							<span class="text-surface-600-400 mr-auto text-xs">
								Unsaved changes
							</span>
							<button
								type="button"
								class="btn btn-sm preset-tonal-surface"
								onclick={() => delete layoutDrafts[option.id]}
							>
								Cancel
							</button>
							<button
								type="button"
								class="btn btn-sm preset-filled-primary-500"
								onclick={() => saveLayout(option)}
							>
								<Icons.Save size={14} /> Save
							</button>
						</div>
					{/if}
				</div>
			{/if}
		{:else if option.control === "scripts-chain"}
			<!-- The chain, in run order. One value, whole-list writes: add,
			     remove and reorder each send the full id list, so the order on
			     screen is the order stored, and Reset (above) is the only way
			     back to inheriting. Rows come hydrated on the option — names
			     and badges without a second fetch — and a deleted script still
			     shows, marked, so a dangle is something to remove rather than
			     something the panel hid. -->
			{@const chain = option.scripts ?? []}
			{@const inChain = new Set(chain.map((s) => s.id))}
			<div class="flex flex-col gap-1">
				{#if !chain.length}
					<p class="text-surface-600-400 text-xs italic">
						No scripts attached.
					</p>
				{/if}
				{#each chain as entry, i (entry.id)}
					<div
						class="border-surface-200-700 flex items-center gap-1.5 rounded-lg border px-2 py-1"
					>
						<span
							class="text-surface-600-400 w-4 shrink-0 text-right font-mono text-[11px]"
						>
							{i + 1}
						</span>
						<span
							class="min-w-0 flex-1 truncate text-sm {entry.enabled &&
							!entry.missing
								? ''
								: 'opacity-50'}"
							title={entry.typeLabel}
						>
							{entry.missing
								? `Missing script (#${entry.id})`
								: entry.name}
						</span>
						{#if entry.missing}
							<span
								class="preset-tonal-error shrink-0 rounded-full px-1.5 py-0.5 text-[11px]"
							>
								deleted
							</span>
						{:else}
							{#if !entry.enabled}
								<span
									class="text-surface-600-400 shrink-0 text-[11px]"
									title="Disabled on the scripts page — keeps its place, does nothing."
								>
									off
								</span>
							{/if}
							{#if entry.blastRadius}
								<span
									class="preset-tonal-warning shrink-0 rounded-full px-1.5 py-0.5 text-[11px]"
									title="{entry.typeLabel} — what a script of this type is able to do"
								>
									{entry.blastRadius}
								</span>
							{/if}
						{/if}
						<button
							type="button"
							class="btn btn-icon btn-icon-sm preset-tonal-surface shrink-0"
							title="Move up"
							aria-label="Move up"
							disabled={i === 0}
							onclick={() => chainMove(option, i, -1)}
						>
							<Icons.ChevronUp size={12} />
						</button>
						<button
							type="button"
							class="btn btn-icon btn-icon-sm preset-tonal-surface shrink-0"
							title="Move down"
							aria-label="Move down"
							disabled={i === chain.length - 1}
							onclick={() => chainMove(option, i, 1)}
						>
							<Icons.ChevronDown size={12} />
						</button>
						<button
							type="button"
							class="btn btn-icon btn-icon-sm preset-tonal-surface shrink-0"
							title="Remove from this chain (the script itself is kept)"
							aria-label="Remove from this chain (the script itself is kept)"
							onclick={() => chainRemove(option, entry.id)}
						>
							<Icons.X size={12} />
						</button>
					</div>
				{/each}
				{#if option.choices?.some((c) => !inChain.has(c.id))}
					<Select
						label="Add a script to {labelOverride ?? option.label}"
						labelHidden
						placeholder="Add a script…"
						class="w-full"
						options={option.choices
							.filter((c) => !inChain.has(c.id))
							.map((choice) => ({
								value: String(choice.id),
								label: `${choice.label}${
									choice.description ? ` · ${choice.description}` : ""
								}`
							}))}
						bind:value={addPicks[option.id]}
						onValueChange={(raw) => {
							if (!raw) return
							chainAdd(option, raw)
							// An action, not a setting: the picker goes back to empty.
							addPicks[option.id] = ""
						}}
					/>
				{:else if !option.choices?.length}
					<p class="text-surface-600-400 text-xs">
						Nothing fits this step yet — write one on the
						<a class="underline" href="/admin/scripts">
							scripts page
						</a>
						.
					</p>
				{/if}
				{#if option.connectionScripts?.entries.length}
					<!-- The effective view's other half (18 §4c): guards the
					     run's connection carries join the same stop union, so
					     the card shows the merged truth with provenance. -->
					<div class="mt-1 flex flex-col gap-1">
						<p class="text-surface-600-400 text-[11px]">
							<Icons.Plug size={11} class="inline" />
							From connection
							<strong>
								{option.connectionScripts.connectionName}
							</strong>
							— managed in the connection's settings:
						</p>
						{#each option.connectionScripts.entries as s (s.id)}
							<div
								class="border-surface-200-700 flex items-center gap-2 rounded-lg border border-dashed px-2 py-1"
							>
								<span
									class="min-w-0 flex-1 truncate text-sm {s.enabled
										? ''
										: 'opacity-50'}"
								>
									{s.name}
								</span>
								{#if !s.enabled}
									<span class="text-surface-600-400 text-[11px]">
										off
									</span>
								{/if}
								<span
									class="preset-tonal-surface shrink-0 rounded-full px-1.5 py-0.5 text-[11px]"
								>
									connection
								</span>
							</div>
						{/each}
					</div>
				{/if}
				{#if option.choices?.length}
					<a
						class="text-surface-600-400 text-xs underline"
						href="/admin/scripts"
					>
						Manage scripts
					</a>
				{/if}
			</div>
		{:else if option.control === "connection-ref" && option.choices}
			<!-- The Model: ONE grouped list (owner rulings 2026-09-30) —
			     connections are the groups, their models the rows, and one
			     pick writes both halves of the pair (0114). Connections have no
			     default model, so a legacy bare endpoint matches no row and the
			     control asks for one until somebody picks.

			     A connection that cannot do this call is LISTED and greyed with
			     its reason, and so are a disabled or no-longer-listed model: a
			     slot pointed at one has to still show what it points at, and
			     why it will refuse. -->
			{@const chosenId = slotConnectionId(option.value)}
			{@const chosenModelId = slotModelId(option.value)}
			{@const chosenModel =
				option.choices
					.find((c) => c.id === chosenId)
					?.models?.find((m) => m.id === chosenModelId) ?? null}
			<Select
				label={labelOverride ?? rowLabelOf(option)}
				labelHidden
				class="w-full"
				placeholder="Choose a model"
				options={[
					// The first choice names what "unset" resolves to, from
					// where this viewer stands; choosing it is Reset.
					{
						value: "",
						label: option.inherits?.label ?? "Pub default"
					},
					...option.choices.flatMap((c) =>
						c.models?.length
							? c.models.map((m) => ({
									value: `${c.id}:${m.id}`,
									label: m.name,
									group: c.label,
									disabled:
										!!c.disabled ||
										!m.enabled ||
										m.missingSince != null,
									hint: c.disabled
										? c.reason
										: m.missingSince
											? "No longer listed by its host"
											: !m.enabled
												? "Switched off"
												: c.reason || undefined
								}))
							: [
									{
										value: `${c.id}:`,
										label: c.label,
										group: c.label,
										disabled: !!c.disabled,
										hint: c.reason || undefined
									}
								]
					)
				]}
				value={chosenId == null
					? ""
					: `${chosenId}:${chosenModelId ?? ""}`}
				onValueChange={(raw) => {
					if (raw === "") return clear(option)
					const [connectionId, modelId] = raw.split(":")
					set(
						option,
						connectionSlotValue(
							Number(connectionId),
							modelId ? Number(modelId) : null
						)
					)
				}}
			/>
			{#if chosenModel?.missingSince}
				<p class="text-warning-700-300 flex items-center gap-1 text-xs">
					<Icons.TriangleAlert size={12} aria-hidden="true" />
					This model is no longer listed by its host, so this call will
					refuse to run. Pick another, or refresh the connection once
					the host serves it again.
				</p>
			{:else if chosenModel && !chosenModel.enabled}
				<p class="text-warning-700-300 flex items-center gap-1 text-xs">
					<Icons.TriangleAlert size={12} aria-hidden="true" />
					This model is switched off, so this call will refuse to run.
				</p>
			{/if}
		{:else if option.choices}
			<!-- A reference: sampling configs and the like. The server sends
			     what this option may point at, already narrowed to the
			     namespace and the declared shape — so this renders the list
			     and never decides what belongs in it. -->
			<Select
				label={labelOverride ?? rowLabelOf(option)}
				labelHidden
				class="w-full"
				options={[
					// The first choice names what "unset" resolves to; choosing
					// it is Reset.
					{
						value: "",
						label:
							option.inherits?.label ??
							(option.control === "sampling-ref"
								? "Pub default"
								: "None")
					},
					...option.choices.map((choice) => ({
						value: String(choice.id),
						label: `${choice.label}${
							choice.description ? ` · ${choice.description}` : ""
						}`,
						disabled: !!choice.disabled,
						hint: choice.reason || undefined
					}))
				]}
				value={option.value == null ? "" : String(option.value)}
				onValueChange={(raw) => {
					if (raw === "") return clear(option)
					set(option, Number(raw))
				}}
			/>
		{:else if option.control === "list"}
			<!-- An ordered list of rows, rendered from the ELEMENT's own
			     declaration. Nothing here knows what a prompt block is: the
			     labels, the options a row may take and which member is the
			     on/off switch all arrive on `option.item`, so a plugin
			     declaring `type: 'list'` gets this editor with no change.

			     Reorder by the buttons or by dragging; both write the whole
			     list, because the order is the value. The changed dot and
			     Reset above are the ordinary ones — this option participates
			     like any other, so putting the list back where it started
			     stores nothing at all. -->
			{@const rows = listRows(option)}
			{@const idField = listIdField(option)}
			{@const available = listAvailable(option)}
			<div class="flex flex-col gap-1">
				{#if !rows.length}
					<p class="text-surface-600-400 text-xs italic">
						Nothing in this list.
					</p>
				{/if}
				<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
				<div role="list" class="flex flex-col gap-1">
					{#each rows as row, i (`${String(row[idField?.key ?? "id"] ?? i)}`)}
						{@const enabled = (option.item?.fields ?? []).every(
							(f) =>
								f.control !== "boolean" || row[f.key] !== false
						)}
						<div
							class="border-surface-200-700 flex items-center gap-1.5 rounded-lg border px-2 py-1
						{listDrag?.optionId === option.id && listDrag.from === i ? 'opacity-40' : ''}"
							draggable="true"
							role="listitem"
							ondragstart={() =>
								(listDrag = { optionId: option.id, from: i })}
							ondragend={() => (listDrag = null)}
							ondragover={(e) => {
								if (listDrag?.optionId === option.id)
									e.preventDefault()
							}}
							ondrop={(e) => {
								e.preventDefault()
								if (listDrag?.optionId !== option.id) return
								listMove(option, listDrag.from, i)
								listDrag = null
							}}
						>
							<span
								class="text-surface-600-400 w-4 shrink-0 cursor-grab text-right font-mono text-[11px]"
								aria-hidden="true"
							>
								{i + 1}
							</span>
							<span
								class="min-w-0 flex-1 truncate text-sm {enabled
									? ''
									: 'opacity-50'}"
							>
								{listRowLabel(option, row)}
							</span>
							{#each option.item?.fields ?? [] as field (field.key)}
								{#if field.control === "boolean"}
									<label
										class="flex shrink-0 items-center gap-1 text-[11px]"
										title={field.label}
									>
										<input
											type="checkbox"
											class="checkbox"
											checked={row[field.key] !== false}
											onchange={(e) =>
												listSet(
													option,
													i,
													field.key,
													e.currentTarget.checked
												)}
										/>
									</label>
								{:else if field.control === "integer" || field.control === "number"}
									<input
										type="number"
										class="input w-16 shrink-0 text-xs"
										aria-label={field.label}
										value={row[field.key] == null
											? ""
											: String(row[field.key])}
										onchange={(e) => {
											const n =
												field.control === "integer"
													? parseInt(
															e.currentTarget
																.value,
															10
														)
													: parseFloat(
															e.currentTarget
																.value
														)
											if (!Number.isNaN(n))
												listSet(option, i, field.key, n)
										}}
									/>
								{/if}
							{/each}
							<button
								type="button"
								class="btn btn-icon btn-icon-sm preset-tonal-surface shrink-0"
								title="Move up"
								aria-label="Move up"
								disabled={i === 0}
								onclick={() => listMove(option, i, i - 1)}
							>
								<Icons.ChevronUp size={12} />
							</button>
							<button
								type="button"
								class="btn btn-icon btn-icon-sm preset-tonal-surface shrink-0"
								title="Move down"
								aria-label="Move down"
								disabled={i === rows.length - 1}
								onclick={() => listMove(option, i, i + 1)}
							>
								<Icons.ChevronDown size={12} />
							</button>
							<button
								type="button"
								class="btn btn-icon btn-icon-sm preset-tonal-surface shrink-0"
								title="Remove from this list"
								aria-label="Remove from this list"
								onclick={() => listRemove(option, i)}
							>
								<Icons.X size={12} />
							</button>
						</div>
					{/each}
				</div>
				{#if available.length}
					<Select
						label="Add to {labelOverride ?? option.label}"
						labelHidden
						placeholder="Add…"
						class="w-full"
						options={available.map((choice) => ({
							value: choice.key,
							label: choice.label
						}))}
						bind:value={addPicks[option.id]}
						onValueChange={(key) => {
							if (!key) return
							listAdd(option, key)
							addPicks[option.id] = ""
						}}
					/>
				{/if}
			</div>
		{:else if option.control === "string[]"}
			<!-- One per line: the values are stop sequences and the
			     like, which routinely contain commas. -->
			<textarea
				id="opt-{option.id}"
				class="textarea w-full"
				rows="3"
				placeholder="One per line"
				value={drafts[option.id] ??
					(Array.isArray(option.value)
						? option.value.join("\n")
						: "")}
				oninput={(e) => (drafts[option.id] = e.currentTarget.value)}
				onblur={(e) => {
					const lines = e.currentTarget.value
						.split("\n")
						.map((l) => l.trim())
						.filter(Boolean)
					if (!lines.length) clear(option)
					else set(option, lines)
				}}
			></textarea>
		{:else}
			<input
				id="opt-{option.id}"
				type="text"
				class="input w-full"
				value={drafts[option.id] ??
					(option.value == null ? "" : String(option.value))}
				oninput={(e) => (drafts[option.id] = e.currentTarget.value)}
				onchange={(e) => set(option, e.currentTarget.value)}
			/>
		{/if}
		{#if option.writable}
			{@render provenanceLine(option)}
		{/if}
	</div>
{/snippet}

{#snippet provenanceLine(option: Sockets.Pipelines.Option)}
	<!-- Where the value in force came from, in one muted line under the
	     control (owner rulings 2026-09-30): the server says it for a Model or
	     Sampling row; any other row says it only once somebody set it. The
	     changed dot is the configuration's deviation (ruled 2026-09-10), and
	     Reset removes the row at the scope this panel writes. -->
	{@const line = provenanceOf(option)}
	{#if line || option.changed || option.overriddenHere}
		<p
			class="text-surface-600-400 flex flex-wrap items-center gap-x-2 text-xs"
			data-provenance
		>
			{#if option.changed}
				<span
					class="bg-primary-500 size-1.5 shrink-0 rounded-full"
					title="Changed — this configuration departs from the pipeline's default here."
					data-changed-dot
					aria-hidden="true"
				></span>
				<span class="sr-only">Changed.</span>
			{/if}
			{#if line}
				<span>{line}</span>
			{/if}
			{#if option.overriddenHere}
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface min-h-11 text-xs pointer-fine:min-h-0"
					onclick={() => clear(option)}
					title="Remove this value and go back to what it inherits"
				>
					<Icons.RotateCcw size={12} aria-hidden="true" /> Reset
				</button>
			{/if}
		</p>
	{/if}
{/snippet}

{#snippet groupSwitch(
	group: Sockets.Pipelines.SettingsGroup,
	enabled: Sockets.Pipelines.Option
)}
	{@const on = enabled.value !== false}
	<!-- The model call's own switch, in the block's header: named by the
	     block, with its state in words beside it (never colour alone). -->
	<label
		class="ml-auto flex min-h-11 shrink-0 cursor-pointer items-center gap-2 text-xs pointer-fine:min-h-0"
		data-option-id={enabled.id}
	>
		<span aria-hidden="true">{on ? "On" : "Off"}</span>
		<input
			type="checkbox"
			role="switch"
			class="group-switch"
			aria-label={group.heading ?? detail?.name ?? "Enabled"}
			checked={on}
			disabled={!enabled.writable}
			onchange={(e) => set(enabled, e.currentTarget.checked)}
		/>
	</label>
{/snippet}

{#snippet groupBlock(group: Sockets.Pipelines.SettingsGroup)}
	{@const headed = !!group.heading}
	<!-- One model call and what serves it — or the whole pipeline — as a
	     tonal inset: a card boundary, never a smaller font (§3.3). -->
	<section
		class="flex min-w-0 flex-col gap-3 {headed
			? 'bg-surface-50-950 rounded-[10px] p-3'
			: ''}"
		data-settings-group={group.kind}
		aria-labelledby={headed ? headingId(group.key) : undefined}
	>
		{#if headed || group.enabled}
			<header class="flex flex-wrap items-center gap-x-3 gap-y-1">
				{#if headed}
					<h4
						id={headingId(group.key)}
						class="min-w-0 text-sm font-medium break-words"
						data-group-heading
					>
						{group.heading}
					</h4>
				{/if}
				{#if group.enabled}
					{@render groupSwitch(group, group.enabled)}
				{/if}
			</header>
		{/if}
		{#if group.purpose}
			<p class="text-surface-600-400 text-[13px]" data-group-purpose>
				{group.purpose}
			</p>
		{/if}
		{#if group.enabled?.value === false}
			<p class="text-surface-600-400 text-xs">
				Off: this part does not run.
			</p>
		{/if}
		{#if group.front.length}
			<div class="flex flex-col gap-3" data-group-front>
				{#each frontRuns(group.front) as run (run[0]!.id)}
					{#if run.length > 1}
						<!-- Model and Sampling side by side on a wide view. -->
						<div class="grid gap-3 @lg/view:grid-cols-2">
							{#each run as o (o.id)}
								{@render optionRow(o)}
							{/each}
						</div>
					{:else}
						{@render optionRow(run[0]!)}
					{/if}
				{/each}
			</div>
		{/if}
		{#if group.advanced.length}
			<!-- Everything that is not a front choice, one fieldset per step,
			     in spine order. The summary always counts what changed, so a
			     deviation is never hidden by the fold. -->
			<details
				class="advanced-fold"
				open={openFolds.has(group.key)}
				ontoggle={(e) => {
					if (e.currentTarget.open) openFolds.add(group.key)
					else openFolds.delete(group.key)
				}}
			>
				<summary
					class="text-surface-700-300 flex min-h-11 cursor-pointer items-center gap-1.5 text-xs font-medium select-none pointer-fine:min-h-8"
				>
					<Icons.ChevronRight
						size={14}
						class="fold-chevron shrink-0 transition-transform"
						aria-hidden="true"
					/>
					{advancedSummary(group)}
				</summary>
				<div class="mt-2 flex flex-col gap-3">
					{#each group.advanced as st (st.key)}
						<fieldset
							class="border-surface-200-800 flex min-w-0 flex-col gap-3 rounded-[10px] border p-3"
						>
							<legend class="px-1 text-xs font-medium">
								{st.heading}
							</legend>
							{#each st.options as o (o.id)}
								{@render optionRow(o)}
							{/each}
						</fieldset>
					{/each}
				</div>
			</details>
		{/if}
	</section>
{/snippet}

{#snippet groupList()}
	<div class="flex flex-col gap-3">
		{#each groups as group (group.key)}
			{@render groupBlock(group)}
		{/each}
	</div>
{/snippet}

{#if !detail}
	{#if mode !== "session"}
		<p class="text-surface-600-400 p-4 text-sm">Loading…</p>
	{/if}
{:else if mode === "session"}
	<!-- A session's settings: one card per pipeline, drawn only when it has
	     something a session sets (owner rulings 2026-09-30). -->
	{#if groups.length}
		<!-- Closed to start with when asked, and always once the session's
		     values here are read-only (its creation pipeline, created). -->
		{#if collapsed || readOnlyBecause}
			<details class="advanced-fold panel-card" data-pipeline-card>
				<summary
					class="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-2 select-none"
				>
					<Icons.ChevronRight
						size={16}
						class="fold-chevron shrink-0 transition-transform"
						aria-hidden="true"
					/>
					<span class="text-sm font-medium" data-card-title>
						{title ?? detail.name}
					</span>
					{#if cardSummary}
						<span class="text-surface-600-400 min-w-0 truncate text-xs">
							{cardSummary}
						</span>
					{/if}
				</summary>
				<div class="mt-3 flex flex-col gap-3">
					{@render readOnlyNote()}
					{@render groupList()}
					{@render moreInPipelines()}
				</div>
			</details>
		{:else}
			<section class="panel-card flex flex-col gap-3" data-pipeline-card>
				<h4 class="text-sm font-medium" data-card-title>
					{title ?? detail.name}
				</h4>
				{@render readOnlyNote()}
				{@render groupList()}
				{@render moreInPipelines()}
			</section>
		{/if}
	{/if}
{:else if mode === "builder" && stepKey != null}
	<!-- The builder shows one step at a time; its host titles it. -->
	{#if builderStep}
		<div class="inspector-pane">
			<section
				class="option-rows panel-card flex flex-col gap-3 !p-3"
				data-settings-step
			>
				{#each builderStep.options as o (o.id)}
					{@render optionRow(
						o,
						o.control === "boolean" && o.label === o.step.heading
							? o.label
							: undefined
					)}
				{/each}
			</section>
		</div>
	{:else}
		<p class="text-surface-600-400 p-4 text-sm">
			This step has nothing to configure.
		</p>
	{/if}
{:else}
	{#if mode === "config"}
		<p class="text-surface-600-400 mb-3 text-xs" data-scope-note>
			{scopeNote}
		</p>

		{#if detail.configs.length}
			<div class="panel-card mb-3 space-y-2 !p-3">
				<p class="text-sm font-medium" aria-hidden="true">Configuration</p>
				{#if detail.canSelectConfig}
					<Select
						label="Configuration"
						labelHidden
						class="w-full"
						options={detail.configs.map((c) => ({
							value: String(c.id),
							label: `${c.isDefault ? "★ " : ""}${c.name}${
								c.enabled ? "" : " (withdrawn)"
							}`
						}))}
						value={detail.selectedConfig
							? String(detail.selectedConfig.id)
							: ""}
						onValueChange={(v) => {
							if (v) chooseConfig(v)
						}}
					/>
				{:else if readOnlyBecause}
					<!-- The session's choice, no longer changeable: the scope
					     note above says why. -->
					<p class="text-sm">
						{detail.selectedConfig?.name ?? "—"}
					</p>
				{:else}
					<!-- Not a disabled control: outside a session the selection is
					     the instance's, and that one is the administrator's. -->
					<p class="text-sm">
						{detail.selectedConfig?.name ?? "—"}
					</p>
					<p class="text-surface-600-400 text-xs">
						Chosen for this pub by an administrator. Open a session
						to choose a different one there.
					</p>
				{/if}
			</div>
		{/if}
	{/if}

	{@render groupList()}
{/if}

{#snippet readOnlyNote()}
	{#if readOnlyBecause}
		<p class="text-surface-600-400 text-xs" data-scope-note>
			{readOnlyBecause}
		</p>
	{/if}
{/snippet}

{#snippet moreInPipelines()}
	{#if isAdmin}
		<a
			class="text-primary-700-300 inline-flex min-h-11 items-center gap-1 self-start text-xs underline pointer-fine:min-h-0"
			href="/admin/pipelines/{encodeURIComponent(slug)}"
		>
			More settings in Pipelines
			<Icons.ArrowRight size={12} aria-hidden="true" />
		</a>
	{/if}
{/snippet}

<style>
	.inspector-pane {
		container-type: inline-size;
	}
	/* The builder's one step flows two columns only when this panel's own
	   host is wide; a row never splits. */
	@container (min-width: 66rem) {
		.option-rows {
			display: block;
			columns: 2;
			column-gap: 1.5rem;
		}
		.option-rows > :global(*) {
			break-inside: avoid;
			margin-bottom: 0.75rem;
		}
	}

	details[open] > summary :global(.fold-chevron) {
		transform: rotate(90deg);
	}
	.advanced-fold > summary {
		list-style: none;
	}
	.advanced-fold > summary::-webkit-details-marker {
		display: none;
	}

	/* The block header's switch: a track and a thumb, the Skeleton Switch's
	   look (filled primary when on, §2.4) on a native checkbox so its role
	   and name are the platform's. */
	.group-switch {
		appearance: none;
		position: relative;
		inline-size: 2.25rem;
		block-size: 1.25rem;
		flex-shrink: 0;
		border-radius: 9999px;
		background: var(--color-surface-500);
		cursor: pointer;
		transition: background-color 150ms;
	}
	.group-switch::after {
		content: "";
		position: absolute;
		inset-block-start: 2px;
		inset-inline-start: 2px;
		inline-size: 1rem;
		block-size: 1rem;
		border-radius: 9999px;
		background: var(--color-surface-50);
		transition: transform 150ms;
	}
	.group-switch:checked {
		background: var(--color-primary-500);
	}
	.group-switch:checked::after {
		transform: translateX(1rem);
	}
	.group-switch:disabled {
		cursor: default;
		opacity: 0.6;
	}
	.group-switch:focus-visible {
		outline: 2px solid var(--color-primary-500);
		outline-offset: 2px;
	}
</style>
