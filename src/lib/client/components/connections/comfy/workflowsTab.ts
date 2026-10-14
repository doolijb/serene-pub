/**
 * 🚧 What the **Workflows tab** says about each workflow, decided away from
 * the markup (DESIGN-image-generation §4.9, §4.12). Pure; tested in
 * `workflowsTab.test.ts`.
 *
 * A workflow is server-agnostic, so the tab lists every `comfyui` workflow and
 * says, per row, whether it fits THIS ComfyUI — from the server's cached
 * `/object_info` (`workflows:onServer`). A silent fact is left out, never
 * guessed: a ComfyUI nobody has tested yet says *Not checked*, not *ready*.
 */

export type ValidityTone = "ready" | "missing" | "unchecked"

export interface ValidityChip {
	tone: ValidityTone
	/** The chip's words. */
	label: string
	/** The whole sentence, for the title and a screen reader. */
	detail: string
}

type OnServer = Sockets.Workflows.OnServer.Response

/** The chip for one workflow on this server. */
export function validityChip(
	workflowId: number,
	onServer: Pick<OnServer, "checked" | "results"> | null | undefined
): ValidityChip {
	if (!onServer?.checked)
		return {
			tone: "unchecked",
			label: "Not checked",
			detail: "Test this connection so Serene Pub can read which nodes and models your ComfyUI has."
		}
	const r = onServer.results.find((x) => x.workflowId === workflowId)
	if (!r)
		return { tone: "unchecked", label: "Not checked", detail: "Not checked against this server yet." }
	if (!r.problem) return { tone: "ready", label: "ready", detail: "Fits this ComfyUI." }
	const label = r.missingNodes.length
		? `Missing nodes: ${r.missingNodes.join(", ")}`
		: r.missingNames.length
			? `This workflow names ${r.missingNames[0]}; your ComfyUI doesn't have it`
			: r.problem
	return { tone: "missing", label, detail: r.problem }
}

/** The first workflow that fits this server, else the first listed — the Draw a test default. */
export function firstReadyWorkflow(
	workflows: readonly { id: number }[],
	onServer: Pick<OnServer, "checked" | "results"> | null | undefined
): number | null {
	const ready = workflows.find((w) => validityChip(w.id, onServer).tone === "ready")
	return ready?.id ?? workflows[0]?.id ?? null
}

/** The row's menu, by whether it is a shipped starter (read-only: no Delete, no Edit). */
export function rowActions(w: { isStarter: boolean }): Array<
	"edit" | "view" | "duplicate" | "export" | "exportDefaults" | "delete"
> {
	return w.isStarter
		? ["view", "duplicate", "export", "exportDefaults"]
		: ["edit", "duplicate", "export", "exportDefaults", "delete"]
}

/**
 * The nodes of a document with holes that could carry the output mark
 * (`SaveImage` / `PreviewImage`). A bare hole (`"seed": {{seed}}`) is not
 * JSON, so it is read with each one stood in for a number first. Empty when
 * the text does not read at all.
 */
export function outputCandidates(document: string): Array<{ nodeId: string; classType: string }> {
	let graph: unknown
	try {
		graph = JSON.parse(document.replace(/(:\s*)\{\{[^{}]+\}\}/g, "$10"))
	} catch {
		return []
	}
	if (!graph || typeof graph !== "object") return []
	return Object.entries(graph as Record<string, { class_type?: unknown }>)
		.filter(([, n]) => n && (n.class_type === "SaveImage" || n.class_type === "PreviewImage"))
		.map(([nodeId, n]) => ({ nodeId, classType: String(n.class_type) }))
}

/** Is this pasted text a ComfyUI UI save (the refusal is the server's, verbatim)? */
export const looksLikeJson = (text: string): boolean => /^\s*[{[]/.test(text)
