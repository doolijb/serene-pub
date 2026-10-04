<script lang="ts">
	/**
	 * Admin › Components › Add component: the add form. Start blank (pick the
	 * framework) or as a clone of one of core's components (`?from=<slug>`
	 * preselects it); a name is optional. Nothing exists until a Save; the
	 * source is written in the editor "Save and continue editing" opens.
	 * Without a compiler (Android) nothing can be authored, and the form
	 * says so instead of offering a Save that would be refused.
	 */
	import { getContext, onMount } from "svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import {
		adminGoto as goto,
		adminPage,
		adminUnsavedEdits
	} from "$lib/client/admin/adminRouter.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getAdminInterestContext } from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { adminRedirect } from "$lib/client/components/componentEditor/editorState"
	import AdminChangeForm, {
		type AdminSaveIntent
	} from "$lib/client/components/admin/AdminChangeForm.svelte"
	import AdminFieldset from "$lib/client/components/admin/AdminFieldset.svelte"
	import AdminField, { describedBy } from "$lib/client/components/admin/AdminField.svelte"

	type CoreRow = Sockets.Components.CoreList.Response["components"][number]
	const BLANK = ""

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()
	const interest = getAdminInterestContext()

	let core = $state<CoreRow[]>([])
	let compiler = $state<{ available: boolean; reason?: string }>({ available: true })
	let start = $state(BLANK)
	let framework = $state<Sockets.Components.Framework>("svelte")
	let label = $state("")
	const dirty = $derived(!!label.trim())
	adminUnsavedEdits(() => dirty && !saving)

	let saving = $state(false)
	let pendingIntent: AdminSaveIntent | null = null
	let formErrors = $state<string[]>([])

	function made(res: Sockets.Components.Clone.Response) {
		const intent = pendingIntent
		if (!intent) return
		pendingIntent = null
		saving = false
		label = ""
		toaster.success({ title: "Component added" })
		if (intent === "continue")
			void goto(`/admin/components/${res.component.id}`, { replaceState: true })
		else if (intent === "save") void goto("/admin/components")
	}
	function refused(res: Sockets.ErrorResponse) {
		if (!pendingIntent) return
		pendingIntent = null
		saving = false
		formErrors = [res.error ?? "The component was not added."]
	}

	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const releases = [
			interest.declareInterest<"components:clone">("components:clone", made),
			interest.declareInterest<"components:create">("components:create", made),
			interest.declareInterest<"components:clone:error">("components:clone:error", refused),
			interest.declareInterest<"components:create:error">("components:create:error", refused),
			interest.requestWithInterest("components:coreList", {}, (res) => {
				core = res.components
				const from = adminPage.url.searchParams.get("from")
				if (from && res.components.some((c) => c.slug === from && c.cloneable)) start = from
			}),
			interest.requestWithInterest("components:list", {}, (res) => {
				compiler = res.compiler
			})
		]
		return () => {
			for (const release of releases) release()
		}
	})
	onMount(() => {
		const to = adminRedirect(userCtx.user)
		if (to) void goto(to)
	})

	function save(intent: AdminSaveIntent) {
		formErrors = []
		saving = true
		pendingIntent = intent
		const name = label.trim() || undefined
		if (start) socket.emit("components:clone", { slug: start, ...(name ? { label: name } : {}) })
		else socket.emit("components:create", { framework, ...(name ? { label: name } : {}) })
	}
</script>

<AdminChangeForm
	mode="add"
	title="Add component"
	purpose="Start blank or as a copy of one of core's widgets; you write its source next."
	noun="component"
	changelistHref="/admin/components"
	changelistLabel="Components"
	{dirty}
	{saving}
	canSave={compiler.available && !saving}
	errors={compiler.available
		? formErrors
		: [`Authoring is not available on this pub: it has no component compiler${compiler.reason ? ` (${compiler.reason})` : ""}.`]}
	onSave={save}
>
	<AdminFieldset title="Component">
		<div class="grid gap-4 @min-[36rem]/content:grid-cols-2">
			<AdminField id="component-new-start" label="Start from" help="A clone is a new widget beside core's, never in its place.">
				<Select
					label="Start from"
					labelHidden
					options={[
						{ value: BLANK, label: "Blank" },
						...core
							.filter((c) => c.cloneable)
							.map((c) => ({ value: c.slug, label: `Clone of ${c.title}`, hint: c.framework }))
					]}
					bind:value={start}
					describedBy={describedBy("component-new-start", false)}
				/>
			</AdminField>
			{#if !start}
				<AdminField id="component-new-framework" label="Framework">
					<Select
						label="Framework"
						labelHidden
						options={[
							{ value: "svelte", label: "Svelte" },
							{ value: "vanilla", label: "Vanilla" }
						]}
						value={framework}
						onValueChange={(v) => (framework = v === "vanilla" ? "vanilla" : "svelte")}
					/>
				</AdminField>
			{/if}
			<AdminField id="component-new-label" label="Name" help="Optional — a default is assigned.">
				<input
					id="component-new-label"
					class="input"
					type="text"
					bind:value={label}
					aria-describedby={describedBy("component-new-label", false)}
				/>
			</AdminField>
		</div>
	</AdminFieldset>
</AdminChangeForm>
