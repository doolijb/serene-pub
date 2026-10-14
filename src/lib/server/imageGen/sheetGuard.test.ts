import { describe, expect, test } from "vitest"
import {
	CUT_OUT_REFUSAL,
	REFERENCES_NOTICE,
	REFERENCES_REFUSAL,
	judgeSheet,
	referencesCappedNotice
} from "./sheetGuard"
import {
	A1111_SHEET,
	KOBOLDCPP_EDIT_SHEET
} from "$lib/server/imageAdapters/A1111Adapter"
import type { DrawingSheet } from "$lib/shared/imageGen/types"

/**
 * Needs against the sheet (DESIGN-image-generation §4.6): a hard need the
 * pair lacks refuses at bind; a soft one runs and says so first.
 */

const none = { references: 0, init: false, mask: false }
const nativeAlpha: DrawingSheet = { ...A1111_SHEET, transparent: "native" }

describe("references", () => {
	test("required on a sheet with no reference input refuses", () => {
		const v = judgeSheet(A1111_SHEET, {
			...none,
			references: 1,
			referencesPolicy: "required"
		})
		expect(v.refusal).toBe(REFERENCES_REFUSAL)
		// The copy names the need, never a vendor.
		expect(v.refusal).not.toMatch(/comfy|kobold|a1111|openai/i)
	})

	test("preferred (the default) runs, with a pre-run notice", () => {
		const v = judgeSheet(A1111_SHEET, { ...none, references: 1 })
		expect(v.refusal).toBeNull()
		expect(v.preRunNotices).toEqual([REFERENCES_NOTICE])
	})

	test("a pair that takes them says nothing", () => {
		const v = judgeSheet(KOBOLDCPP_EDIT_SHEET, {
			...none,
			references: 2,
			referencesPolicy: "required"
		})
		expect(v).toMatchObject({ refusal: null, preRunNotices: [] })
	})

	test("more than the sheet takes is a notice, not a refusal", () => {
		const v = judgeSheet(KOBOLDCPP_EDIT_SHEET, { ...none, references: 6 })
		expect(v.refusal).toBeNull()
		expect(v.preRunNotices).toEqual([referencesCappedNotice(4)])
	})

	test("an empty port is no need at all, even when required", () => {
		const v = judgeSheet(A1111_SHEET, { ...none, referencesPolicy: "required" })
		expect(v).toMatchObject({ refusal: null, preRunNotices: [] })
	})
})

describe("cut-out", () => {
	test("native-only on a pair that draws no transparency refuses", () => {
		expect(judgeSheet(A1111_SHEET, { ...none, cutOut: "native-only" }).refusal).toBe(
			CUT_OUT_REFUSAL
		)
	})

	test("native-or-task asks the model where it can", () => {
		expect(judgeSheet(nativeAlpha, { ...none, cutOut: "native-or-task" })).toMatchObject({
			refusal: null,
			transparent: true,
			needsCutOut: false
		})
	})

	test("native-or-task flags the pictures for the cut-out task where it cannot", () => {
		expect(judgeSheet(A1111_SHEET, { ...none, cutOut: "native-or-task" })).toMatchObject({
			refusal: null,
			transparent: false,
			needsCutOut: true
		})
	})

	test("off asks for nothing", () => {
		expect(judgeSheet(nativeAlpha, none)).toMatchObject({
			transparent: false,
			needsCutOut: false
		})
	})
})
