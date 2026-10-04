/**
 * The build is offered in every book: the summarization switch that used to
 * gate it is gone (0126), so the answer stands as a seam a future gate would
 * sit in rather than as a question about the instance. Which canvas a lens
 * draws, and whether a lens is offered, are the lens registry's
 * (`lenses/registry.test.ts`).
 */
import { describe, expect, it } from "vitest"
import { graphBuildReason } from "./graphs"

describe("graphBuildReason — why the graph cannot be built from a session", () => {
	it("offers the build with no setting to ask", () => {
		expect(graphBuildReason()).toBeNull()
	})
})
