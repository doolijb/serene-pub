<script lang="ts">
	/**
	 * Admin → Sampling → Add sampling config: the add form. A name, a
	 * modality, and the config it starts as a copy of (or nothing switched
	 * on). The parameters themselves are tuned on the change form the create
	 * lands on — "Save and continue editing" is the usual press.
	 *
	 * `?from=<id>` preselects the config to copy and its modality: the change
	 * form's Duplicate lands here.
	 *
	 * Names are unique within a modality (the server says so on
	 * `samplingConfigs:create:error`), checked here first against the list.
	 */
	import { getContext, onMount } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import {
		adminGoto,
		adminPage,
		adminUnsavedEdits
	} from "$lib/client/admin/adminRouter.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { S } from "@serene-pub/sdk"
	import { capabilityForSamplingShape } from "$lib/shared/capabilities/samplingShape"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import AdminChangeForm, {
		type AdminSaveIntent
	} from "$lib/client/components/admin/AdminChangeForm.svelte"
	import AdminFieldset from "$lib/client/components/admin/AdminFieldset.svelte"
	import AdminField, { describedBy } from "$lib/client/components/admin/AdminField.svelte"
	import { samplingModality, type SamplingRow } from "./samplingAdmin"

	const socket = useTypedSocket()
	const systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")

	/** The two shapes a sampling config can take, by their modality word. */
	const SHAPES = [
		{ shape: S.textGen, label: "Text — large language models" },
		{ shape: S.imageGen, label: "Image — image generation" }
	]
	const NOTHING = "none"

	let rows = $state<SamplingRow[]>([])
	let listed = $state(false)
	useInterest<"samplingConfigs:list">("samplingConfigs:list", (msg) => {
		rows = msg.samplingConfigsList as SamplingRow[]
		if (!listed) {
			listed = true
			seedFromQuery()
		}
	})
	onMount(() => socket.emit("samplingConfigs:list", {}))

	let name = $state("")
	let shape = $state<string>(S.textGen)
	/** A config id as a string, or `NOTHING`; "" until the list lands. */
	let startFrom = $state("")
	/** What the form held when it opened; only a change from it is unsaved. */
	let seeded = $state<{ name: string; shape: string; startFrom: string } | null>(null)

	const ofShape = $derived(
		rows.filter((r) => samplingModality(r.shape) === samplingModality(shape))
	)

	/** The modality's default config, else its first built-in, else nothing. */
	function defaultStartFor(s: string): string {
		const cap = capabilityForSamplingShape(s)
		const def = cap ? systemSettingsCtx?.capabilityDefaults?.[cap]?.samplingConfigId : null
		const pool = rows.filter((r) => samplingModality(r.shape) === samplingModality(s))
		const pick =
			pool.find((r) => r.id === def) ?? pool.find((r) => r.isImmutable) ?? pool[0]
		return pick ? String(pick.id) : NOTHING
	}

	function seedFromQuery() {
		const from = Number(adminPage.url.searchParams.get("from"))
		const source = rows.find((r) => r.id === from)
		if (source) {
			shape = source.shape ?? S.textGen
			startFrom = String(source.id)
			name = uniqueCopyName(source.name, shape)
		} else startFrom = defaultStartFor(shape)
		seeded = { name, shape, startFrom }
	}

	function uniqueCopyName(base: string, s: string): string {
		const taken = new Set(
			rows
				.filter((r) => samplingModality(r.shape) === samplingModality(s))
				.map((r) => r.name.trim().toLowerCase())
		)
		let candidate = `${base} copy`
		for (let i = 2; taken.has(candidate.toLowerCase()); i++)
			candidate = `${base} copy ${i}`
		return candidate
	}

	function pickShape(next: string) {
		if (next === shape) return
		shape = next
		startFrom = defaultStartFor(next)
	}

	const dirty = $derived(
		!!seeded &&
			(name.trim() !== seeded.name.trim() ||
				shape !== seeded.shape ||
				startFrom !== seeded.startFrom)
	)
	let saving = $state(false)
	/** A landed create is not an unsaved edit. */
	let landed = false
	adminUnsavedEdits(() => !landed && dirty)
	let pendingIntent: AdminSaveIntent | null = null
	let nameError = $state<string | null>(null)
	let formErrors = $state<string[]>([])

	function save(intent: AdminSaveIntent) {
		const trimmed = name.trim()
		const taken = ofShape.some((r) => r.name.trim().toLowerCase() === trimmed.toLowerCase())
		nameError = !trimmed
			? "A sampling config needs a name."
			: taken
				? `${shape === S.imageGen ? "An image" : "A text"} sampling config named "${trimmed}" already exists.`
				: null
		formErrors = []
		if (nameError) return
		const source =
			startFrom && startFrom !== NOTHING
				? rows.find((r) => r.id === Number(startFrom))
				: undefined
		saving = true
		pendingIntent = intent
		socket.emit("samplingConfigs:create", {
			sampling: {
				name: trimmed,
				shape,
				values: structuredClone($state.snapshot(source?.values ?? {})),
				enabled: [...(source?.enabled ?? [])]
			} as any
		})
	}

	function handleCreate(msg: Sockets.SamplingConfigs.Create.Response) {
		// emitToUser reaches every open view; only this form's own create moves it.
		if (!pendingIntent || !msg.sampling?.id) return
		if ((msg.sampling.name ?? "").trim() !== name.trim()) return
		const intent = pendingIntent
		pendingIntent = null
		saving = false
		toaster.success({ title: `Added ${msg.sampling.name}` })
		if (intent !== "another") landed = true
		if (intent === "continue") void adminGoto(`/admin/sampling/${msg.sampling.id}`)
		else if (intent === "save") void adminGoto("/admin/sampling")
		else {
			name = ""
			startFrom = defaultStartFor(shape)
			seeded = { name, shape, startFrom }
		}
	}
	function handleCreateError(msg: { error?: string }) {
		if (!pendingIntent) return
		pendingIntent = null
		saving = false
		const error = msg.error ?? "The sampling config was not created."
		if (/name/i.test(error)) nameError = error
		else formErrors = [error]
	}
	useInterest<"samplingConfigs:create">("samplingConfigs:create", handleCreate)
	useInterest<"samplingConfigs:create:error">(
		"samplingConfigs:create:error",
		handleCreateError
	)
