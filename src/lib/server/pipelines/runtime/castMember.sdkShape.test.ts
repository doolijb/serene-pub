/**
 * The app's character profile is the SDK's: the same fields, the same shape.
 * Needs the SDK built (`npm run sdk:build`).
 */
import { describe, expect, expectTypeOf, test } from "vitest"
import * as SDK from "@serene-pub/sdk"
import type { CharacterProfileV1 as SdkProfile } from "@serene-pub/sdk"
import {
	CHARACTER_PROFILE_FIELDS,
	type CharacterProfileV1 as AppProfile
} from "$lib/shared/characters/profile"

describe("the character profile", () => {
	test("the SDK and the app name the same fields", () => {
		expect([...SDK.CHARACTER_PROFILE_FIELDS]).toEqual([
			...CHARACTER_PROFILE_FIELDS
		])
	})
	test("the SDK and the app share one profile shape", () => {
		expectTypeOf<AppProfile>().toEqualTypeOf<SdkProfile>()
	})
})
