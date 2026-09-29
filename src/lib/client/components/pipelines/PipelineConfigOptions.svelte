<script lang="ts">
	/**
	 * One pipeline's configuration, rendered from declarations — the body of
	 * the pipeline view (05 §0a), extracted so any surface can host it: the
	 * Pipelines sidebar, and the graph builder page's step controls.
	 *
	 * Everything here arrives from the server as declarations — label,
	 * control, range, options, current value, which layer it came from — and
	 * this file renders whatever arrives. Options come grouped by step, in
	 * run order, one card per step, with the tuning parameters split into a
	 * collapsed "Advanced" block; the grouping is the server's, this file
	 * never derives it. A non-admin receives only what is theirs to touch
	 * (prompts), so the same render serves both audiences without a role
	 * check anywhere in this file.
	 *
	 * Writes carry no scope (the layer simplification, 2026-08-24): inside a
	 * session they land at the session's override, and globally they land in the
	 * selected configuration itself — the server resolves which, and refuses
	 * a shipped configuration with the duplicate suggestion.
	 *
	 * Socket events are shared channels, so every listener filters by slug:
	 * two of these panels showing different pipelines must not clobber each
	 * other's responses.
	 */
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { onMount } from "svelte"
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

	interface Props {
		slug: string
		/** Set when hosted inside a session — writes land at session scope. */
		sessionId?: number
		/** Announce where edits land ("Changes here apply to you"). */
		showScopeNote?: boolean
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
		 * Fold the tuning options in with everything else instead of hiding
		 * them behind a door.
		 *
		 * The sidebar's job is to be simple for someone who does not know what
		 * a pipeline is, so it leads with the prompt and puts the rest away.
		 * The builder is the opposite surface — granular on purpose — and a
		 * collapsed drawer there is just an extra click before the work.
		 */
		granular?: boolean
		/** The builder brings its own, with save/duplicate/rename/delete. */
		showConfigPicker?: boolean
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
		 * Show only the reference/enum *selectors* — connection, sampling,
		 * prompt, template, mode enums — and drop the advanced tuning block and
		 * the inline prompt/template edit fields. For a surface that lets
		 * someone pick which prompt or connection a chat uses without exposing
		 * the wording or the weights: "just the selectors."
		 */
		selectorsOnly?: boolean
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
		showScopeNote = true,
		onLoaded,
		stepKey,
		granular = false,
		showConfigPicker = true,
		editsConfigId,
		selectorsOnly = false,
		onDraftSet,
		onDraftClear,
		pending,
		pendingClears
	}: Props = $props()

	/** Draft mode is simply "the host gave us somewhere to put edits". */
	const draftMode = $derived(!!onDraftSet)

	/** The controls that are pure selectors — what `selectorsOnly` keeps. */
	const SELECTOR_CONTROLS = new Set([
		"enum",
		"prompts-ref",
		"context-template-ref",
		"variable-template-ref",
		"connection-ref",
		"sampling-ref"
	])

	const socket = useTypedSocket()

	let detail = $state<Sockets.Pipelines.NamespaceDetail | null>(null)

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

	const scopeLabel = $derived(
		detail?.writeScope === "session" ? "this session" : "everyone"
	)

	/**
	 * What the provenance badge says. Only shown when it is not this scope.
	 *
	 * Keyed by the union rather than by `string`, so a sixth scope fails to
	 * compile here instead of reaching a user as the raw id. These are the
	 * viewer's relationship to a value — "your value", "set by an admin" — not
	 * domain vocabulary a plugin owns, so they belong in the panel; what did not
	 * belong was the absence of any check that they were complete.
	 */
	const SOURCE_LABEL: Record<Sockets.Pipelines.Option["source"], string> = {
		session: "from this session",
		config: "from the selected configuration",
		author: "default"
	}

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
		// A shared channel: another panel's pipeline is not this one's.
		if (!res.pipeline || res.pipeline.slug !== slug) return
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
		const opt = res.pipeline.steps
			.flatMap((s) => [...s.options, ...s.advanced])
			.find((o) => o.id === optionId)
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
		const opt = res.pipeline.steps
			.flatMap((s) => [...s.options, ...s.advanced])
			.find((o) => o.id === optionId)
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
		const opt = res.pipeline.steps
			.flatMap((s) => [...s.options, ...s.advanced])
			.find((o) => o.id === optionId)
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
	 * What the sidebar shows, and in what order.
	 *
	 * Grouped by **facet** rather than by step. The panel used to render one
	 * numbered card per node — "Build template context", "Rank hybrid",
	 * "Assemble" — which is the order the machine works in and not a thing
	 * anybody came here to think about. Worse, it split settings that belong
	 * together: the twelve layout pickers live on two different nodes purely
	 * because assembly lays out lore *after* budgeting decided what fit, so
	 * they appeared under two separate headings for a reason no user has.
	 *
	 * A facet says what kind of setting something is, and it is already on the
	 * declaration. Grouping on it also keeps 05 §0a's boundary intact — a facet
	 * names a kind, never a node key, a count, or an order.
	 */
	/**
	 * ⚠ This was a hardcoded list here, and it was not a fallback — it was the
	 * *filter*. Options were matched into it, so a facet the client had never
	 * heard of matched no group and rendered **nowhere**: a plugin's settings
	 * could exist, be writable, and be invisible. The headings, their order and
	 * which of them lead the panel are declared now, and an undeclared facet
	 * still gets a group rather than disappearing.
	 *
	 * Two facets that resolve to the same heading are one group — that is how
	 * `connection` and `sampling` become "Model" without the client pairing
	 * them.
	 */
	const FACET_GROUPS = $derived.by<
		Array<{ facets: string[]; label: string }>
	>(() => {
		const byLabel = new Map<string, { facets: string[]; label: string }>()
		for (const f of detail?.facets ?? []) {
			const g = byLabel.get(f.label)
			if (g) g.facets.push(f.id)
			else byLabel.set(f.label, { facets: [f.id], label: f.label })
		}
		return [...byLabel.values()]
	})

	/** The sidebar leads with these and puts the rest behind one door. */
	const SIMPLE_FACETS = $derived(
		(detail?.facets ?? []).filter((f) => f.simple).map((f) => f.id)
	)

	/**
	 * The draft overlaid onto what renders (22 §2.1): a pending value shows as
	 * the value, a pending reset shows as the inherited default. The overlay
	 * lives at this one derivation so every read downstream — rows, groups,
	 * controls — sees the draft without knowing it exists.
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

	/** One step in the builder's inspector; all of them in the sidebar. */
	const visibleSteps = $derived.by(() => {
		if (!detail) return []
		const steps =
			stepKey != null
				? detail.steps.filter((s) => s.key === stepKey)
				: detail.steps
		if (!draftMode) return steps
		return steps.map((s) => ({
			...s,
			options: s.options.map(overlay),
			advanced: s.advanced.map(overlay)
		}))
	})

	/**
	 * Options paired with the step they came from.
	 *
	 * The step name rides alongside rather than on the option itself: it is only
	 * needed to tell two same-named options apart, and adding it to the payload
	 * would mean exempting a new field from the node-key scan in
	 * `panel/index.int.test.ts` — a guard worth keeping narrow. The step is
	 * already in hand here.
	 */
	type Row = { option: Sockets.Pipelines.Option; step: string }

	const rowsOf = (
		pick: (s: Sockets.Pipelines.Step) => Sockets.Pipelines.Option[]
	) =>
		visibleSteps.flatMap((s) =>
			pick(s).map((option) => ({ option, step: s.label }))
		)

	/** Everything the step declares, once the door is gone. */
	const allOf = (s: Sockets.Pipelines.Step) => [...s.options, ...s.advanced]

	/**
	 * Grouped by the step that consumes the setting, then by facet inside it.
	 *
	 * Facet alone was wrong the moment a pipeline had more than one LLM step.
	 * The graph builder has five, each with its own prompt, connection and
	 * sampling — so a pure facet grouping produced one "Prompt" heading with
	 * five near-identical rows under it, every one needing its step name
	 * prefixed back on to be told apart. That is the step heading, reinvented
	 * as a prefix and worse.
	 *
	 * The step is the consumer, and the consumer is what someone is actually
	 * choosing between ("which prompt does the *pre-filter* use"). Facets
	 * subdivide it.
	 */
	/**
	 * Show the rest of a step's settings.
	 *
	 * Per step, not global: opening the tuning on one node says nothing about
	 * whether you want it on the next, and a single flag would keep re-opening
	 * panels you had put away.
	 */
	let showAll = $state<Record<string, boolean>>({})

	/**
	 * One step's settings, grouped into facet rows. Shared by the numbered
	 * spine list (`stepGroups`) and the trailing, unnumbered "Also
	 * configured here" group (`alsoConfiguredGroups`) — an envoy's settings
	 * are laid out exactly like a step's, they are simply not counted as one.
	 */
	const groupsOf = (steps: Sockets.Pipelines.Step[]) =>
		steps
			.map((step) => {
				const base = granular ? allOf(step) : step.options
				// Selectors-only drops everything but the reference/enum
				// pickers, and with them the quick/rest disclosure — a handful
				// of dropdowns needs no door. The review gate is a selector by
				// control but is not a "which model/prompt" choice, so it is
				// excluded here too.
				const all = selectorsOnly
					? base.filter(
							(o) =>
								SELECTOR_CONTROLS.has(o.control) &&
								o.facet !== "review"
						)
					: base
				// The author's answer to "which of these does anyone change",
				// not a guess from control kind or position. A step whose
				// settings are *all* quick, or none, gets no disclosure — a
				// "show 0 more" is worse than no affordance at all.
				const quick = all.filter((o) => o.quick)
				const rest = all.filter((o) => !o.quick)
				const open = showAll[step.key] ?? false
				const pool =
					!selectorsOnly && quick.length && rest.length && !open
						? quick
						: all
				const facets = FACET_GROUPS.filter(
					(g) =>
						granular ||
						g.facets.some((f) => SIMPLE_FACETS.includes(f))
				)
					.map((g) => ({
						label: g.label,
						rows: pool
							.filter((o) => g.facets.includes(o.facet))
							.map((option) => ({ option, step: step.label }))
					}))
					.filter((g) => g.rows.length)
				return {
					key: step.key,
					label: step.label,
					facets,
					hidden:
						!selectorsOnly && quick.length && rest.length && !open
							? rest.length
							: 0,
					canCollapse:
						!selectorsOnly &&
						!!(quick.length && rest.length && open),
					count: facets.reduce((n, f) => n + f.rows.length, 0)
				}
			})
			.filter((g) => g.count > 0)

	const stepGroups = $derived(groupsOf(visibleSteps))

	/**
	 * An envoy's settings (plans/29 R-18 (2); U5g review follow-up): not a
	 * step of anything that runs, so it is excluded from the builder's
	 * single-step inspector (`stepKey` set) the same way `visibleSteps`
	 * excludes every other step but the one named.
	 */
	const visibleAlsoConfigured = $derived.by(() => {
		if (!detail || stepKey != null) return []
		if (!draftMode) return detail.alsoConfigured
		return detail.alsoConfigured.map((s) => ({
			...s,
			options: s.options.map(overlay),
			advanced: s.advanced.map(overlay)
		}))
	})
	const alsoConfiguredGroups = $derived(groupsOf(visibleAlsoConfigured))

	/**
	 * A sub-heading earns its place only when the step has more than one kind
	 * of setting. A lone "Prompt" caption under a step that declares nothing
	 * else is a line of furniture between the reader and the one control.
	 */
	const showFacetHeadings = (g: { facets: unknown[] }) => g.facets.length > 1

	/**
	 * Everything else, behind one door instead of seven.
	 *
	 * These are per-step tuning — weights, budgets, thresholds, raw templates,
	 * layouts. They belong in the pipeline builder, where settings are granular
	 * and per-pipeline on purpose; this panel is for people who do not need to
	 * know what a pipeline is. They stay reachable here until the builder can
	 * host them, because moving them out first would take away settings with
	 * nowhere to go.
	 */
	const tuning = $derived(
		granular || selectorsOnly ? [] : rowsOf((s) => s.advanced)
	)

	/**
	 * Once the step headings are gone, two options can arrive under one heading
	 * with the same name — the reply pipeline has two "Review" gates, and
	 * `weights` alone carries two "Budget", two "Weight" and two "Min Include".
	 * The step name is what tells them apart, so put it back, but only on the
	 * ones that actually collide: prefixing every row would be noise for the
	 * ones that read fine on their own.
	 */
	const qualify = (row: Row, pool: Row[]) =>
		pool.filter((r) => r.option.label === row.option.label).length > 1
			? `${row.step} — ${row.option.label}`
			: row.option.label