</script>

<AdminChangeForm
	mode="add"
	title="Add sampling config"
	purpose="Name it, pick its modality and what it starts as a copy of. Its parameters are tuned on the next screen."
	noun="sampling config"
	changelistHref="/admin/sampling"
	changelistLabel="Sampling"
	{saving}
	{dirty}
	errors={formErrors}
	fieldErrors={{ "new-sampling-name": nameError }}
	onSave={save}
>
	<AdminFieldset title="Identity">
		<AdminField
			id="new-sampling-name"
			label="Name"
			required
			error={nameError}
			help="What the Sampling view, Defaults and pipeline settings call it. Unique within its modality."
		>
			<input
				id="new-sampling-name"
				class="input"
				type="text"
				bind:value={name}
				aria-invalid={!!nameError}
				aria-describedby={describedBy("new-sampling-name", !!nameError)}
			/>
		</AdminField>
		<div class="flex flex-col gap-1.5" data-field="new-sampling-modality">
			<Select
				label="Modality"
				options={SHAPES.map((s) => ({ value: s.shape, label: s.label }))}
				value={shape}
				onValueChange={(v) => v && pickShape(v)}
				describedBy="new-sampling-modality-help"
			/>
			<p id="new-sampling-modality-help" class="text-surface-600-400 text-xs">
				Which parameters it has. Text and image sampling share none, and a
				config never changes modality once made.
			</p>
		</div>
	</AdminFieldset>

	<AdminFieldset
		title="Starting values"
		description="A copy of an existing config's parameters, or nothing switched on. Nothing here changes the config you copy."
	>
		<div class="flex flex-col gap-1.5" data-field="new-sampling-from">
			<Select
				label="Start from"
				options={[
					...ofShape.map((r) => ({
						value: String(r.id),
						label: `Copy of ${r.name}${r.isImmutable ? " (built-in)" : ""}`
					})),
					{ value: NOTHING, label: "Nothing switched on — the backend's own defaults" }
				]}
				bind:value={startFrom}
				describedBy="new-sampling-from-help"
			/>
			<p id="new-sampling-from-help" class="text-surface-600-400 text-xs">
				A parameter switched off is not sent, so the backend uses its own value
				for it.
			</p>
		</div>
	</AdminFieldset>
</AdminChangeForm>
