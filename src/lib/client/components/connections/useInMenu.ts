/**
 * The Models view's **Use in…** menu (DESIGN-image-generation §14): which
 * loadouts a model can be put in, in which order, with which words.
 *
 * A model serves one or more jobs (its `satisfiableCapabilities`); each job
 * has a default loadout and may have others. The menu lists, per job the
 * model can do, the DEFAULT loadout first (the caller draws its gold mark),
 * then the job's other loadouts by name, each with its state in words:
 * the pair it runs on now, *Runs this model*, or *Unfilled — falls back to
 * Reply*.
 *
 * A merged loadout is left out: it runs on the loadout it was merged into,
 * so filling its own pair would change nothing a person could see.
 *
 * ⚠ Pure. No Svelte, no socket.
 */

type Summary = Pick<
	Sockets.Loadouts.Summary,
	| "id"
	| "name"
	| "transform"
	| "defaultFor"
	| "filled"
	| "fallbackName"
	| "connectionId"
	| "connectionModelId"
	| "connectionName"
	| "modelName"
	| "mergedInto"
>

/** One loadout as the menu offers it. */
export interface UseInItem {
	/** The loadout row's id (`loadouts:update { id }`). */
	id: number
	name: string
	transform: string
	/** The job's default loadout: the press goes through `chooseJobModel`. */
	isDefault: boolean
	/** This loadout already runs the model the menu is for. */
	current: boolean
	/** Its state, in words. */
	state: string
}

/** One job the model can do, and its loadouts. */
export interface UseInGroup {
	transform: string
	label: string
	items: UseInItem[]
}

/** The model the menu is for: its pair and the jobs it can do. */
export interface UseInModel {
	connectionId: number
	modelId: number
	capabilities: readonly string[]
}

/** What one loadout runs now, in words. */
export function useInState(
	loadout: Summary,
	model: Pick<UseInModel, "connectionId" | "modelId">
): string {
	if (isCurrent(loadout, model)) return "Runs this model"
	if (!loadout.filled)
		return loadout.defaultFor
			? "Unfilled"
			: `Unfilled — falls back to ${loadout.fallbackName ?? "the default"}`
	const pair = [loadout.modelName, loadout.connectionName]
		.filter(Boolean)
		.join(" · ")
	return pair || "Set"
}

function isCurrent(
	loadout: Summary,
	model: Pick<UseInModel, "connectionId" | "modelId">
): boolean {
	return (
		loadout.filled &&
		loadout.connectionId === model.connectionId &&
		loadout.connectionModelId === model.modelId
	)
}

/**
 * The menu: one group per job the model can do that has a loadout, chat
 * first, then in the order the server listed its jobs; within a group the
 * default first, then the rest by name.
 */
export function useInGroups(
	model: UseInModel,
	loadouts: readonly Summary[],
	transforms: readonly { id: string; label: string }[] = []
): UseInGroup[] {
	const serves = new Set(model.capabilities)
	const order = [
		"text->text",
		...transforms.map((t) => t.id),
		...model.capabilities
	].filter((id, i, all) => serves.has(id) && all.indexOf(id) === i)

	const groups: UseInGroup[] = []
	for (const transform of order) {
		const mine = loadouts.filter(
			(l) => l.transform === transform && l.mergedInto == null
		)
		if (!mine.length) continue
		mine.sort((a, b) => {
			const byDefault =
				Number(b.defaultFor === transform) -
				Number(a.defaultFor === transform)
			return (
				byDefault ||
				a.name.localeCompare(b.name, undefined, {
					sensitivity: "base",
					numeric: true
				}) ||
				a.id - b.id
			)
		})
		groups.push({
			transform,
			label:
				transforms.find((t) => t.id === transform)?.label ?? transform,
			items: mine.map((l) => ({
				id: l.id,
				name: l.name,
				transform,
				isDefault: l.defaultFor === transform,
				current: isCurrent(l, model),
				state: useInState(l, model)
			}))
		})
	}
	return groups
}

/** "Mistral Small now runs Tool calling" — said when a pick lands. */
export function useInSentence(modelName: string, loadoutName: string): string {
	return `${modelName} now runs ${loadoutName}`
}