</script>

{#snippet optionRow(
	option: Sockets.Pipelines.Option,
	/** Overrides the label where two options in one group share a name. */
	labelOverride?: string
)}
	<!-- The wrapper carries the option's address so a host's search or diff
	     view can scroll to it (22 §2.3/§2.6). -->
	<div class="flex flex-col gap-1" data-option-id={option.id}>
		<div class="flex items-center justify-between gap-2">
			<label
				class="min-w-0 flex-1 truncate text-sm font-medium"
				for="opt-{option.id}"
			>
				{labelOverride ?? option.label}
			</label>

			{#if draftMode && isPending(option.id)}
				<span
					class="preset-tonal-warning shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
					title="Unsaved — lands with Save all"
				>
					pending
				</span>
			{/if}

			<!--
				The changed marker (ruled 2026-09-10).

				A configuration stores **deviations**: it holds a row only where
				somebody departed from the shipped default, so `changed` is that
				row's existence and this dot is the whole of what provenance
				means now. It is worth a mark precisely because it is rare — the
				old model materialized every declared value into every config,
				so a "this was set" mark would have been on every field in the
				panel, which is the same as being on none.

				Beside the Reset button rather than instead of it: outside a
				session the two coincide and the pair reads as "changed, and
				here is the undo", while INSIDE one they are different facts —
				Reset clears your session's own value and this says the
				configuration underneath it was tuned for everyone.
			-->
			{#if option.changed}
				<span
					class="bg-primary-500 mt-1.5 size-1.5 shrink-0 rounded-full"
					title="Changed — this configuration departs from the shipped default here."
				></span>
			{/if}

			<!-- Provenance, but only when it is worth a word.
			     "your value" on every field is noise; "set by an
			     admin" on the one field that is not doing what
			     you expect is the whole answer. -->
			{#if option.overriddenHere}
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface shrink-0 text-xs"
					onclick={() => clear(option)}
					title="Remove this value and go back to what it inherits"
				>
					<Icons.RotateCcw size={12} /> Reset
				</button>
			{:else if option.source !== "author" && !option.changed}
				<!--
					A dot, not a sentence.

					"from the selected config" on every row is a hundred-odd
					pixels of the same words repeated down the panel — at rail
					width it crowds out the control it annotates. The wording
					moves to the tooltip, where it is available and not in the
					way.

					⚠ `&& !option.changed` because the two used to be the same
					mark. A value whose source is `preset` is a value the
					configuration holds a row for, which is now exactly what the
					changed dot above says — so without the guard every
					deviation would carry two dots meaning one thing. What is
					left here is the case they do not share: a value inherited
					from somewhere that is neither this configuration nor the
					declaration.
				-->
				<span
					class="bg-secondary-500 mt-1.5 size-1.5 shrink-0 rounded-full"
					title="{SOURCE_LABEL[option.source] ??
						option.source} — changing it here overrides that."
				></span>
			{/if}
		</div>

		{#if option.description}
			<!--
				A hint, kept but not shouted.
				
				Four settings with two-line descriptions is most of a 400px
				rail, and the descriptions are read once and then never again —
				whereas the controls are read every time. Smaller and dimmer
				keeps them available for the first read without spending the
				panel on them forever. `title` carries the full text for anyone
				who needs it at any size.
			-->
			<p
				class="text-surface-600-400 text-[11px] leading-snug"
				title={option.description}
			>
				{option.description}
			</p>
		{/if}

		{#if !option.writable}
			<p class="text-surface-600-400 text-xs italic">
				{option.value ? String(option.value) : "—"}
				<span class="not-italic">(admin only)</span>
			</p>
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

			     Grouped exactly the way the context-template picker below is,
			     and for the same reason: prompts are pooled by the STEP that
			     consumes them rather than by pipeline, so a row written while
			     configuring one pipeline is genuinely offered in another that
			     reuses the step. The grouping is ordering, never permission —
			     the entire reason a prompt is not spec-scoped is that a row
			     from elsewhere works here. -->
			{@const promptGroups = [
				{ key: "usedHere", label: "Used in this pipeline" },
				{ key: "shipped", label: "Serene Pub ships" },
				{ key: "alsoFits", label: "Also fits (from other pipelines)" }
			]}
			<div class="flex items-center gap-1">
				<Select
					label={labelOverride ?? option.label}
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
				{#if !selectorsOnly}
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
				{#if option.prompt && !selectorsOnly}
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

			{#if option.prompt && !selectorsOnly}
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
					label={labelOverride ?? option.label}
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
				{#if option.contextTemplate && !selectorsOnly}
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

			{#if option.contextTemplate && !selectorsOnly}
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
					label={labelOverride ?? option.label}
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
				{#if option.variableTemplate && !selectorsOnly}
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

			{#if option.variableTemplate && !selectorsOnly}
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
		{:else if option.choices}
			<!-- A reference: connections, sampling configs. The server sends
			     what this option may point at, already narrowed to the
			     namespace and the declared shape — so this renders the list
			     and never decides what belongs in it. -->
			{@const isConnection = option.control === "connection-ref"}
			<!-- A connection slot's value is a PAIR since 0114, and both halves
			     are required: connections have no default model, so the two
			     legacy spellings (a bare id, `{ref}`) are INCOMPLETE choices
			     that resolve as unconfigured until a model is picked.
			     `slotConnectionId` reads all of them, which is why nothing
			     stored needed migrating; `String(option.value)` alone would
			     render `[object Object]` for a pair and select nothing. -->
			{@const chosenId = isConnection
				? slotConnectionId(option.value)
				: null}
			{@const chosenModelId = isConnection
				? slotModelId(option.value)
				: null}
			{@const chosenModels = isConnection
				? (option.choices.find((c) => c.id === chosenId)?.models ?? [])
				: []}
			{@const chosenModel =
				chosenModels.find((m) => m.id === chosenModelId) ?? null}
			<!-- `disabled` and `reason` are why a connection that cannot do
			     this step's job is SHOWN rather than hidden. "Why isn't my
			     connection in the list" has no answer when it is simply absent;
			     greyed out with "Can't do Image generation." under it answers it
			     in place. `reason` also arrives WITHOUT `disabled` for a
			     connection nobody has tested yet — a caveat on a choice that is
			     still selectable. -->
			<Select
				label={labelOverride ?? option.label}
				labelHidden
				class="w-full"
				options={[
					// Unset is not "nothing". A connection or sampling slot with no
					// value here falls through the chain to the instance's default —
					// which is what the step actually runs with.
					{
						value: "",
						label:
							option.control === "connection-ref" ||
							option.control === "sampling-ref"
								? "Global default"
								: "None"
					},
					...(option.choices ?? []).map((choice) => ({
						value: String(choice.id),
						label: `${choice.label}${
							choice.description ? ` · ${choice.description}` : ""
						}`,
						disabled: !!choice.disabled,
						hint: choice.reason || undefined
					}))
				]}
				value={isConnection
					? chosenId == null
						? ""
						: String(chosenId)
					: option.value == null
						? ""
						: String(option.value)}
				onValueChange={(raw) => {
					if (raw === "") return clear(option)
					// ⚠ Changing the ENDPOINT drops the model, deliberately. A
					// `connection_models` row belongs to one connection, so
					// carrying the old model across would write a pair whose two
					// halves name different endpoints — which the resolver
					// refuses at dispatch, about a choice nobody made. The new
					// endpoint's first switched-on model is pinned at once:
					// connections have no default model, so leaving the pair
					// half-written would resolve as unconfigured.
					const nextModels =
						option.choices?.find((c) => c.id === Number(raw))
							?.models ?? []
					const nextModel =
						nextModels.find((m) => m.enabled && !m.missingSince) ??
						null
					set(
						option,
						isConnection
							? connectionSlotValue(
									Number(raw),
									nextModel ? nextModel.id : null
								)
							: Number(raw)
					)
				}}
			/>
			{#if isConnection && chosenModels.length}
				<!-- The second half of the pair (0114). Rendered only where the
				     chosen endpoint HAS models, because a picker over an empty
				     list is a control with no choice in it.

				     Every option names a model — connections have no default
				     model, so there is no "its default" resting option. A slot
				     authored before the split (a bare endpoint) lands on the
				     placeholder until somebody picks: the resolver refuses it
				     with the fix attached rather than guessing a row. -->
				<!-- Disabled and MISSING models are LISTED and greyed, the same
				     rule the connection list above follows: a slot pointed at one
				     before somebody switched it off, or before its host stopped
				     listing it, has to still show what it is pointed at — and why
				     it will refuse. -->
				<Select
					label="Model"
					labelHidden
					class="mt-1 w-full"
					placeholder="Choose a model"
					options={chosenModels.map((m) => ({
						value: String(m.id),
						label: m.name,
						disabled: !m.enabled || m.missingSince != null,
						hint: m.missingSince
							? "No longer listed by its host"
							: m.enabled
								? undefined
								: "Switched off"
					}))}
					value={chosenModelId == null ? "" : String(chosenModelId)}
					onValueChange={(raw) => {
						if (raw === "") return
						set(option, connectionSlotValue(chosenId, Number(raw)))
					}}
				/>
				{#if chosenModel?.missingSince}
					<p
						class="text-warning-500 mt-1 flex items-center gap-1 text-xs"
					>
						<Icons.TriangleAlert size={12} aria-hidden="true" />
						This model is no longer listed by its host, so this step
						will refuse to run. Pick another, or refresh the connection
						once the host serves it again.
					</p>
				{:else if chosenModel && !chosenModel.enabled}
					<p
						class="text-warning-500 mt-1 flex items-center gap-1 text-xs"
					>
						<Icons.TriangleAlert size={12} aria-hidden="true" />
						This model is switched off, so this step will refuse to run.
					</p>
				{/if}
			{/if}
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
	</div>
{/snippet}

{#snippet stepCard(group: (typeof stepGroups)[number])}
	<!-- Shared by the numbered spine list and the trailing, unnumbered
	     "Also configured here" group — an envoy's card looks exactly like a
	     step's; it is simply not counted as one. -->
	<section class="panel-card space-y-3 !p-3">
		{#if stepKey == null}
			<!-- The sidebar shows every step, so each card needs its
			     name. The builder shows one — its host already titles
			     it ("Chat · step 1 of 7"), and repeating it inside the
			     card said everything twice. -->
			<h3 class="text-sm font-semibold">{group.label}</h3>
		{/if}
		{#each group.facets as facet (facet.label)}
			{#if showFacetHeadings(group)}
				<p
					class="text-surface-600-400 text-xs font-semibold"
				>
					{facet.label}
				</p>
			{/if}
			{#each facet.rows as row (row.option.id)}
				{@render optionRow(row.option, row.option.label)}
			{/each}
		{/each}

		{#if group.hidden || group.canCollapse}
			<button
				type="button"
				class="btn btn-sm preset-tonal-surface w-full"
				onclick={() =>
					(showAll[group.key] = !(showAll[group.key] ?? false))}
			>
				{#if group.hidden}
					<Icons.ChevronDown size={14} />
					{group.hidden} more
					{group.hidden === 1 ? "setting" : "settings"}
				{:else}
					<Icons.ChevronUp size={14} /> Fewer settings
				{/if}
			</button>
		{/if}
	</section>
{/snippet}

{#if !detail}
	<p class="text-surface-600-400 p-4 text-sm">Loading…</p>
{:else}
	{#if showScopeNote}
		<p class="text-surface-600-400 mb-3 text-xs">
			Changes here apply to <strong>{scopeLabel}</strong>
			.
		</p>
	{/if}

	{#if showConfigPicker && detail.configs.length}
		<div class="panel-card mb-3 space-y-2 !p-3">
			<p class="text-sm font-semibold" aria-hidden="true">Configuration</p>
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
			{:else}
				<!-- Not a disabled control: outside a session the selection is
				     the instance's, and that one is the administrator's. A
				     picker here was live, and every use of it ended in a
				     refusal toast. What is left is the answer to the only
				     question a reader has — which one is running. -->
				<p class="text-sm">
					{detail.selectedConfig?.name ?? "—"}
				</p>
				<p class="text-surface-600-400 text-xs">
					Chosen for this instance by an administrator. Open a session
					to choose a different one there.
				</p>
			{/if}
		</div>
	{/if}

	{#if selectorsOnly}
		<!-- One flat list of selectors — no per-step cards, no step or facet
		     headings — so the host can wrap the whole pipeline in one card. -->
		<div class="flex flex-col gap-2">
			{#each stepGroups as group (group.key)}
				{#each group.facets as facet (facet.label)}
					{#each facet.rows as row (row.option.id)}
						{@render optionRow(row.option, row.option.label)}
					{/each}
				{/each}
			{/each}
			{#each alsoConfiguredGroups as group (group.key)}
				{#each group.facets as facet (facet.label)}
					{#each facet.rows as row (row.option.id)}
						{@render optionRow(row.option, row.option.label)}
					{/each}
				{/each}
			{/each}
		</div>
	{:else}
		<!-- Grouped by what a setting *is*, not by which step computes it. A group
	     with nothing visible to this viewer is skipped rather than shown
	     empty — for a non-admin that usually leaves just the prompt. -->
		<!-- The wrapper measures the host this panel actually has — the builder's
	     full-width inspector, its 25rem map rail, or the session sidebar —
	     and the groups flow two columns only when that host is wide (22
	     §2.5). A container query on its OWN box, because the pane's width
	     says nothing about the rail's. -->
		<div class="inspector-pane">
			<div class="option-groups space-y-3">
				{#each stepGroups as group (group.key)}
					{@render stepCard(group)}
				{/each}

				{#if alsoConfiguredGroups.length}
					<!-- An envoy is nobody's step (plans/29 R-18 (2); U5g review
					     follow-up) — set apart under its own small heading,
					     after the numbered list rather than inside it. -->
					<p
						class="text-surface-600-400 mt-1 text-xs font-semibold"
					>
						Also configured here
					</p>
					{#each alsoConfiguredGroups as group (group.key)}
						{@render stepCard(group)}
					{/each}
				{/if}

				{#if tuning.length}
					<details class="panel-card !p-3">
						<summary
							class="text-surface-600-400 flex cursor-pointer items-center gap-1 text-xs font-medium select-none"
						>
							<Icons.SlidersHorizontal size={12} />
							Advanced — per-step tuning ({tuning.length})
						</summary>
						<div
							class="border-surface-300-700 mt-3 flex flex-col gap-3 border-l-2 pl-3"
						>
							{#each tuning as row (row.option.id)}
								{@render optionRow(
									row.option,
									qualify(row, tuning)
								)}
							{/each}
						</div>
					</details>
				{/if}
			</div>
		</div>
	{/if}
{/if}

<style>
	.inspector-pane {
		container-type: inline-size;
	}
	/* Two columns only when this panel's own host is wide — the builder's
	   list-mode inspector. The 25rem map rail and the session sidebar never
	   reach the floor, so they stay a single column untouched.

	   The columns run INSIDE each step's card, over its option rows — the
	   builder shows one step at a time, so one card is usually all there is
	   and splitting the card list would just halve it. Headings and the
	   show-more button span both columns; a row never splits. */
	@container (min-width: 66rem) {
		.option-groups :global(section.panel-card) {
			columns: 2;
			column-gap: 1.5rem;
		}
		.option-groups :global(section.panel-card > h3),
		.option-groups :global(section.panel-card > button) {
			column-span: all;
		}
		.option-groups :global(section.panel-card > *) {
			break-inside: avoid;
		}
	}
</style>
