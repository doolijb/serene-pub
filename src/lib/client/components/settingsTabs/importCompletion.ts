/**
 * What the SillyTavern import's completion screen and toast say for how the
 * import ended (`Import.SillyTavern.Execute.Response.conclusion`). Only a clean
 * import reads as a success: one where an item failed, one that stopped
 * partway and one that landed nothing each say so in the heading.
 */
export type ImportConclusion = NonNullable<
	Sockets.Import.SillyTavern.Execute.Response["conclusion"]
>

export interface ImportCompletion {
	heading: string
	toast: string
	tone: "success" | "warning"
}

export function importCompletionOf(conclusion: ImportConclusion): ImportCompletion {
	switch (conclusion) {
		case "complete":
			return { heading: "Import complete", toast: "Import completed", tone: "success" }
		case "partial":
			return {
				heading: "Import finished with errors",
				toast: "Import finished with errors",
				tone: "warning"
			}
		case "stopped":
			return {
				heading: "Import stopped early",
				toast: "Import stopped early",
				tone: "warning"
			}
		case "nothing":
			return {
				heading: "Nothing was imported",
				toast: "Nothing was imported",
				tone: "warning"
			}
	}
}
