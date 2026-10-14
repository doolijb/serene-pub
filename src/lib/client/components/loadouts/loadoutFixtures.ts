/** A loadout summary for the Loadouts view's unit tests. */
type Summary = Sockets.Loadouts.Summary

export function summary(over: Partial<Summary> = {}): Summary {
	return {
		id: 1,
		loadoutId: "core:loadout/reply@1",
		slug: "reply",
		name: "Reply",
		description: "Writes replies.",
		owner: "core",
		transform: "text->text",
		connectionId: null,
		connectionModelId: null,
		connectionName: null,
		modelName: null,
		connectionType: null,
		samplingConfigId: null,
		samplingName: null,
		workflowId: null,
		workflowValues: null,
		tier: null,
		defaultFor: null,
		mergedInto: null,
		mergedIntoName: null,
		filled: false,
		fallbackName: null,
		consequence: null,
		usedBy: { steps: 0, pipelines: [] },
		grades: {},
		...over
	}
}
