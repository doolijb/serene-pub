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
	 * Writes echo the option's `writeAt` back as the scope: an admin's
	 * non-prompt edits land at instance scope because those are the
	 * application's configuration, and the server told us so per option.
	 *
	 * Socket events are shared channels, so every listener filters by slug:
	 * two of these panels showing different pipelines must not clobber each
	 * other's responses.
	 */
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import ShareBar from "$lib/client/components/pipelines/ShareBar.svelte"

	interface Props {
		slug: string
		/** Set when hosted inside a chat — writes land at chat scope. */
		chatId?: number
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
		 * sidebar, which overrides one for you or this chat. Without it every
		 * edit landed at instance scope — which *outranks* `preset`, where a
		 * configuration's own values live — so a change made with one
		 * configuration selected followed you to every other one, and
		 * duplicating a configuration to change a single setting changed it
		 * everywhere instead.
		 */
		editsConfigId?: number
	}

	let {
		slug,
		chatId,
		showScopeNote = true,
		onLoaded,
		stepKey,
		granular = false,
		showConfigPicker = true,
		editsConfigId
	}: Props = $props()

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
		detail?.writeScope === "chat"
			? "this chat"
			: detail?.writeScope === "instance"
				? "everyone"
				: "you"
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
		chat: "from this chat",
		user: "your value",
		preset: "from the selected config",
		instance: "set by an admin",
		author: "default"
	}

	/** The option's declared landing scope rides back with every write. */
	const scopeOf = (option: Sockets.Pipelines.Option) =>
		option.writeAt === "instance" ? { scope: "instance" as const } : {}

	/**
	 * Where this edit belongs. Authoring a configuration and overriding one are
	 * different acts against different tables, and the server refuses the first
	 * against a shipped row — so the id travels rather than being inferred.
	 */
	const targetOf = (option: Sockets.Pipelines.Option) =>
		editsConfigId != null
			? { configId: editsConfigId }
			: scopeOf(option)

	function set(option: Sockets.Pipelines.Option, value: unknown) {
		socket.emit("pipelines:setOption", {
			slug,
			optionId: option.id,
			value,
			chatId,
			...targetOf(option)
		})
	}

	function clear(option: Sockets.Pipelines.Option) {
		socket.emit("pipelines:clearOption", {
			slug,
			optionId: option.id,
			chatId,
			...targetOf(option)
		})
	}

	function chooseConfig(raw: string) {
		const configId = parseInt(raw, 10)
		if (Number.isNaN(configId)) return
		socket.emit("pipelines:selectConfig", { slug, configId, chatId })
	}

	/** Numbers arrive from `<input>` as strings; an empty box means "unset". */
	function numeric(option: Sockets.Pipelines.Option, raw: string) {
		if (raw.trim() === "") return clear(option)
		const n =
			option.control === "integer" ? parseInt(raw, 10) : parseFloat(raw)
		if (Number.isNaN(n)) return
		set(option, n)
	}

	/* --- prompt clone / edit / delete ------------------------------- */

	function clonePrompt(option: Sockets.Pipelines.Option) {
		if (!option.prompt) return
		cloningFor = option.id
		socket.emit("pipelines:clonePrompt", {
			slug,
			promptId: option.prompt.id,
			chatId
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

	/** Seed a draft from the stored row on the first keystroke. */
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
			promptId: draft.id,
			name: draft.name,
			fields: draft.fields,
			chatId
		})
		delete promptDrafts[option.id]
	}

	function deletePrompt(option: Sockets.Pipelines.Option) {
		if (!option.prompt) return
		if (
			!confirm(
				`Delete the prompt '${option.prompt.name}'? Your selection ` +
					`here goes back to what it inherits. If a configuration or ` +
					`someone else still uses this prompt, the server refuses.`
			)
		)
			return
		delete promptDrafts[option.id]
		socket.emit("pipelines:deletePrompt", {
			slug,
			promptId: option.prompt.id,
			chatId
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
			chatId
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
			chatId
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
			chatId
		})
	}

	/* --- context template create / clone / edit / delete -------------- */

	function createTemplate(option: Sockets.Pipelines.Option) {
		cloningTemplateFor = option.id
		socket.emit("pipelines:createContextTemplate", {
			slug,
			optionId: option.id,
			chatId
		})
	}

	function cloneTemplate(option: Sockets.Pipelines.Option) {
		if (!option.contextTemplate) return
		cloningTemplateFor = option.id
		socket.emit("pipelines:cloneContextTemplate", {
			slug,
			optionId: option.id,
			templateId: option.contextTemplate.id,
			chatId
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
			chatId
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
			chatId
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
	const onCloned = (res: Sockets.Pipelines.ClonePrompt.Response) => {
		if (res.error) return
		if (!res.pipeline || res.pipeline.slug !== slug) return
		const optionId = cloningFor
		cloningFor = null
		if (!optionId || res.promptId == null) return
		const opt = res.pipeline.steps
			.flatMap((s) => [...s.options, ...s.advanced])
			.find((o) => o.id === optionId)
		if (opt)
			socket.emit("pipelines:setOption", {
				slug,
				optionId,
				value: res.promptId,
				chatId,
				...targetOf(opt)
			})
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
		if (opt)
			socket.emit("pipelines:setOption", {
				slug,
				optionId,
				value: res.templateId,
				chatId,
				...targetOf(opt)
			})
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
		if (opt)
			socket.emit("pipelines:setOption", {
				slug,
				optionId,
				value: res.templateId,
				chatId,
				...targetOf(opt)
			})
		delete templateDrafts[optionId]
	}
	// The server's refusals are written for a person — "connections stay
	// with the administrator so credentials and compute do" — so they are
	// shown, not replaced with a status.
	const showRefusal = (res: { error?: string }) => {
		if (res?.error) toaster.error({ title: res.error })
	}

	onMount(() => {
		socket.on("pipelines:get", onGet)
		socket.on("pipelines:clonePrompt", onCloned)
		socket.on("pipelines:setOption:error", showRefusal)
		socket.on("pipelines:clearOption:error", showRefusal)
		socket.on("pipelines:selectConfig:error", showRefusal)
		socket.on("pipelines:clonePrompt:error", showRefusal)
		socket.on("pipelines:updatePrompt:error", showRefusal)
		socket.on("pipelines:deletePrompt:error", showRefusal)
		socket.on("pipelines:createContextTemplate", onTemplateCloned)
		socket.on("pipelines:createContextTemplate:error", showRefusal)
		socket.on("pipelines:cloneContextTemplate", onTemplateCloned)
		socket.on("pipelines:cloneContextTemplate:error", showRefusal)
		socket.on("pipelines:updateContextTemplate:error", showRefusal)
		socket.on("pipelines:deleteContextTemplate:error", showRefusal)
		socket.on("pipelines:cloneVariableTemplate", onLayoutCloned)
		socket.on("pipelines:cloneVariableTemplate:error", showRefusal)
		socket.on("pipelines:updateVariableTemplate:error", showRefusal)
		socket.on("pipelines:deleteVariableTemplate:error", showRefusal)

		socket.emit("pipelines:get", { slug, chatId })
	})

	onDestroy(() => {
		socket.off("pipelines:get", onGet)
		socket.off("pipelines:clonePrompt", onCloned)
		socket.off("pipelines:setOption:error", showRefusal)
		socket.off("pipelines:clearOption:error", showRefusal)
		socket.off("pipelines:selectConfig:error", showRefusal)
		socket.off("pipelines:clonePrompt:error", showRefusal)
		socket.off("pipelines:updatePrompt:error", showRefusal)
		socket.off("pipelines:deletePrompt:error", showRefusal)
		socket.off("pipelines:createContextTemplate", onTemplateCloned)
		socket.off("pipelines:createContextTemplate:error", showRefusal)
		socket.off("pipelines:cloneContextTemplate", onTemplateCloned)
		socket.off("pipelines:cloneContextTemplate:error", showRefusal)
		socket.off("pipelines:updateContextTemplate:error", showRefusal)
		socket.off("pipelines:deleteContextTemplate:error", showRefusal)
		socket.off("pipelines:cloneVariableTemplate", onLayoutCloned)
		socket.off("pipelines:cloneVariableTemplate:error", showRefusal)
		socket.off("pipelines:updateVariableTemplate:error", showRefusal)
		socket.off("pipelines:deleteVariableTemplate:error", showRefusal)
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
	const FACET_GROUPS = $derived.by<Array<{ facets: string[]; label: string }>>(
		() => {
			const byLabel = new Map<string, { facets: string[]; label: string }>()
			for (const f of detail?.facets ?? []) {
				const g = byLabel.get(f.label)
				if (g) g.facets.push(f.id)
				else byLabel.set(f.label, { facets: [f.id], label: f.label })
			}
			return [...byLabel.values()]
		}
	)

	/** The sidebar leads with these and puts the rest behind one door. */
	const SIMPLE_FACETS = $derived(
		(detail?.facets ?? []).filter((f) => f.simple).map((f) => f.id)
	)

	/** One step in the builder's inspector; all of them in the sidebar. */
	const visibleSteps = $derived(
		!detail
			? []
			: stepKey != null
				? detail.steps.filter((s) => s.key === stepKey)
				: detail.steps
	)

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

	const rowsOf = (pick: (s: Sockets.Pipelines.Step) => Sockets.Pipelines.Option[]) =>
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

	const stepGroups = $derived(
		visibleSteps
			.map((step) => {
				const all = granular ? allOf(step) : step.options
				// The author's answer to "which of these does anyone change",
				// not a guess from control kind or position. A step whose
				// settings are *all* quick, or none, gets no disclosure — a
				// "show 0 more" is worse than no affordance at all.
				const quick = all.filter((o) => o.quick)
				const rest = all.filter((o) => !o.quick)
				const open = showAll[step.key] ?? false
				const pool = quick.length && rest.length && !open ? quick : all
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
					hidden: quick.length && rest.length && !open ? rest.length : 0,
					canCollapse: !!(quick.length && rest.length && open),
					count: facets.reduce((n, f) => n + f.rows.length, 0)
				}
			})
			.filter((g) => g.count > 0)
	)

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
	const tuning = $derived(granular ? [] : rowsOf((s) => s.advanced))

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
	<div class="flex flex-col gap-1">
		<div class="flex items-center justify-between gap-2">
			<label
				class="min-w-0 flex-1 truncate text-sm font-medium"
				for="opt-{option.id}"
			>
				{labelOverride ?? option.label}
			</label>

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
			{:else if option.source !== "author"}
				<!--
					A dot, not a sentence.

					"from the selected config" on every row is a hundred-odd
					pixels of the same words repeated down the panel — at rail
					width it crowds out the control it annotates, and because
					almost every value comes from the shipped config it marks
					nearly all of them, which is the same as marking none. The
					wording moves to the tooltip, where it is available and not
					in the way.
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
			<p class="text-muted/80 text-[11px] leading-snug" title={option.description}>
				{option.description}
			</p>
		{/if}

		{#if !option.writable}
			<p class="text-muted text-xs italic">
				{option.value ? String(option.value) : "—"}
				<span class="not-italic">(admin only)</span>
			</p>
		{:else if option.control === "text" || option.control === "template"}
			<!-- An empty template is not an empty setting: it means the step
			     renders with its built-in wording. Saying so is the difference
			     between "nothing is configured here" and "nothing is
			     overridden here". -->
			<textarea
				id="opt-{option.id}"
				class="textarea w-full font-mono text-xs"
				placeholder={option.control === "template"
					? "Empty — using the built-in wording"
					: undefined}
				rows={option.control === "template" ? 8 : 4}
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
		{:else if option.control === "boolean"}
			<label class="flex items-center gap-2 text-sm">
				<input
					id="opt-{option.id}"
					type="checkbox"
					class="checkbox"
					checked={!!option.value}
					onchange={(e) => set(option, e.currentTarget.checked)}
				/>
				<span class="text-muted">
					{option.value ? "On" : "Off"}
				</span>
			</label>
		{:else if option.control === "enum"}
			<!-- Labels come from `members` when the declaration carried them.
			     Without it the raw stored value is what shows, and `rag` is
			     not a word anybody chose to read. -->
			{@const labels = new Map(
				(option.members ?? []).map((m) => [m.key, m])
			)}
			<select
				id="opt-{option.id}"
				class="select w-full"
				value={option.value == null ? "" : String(option.value)}
				onchange={(e) => set(option, e.currentTarget.value)}
			>
				{#each option.of ?? [] as choice}
					<option value={choice}>
						{labels.get(choice)?.label ?? choice}
					</option>
				{/each}
			</select>
			{#if labels.get(String(option.value))?.description}
				<p class="text-muted mt-1 text-xs">
					{labels.get(String(option.value))!.description}
				</p>
			{/if}
		{:else if option.control === "number" || option.control === "integer"}
			<!-- Typed text goes through `drafts` so the fresh view after a
			     write reconciles the box to what actually resolved — a value
			     the chain rejects or reshapes must not linger on screen. -->
			<input
				id="opt-{option.id}"
				type="number"
				class="input w-full"
				min={option.min}
				max={option.max}
				step={option.control === "integer" ? 1 : "any"}
				value={drafts[option.id] ??
					(option.value == null ? "" : String(option.value))}
				oninput={(e) => (drafts[option.id] = e.currentTarget.value)}
				onchange={(e) => numeric(option, e.currentTarget.value)}
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
		{:else if option.control === "per-member"}
			<!-- Same declared bands as the bar above it, so a ceiling and a
			     share read as the same five things in the same order and the
			     same colours. -->
			<ul class="flex flex-col gap-1">
				{#each option.members ?? [] as m (m.key)}
					<li class="flex items-center gap-2 text-xs">
						<span class="min-w-0 flex-1 truncate" title={m.description}>
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
								((option.value ?? option.authorDefault ?? {}) as Record<
									string,
									number
								>)[m.key] ?? 0
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
			     the same boxes, read-only, with Duplicate as the way in. -->
			<div class="flex items-center gap-1">
				<select
					id="opt-{option.id}"
					class="select min-w-0 flex-1"
					value={option.value == null ? "" : String(option.value)}
					onchange={(e) => {
						const raw = e.currentTarget.value
						if (raw === "") return clear(option)
						set(option, Number(raw))
					}}
				>
					<!-- Unset is a fallback, not an absence: the step resolves
				     to the pipeline's own default prompt (the first it ships
				     with), so a run never goes out with empty instructions. -->
					<option value="">— Pipeline Default —</option>
					{#each option.choices ?? [] as choice (choice.id)}
						<option value={String(choice.id)}>
							{choice.label}
						</option>
					{/each}
				</select>
				{#if option.prompt}
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface shrink-0"
						title="Duplicate this prompt and edit the copy"
						onclick={() => clonePrompt(option)}
					>
						<Icons.Copy size={14} />
					</button>
					{#if !option.prompt.readOnly}
						<button
							type="button"
							class="btn btn-sm preset-tonal-surface shrink-0"
							title="Delete this prompt"
							onclick={() => deletePrompt(option)}
						>
							<Icons.Trash2 size={14} />
						</button>
					{/if}
				{/if}
			</div>

			{#if option.prompt}
				{@const readOnly = option.prompt.readOnly}
				<div class="card bg-surface-100-800 mt-1 space-y-3 p-3">
					{#if readOnly}
						<p class="text-muted text-xs">
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
					{#each option.prompt.declared?.length
						? option.prompt.declared
						: Object.keys(option.prompt.fields) as field (field)}
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

					{#if isDirty(option)}
						<div class="flex items-center justify-end gap-2">
							<span class="text-muted mr-auto text-xs">
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
				<select
					id="opt-{option.id}"
					class="select min-w-0 flex-1"
					value={option.value == null ? "" : String(option.value)}
					onchange={(e) => {
						const raw = e.currentTarget.value
						if (raw === "") return clear(option)
						set(option, Number(raw))
					}}
				>
					<!-- Unset still renders: the step falls back to the
					     template Serene Pub ships, so a prompt is never empty
					     because a selection went away. -->
					<option value="">— Pipeline Default —</option>
					{#each groups as g (g.key)}
						{@const inGroup = (option.choices ?? []).filter(
							(c: any) => (c.group ?? "alsoFits") === g.key
						)}
						{#if inGroup.length}
							<optgroup label={g.label}>
								{#each inGroup as choice (choice.id)}
									<option value={String(choice.id)}>
										{choice.label}{choice.description
											? ` — ${choice.description}`
											: ""}
									</option>
								{/each}
							</optgroup>
						{/if}
					{/each}
				</select>
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface shrink-0"
					title="Write a new context template from scratch"
					onclick={() => createTemplate(option)}
				>
					<Icons.Plus size={14} />
				</button>
				{#if option.contextTemplate}
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface shrink-0"
						title="Duplicate this template and edit the copy"
						onclick={() => cloneTemplate(option)}
					>
						<Icons.Copy size={14} />
					</button>
					{#if !option.contextTemplate.readOnly}
						<button
							type="button"
							class="btn btn-sm preset-tonal-surface shrink-0"
							title="Delete this template"
							onclick={() => deleteTemplate(option)}
						>
							<Icons.Trash2 size={14} />
						</button>
					{/if}
				{/if}
			</div>

			{#if option.contextTemplate}
				{@const readOnly = option.contextTemplate.readOnly}
				<div class="card bg-surface-100-800 mt-1 space-y-3 p-3">
					{#if readOnly}
						<p class="text-muted text-xs">
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
						<p class="text-muted text-xs">
							<Icons.Info size={11} class="inline" />
							Written {option.contextTemplate.origin} — edits reach
							every pipeline using it.
						</p>
					{/if}

					<label class="flex flex-col gap-1 text-xs font-medium">
						Template
						<textarea
							class="textarea w-full font-mono text-xs"
							rows={readOnly ? 6 : 16}
							readonly={readOnly}
							spellcheck="false"
							value={templateSource(option)}
							oninput={(e) =>
								editTemplate(option, {
									source: e.currentTarget.value
								})}
						></textarea>
					</label>
					<p class="text-muted text-xs">
						Handlebars: message blocks, placement and loops. How
						each value is written out — headings, fences, JSON or
						prose — is a <strong>layout</strong>
						, set per variable below. Read variables with
						<code>&#123;&#123;&#123;x&#125;&#125;&#125;</code>
						; a double brace escapes the fences a layout writes.
					</p>

					{#if templateDirty(option)}
						<div class="flex items-center justify-end gap-2">
							<span class="text-muted mr-auto text-xs">
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
				<select
					id="opt-{option.id}"
					class="select min-w-0 flex-1"
					value={option.value == null ? "" : String(option.value)}
					onchange={(e) => {
						const raw = e.currentTarget.value
						if (raw === "") return clear(option)
						set(option, Number(raw))
					}}
				>
					<!-- Unset still renders: the step falls back to the layout
					     Serene Pub ships, so the prompt is never missing a
					     section because a selection went away. -->
					<option value="">— Pipeline Default —</option>
					{#each option.choices ?? [] as choice (choice.id)}
						<option value={String(choice.id)}>
							{choice.label}
						</option>
					{/each}
				</select>
				{#if option.variableTemplate}
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface shrink-0"
						title="Duplicate this layout and edit the copy"
						onclick={() => cloneLayout(option)}
					>
						<Icons.Copy size={14} />
					</button>
					{#if !option.variableTemplate.readOnly}
						<button
							type="button"
							class="btn btn-sm preset-tonal-surface shrink-0"
							title="Delete this layout"
							onclick={() => deleteLayout(option)}
						>
							<Icons.Trash2 size={14} />
						</button>
					{/if}
				{/if}
			</div>

			{#if option.variableTemplate}
				{@const readOnly = option.variableTemplate.readOnly}
				<div class="card bg-surface-100-800 mt-1 space-y-3 p-3">
					{#if readOnly}
						<p class="text-muted text-xs">
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
					<p class="text-muted text-xs">
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
							<span class="text-muted mr-auto text-xs">
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
		{:else if option.choices}
			<!-- A reference: connections, sampling configs. The server sends
			     what this option may point at, already narrowed to the
			     namespace and the declared shape — so this renders the list
			     and never decides what belongs in it. -->
			<select
				id="opt-{option.id}"
				class="select w-full"
				value={option.value == null ? "" : String(option.value)}
				onchange={(e) => {
					const raw = e.currentTarget.value
					if (raw === "") return clear(option)
					set(option, Number(raw))
				}}
			>
				<!-- Unset is not "nothing". A connection or sampling slot with
				     no value here falls through the chain to the instance's
				     default — which is what the step actually runs with — so
				     "none" was describing an empty box rather than the
				     behaviour, and read as "this step has no connection". -->
				<option value="">
					{option.control === "connection-ref" ||
					option.control === "sampling-ref"
						? "— Global Default —"
						: "— none —"}
				</option>
				{#each option.choices as choice (choice.id)}
					<option value={String(choice.id)}>
						{choice.label}{choice.description
							? ` · ${choice.description}`
							: ""}
					</option>
				{/each}
			</select>
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

{#if !detail}
	<p class="text-muted p-4 text-sm">Loading…</p>
{:else}
	{#if showScopeNote}
		<p class="text-muted mb-3 text-xs">
			Changes here apply to <strong>{scopeLabel}</strong>
			.
		</p>
	{/if}

	{#if showConfigPicker && detail.configs.length}
		<div class="card preset-tonal mb-3 space-y-2 p-3">
			<p class="text-sm font-semibold">Configuration</p>
			<select
				class="select w-full"
				value={detail.selectedConfig
					? String(detail.selectedConfig.id)
					: ""}
				onchange={(e) => chooseConfig(e.currentTarget.value)}
			>
				{#each detail.configs as c (c.id)}
					<option value={String(c.id)}>
						{c.isDefault ? "★ " : ""}{c.name}
					</option>
				{/each}
			</select>
		</div>
	{/if}

	<!-- Grouped by what a setting *is*, not by which step computes it. A group
	     with nothing visible to this viewer is skipped rather than shown
	     empty — for a non-admin that usually leaves just the prompt. -->
	<div class="space-y-3">
		{#each stepGroups as group (group.key)}
			<section class="card preset-tonal space-y-3 p-3">
				<h3 class="text-sm font-semibold">{group.label}</h3>
				{#each group.facets as facet (facet.label)}
					{#if showFacetHeadings(group)}
						<p
							class="text-muted text-xs font-semibold tracking-wide uppercase"
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
		{/each}

		{#if tuning.length}
			<details class="card preset-tonal p-3">
				<summary
					class="text-muted flex cursor-pointer items-center gap-1 text-xs font-medium select-none"
				>
					<Icons.SlidersHorizontal size={12} />
					Advanced — per-step tuning ({tuning.length})
				</summary>
				<div
					class="border-surface-300-700 mt-3 flex flex-col gap-3 border-l-2 pl-3"
				>
					{#each tuning as row (row.option.id)}
						{@render optionRow(row.option, qualify(row, tuning))}
					{/each}
				</div>
			</details>
		{/if}
	</div>
{/if}
