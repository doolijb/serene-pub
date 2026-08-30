/**
 * TOTP core (plan 26 §10).
 *
 * The interop assertion that matters is RFC 6238's own test vectors — an
 * implementation that reproduces them is correct against every authenticator
 * app, which is not something a hand-rolled fixture can tell you.
 */
import { describe, expect, test } from "vitest"
import {
	base32Decode,
	base32Encode,
	buildOtpauthUri,
	computeCode,
	generateRecoveryCodes,
	generateSecret,
	hashRecoveryCode,
	normalizeRecoveryCode,
	timeStep,
	verifyTotp,
	TOTP_STEP_SECONDS
} from "./index"

/** RFC 6238 Appendix B: ASCII "12345678901234567890", SHA-1. */
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"))

describe("RFC 6238 test vectors", () => {
	test.each([
		[59, "94287082"],
		[1111111109, "07081804"],
		[1111111111, "14050471"],
		[1234567890, "89005924"],
		[2000000000, "69279037"],
		[20000000000, "65353130"]
	])("unix time %i produces %s", (unixTime, expected) => {
		const step = Math.floor(unixTime / TOTP_STEP_SECONDS)
		expect(computeCode(RFC_SECRET, step, 8)).toBe(expected)
	})

	test("the six-digit form is the last six digits of the same value", () => {
		const step = Math.floor(59 / TOTP_STEP_SECONDS)
		expect(computeCode(RFC_SECRET, step, 6)).toBe("287082")
	})
})

describe("base32", () => {
	test("round-trips arbitrary bytes", () => {
		const buf = Buffer.from([0, 1, 127, 128, 255, 42, 7])
		expect(base32Decode(base32Encode(buf))).toEqual(buf)
	})

	test("tolerates the spacing and case a hand-typed secret arrives in", () => {
		const secret = base32Encode(
			Buffer.from("12345678901234567890", "ascii")
		)
		const mangled = secret.toLowerCase().replace(/(.{4})/g, "$1 ")
		expect(base32Decode(mangled)).toEqual(base32Decode(secret))
	})

	test("rejects a character outside the alphabet rather than decoding garbage", () => {
		expect(() => base32Decode("ABC!DEF")).toThrow(/Invalid base32/)
	})
})

describe("verifyTotp", () => {
	const now = new Date(1_700_000_000_000)
	const secret = generateSecret()

	test("accepts the current step and reports which step it was", () => {
		const code = computeCode(secret, timeStep(now))
		const res = verifyTotp({ secret, code, now })
		expect(res.valid).toBe(true)
		expect(res.step).toBe(timeStep(now))
	})

	test("accepts one step of drift either side", () => {
		for (const offset of [-1, 1]) {
			const code = computeCode(secret, timeStep(now) + offset)
			expect(verifyTotp({ secret, code, now }).valid).toBe(true)
		}
	})

	test("rejects two steps out — drift tolerance is not open-ended", () => {
		for (const offset of [-2, 2]) {
			const code = computeCode(secret, timeStep(now) + offset)
			const res = verifyTotp({ secret, code, now })
			expect(res.valid).toBe(false)
			expect(res.reason).toBe("mismatch")
		}
	})

	test("refuses to reuse a step that has already been spent", () => {
		const step = timeStep(now)
		const code = computeCode(secret, step)
		// Without this an intercepted code stays usable for the whole step plus
		// the drift window either side — up to ~90 seconds.
		const res = verifyTotp({ secret, code, now, lastUsedStep: step })
		expect(res.valid).toBe(false)
		expect(res.reason).toBe("replayed")
	})

	test("refuses an older step even though it is inside the drift window", () => {
		const step = timeStep(now)
		const code = computeCode(secret, step - 1)
		const res = verifyTotp({ secret, code, now, lastUsedStep: step })
		expect(res.valid).toBe(false)
		expect(res.reason).toBe("replayed")
	})

	test("still accepts the next step after one is spent", () => {
		const step = timeStep(now)
		const later = new Date(now.getTime() + TOTP_STEP_SECONDS * 1000)
		const code = computeCode(secret, step + 1)
		expect(
			verifyTotp({ secret, code, now: later, lastUsedStep: step }).valid
		).toBe(true)
	})

	test("rejects malformed input without consulting the secret", () => {
		for (const code of ["", "12345", "1234567", "abcdef", "12 34 5"]) {
			expect(verifyTotp({ secret, code, now }).reason).toBe("malformed")
		}
	})

	test("tolerates spaces inside an otherwise valid code", () => {
		const code = computeCode(secret, timeStep(now))
		const spaced = `${code.slice(0, 3)} ${code.slice(3)}`
		expect(verifyTotp({ secret, code: spaced, now }).valid).toBe(true)
	})

	test("a code from a different secret never verifies", () => {
		const other = generateSecret()
		const code = computeCode(other, timeStep(now))
		expect(verifyTotp({ secret, code, now }).valid).toBe(false)
	})
})

describe("buildOtpauthUri", () => {
	test("carries the issuer in both the label and the parameters", () => {
		const uri = buildOtpauthUri({ username: "jody", secret: "ABCD" })
		// Apps disagree about which they read; getting it wrong shows the user
		// six unlabelled digits.
		expect(uri).toContain("otpauth://totp/Serene%20Pub%3Ajody")
		expect(uri).toContain("issuer=Serene+Pub")
		expect(uri).toContain("secret=ABCD")
		expect(uri).toContain("period=30")
	})
})

describe("recovery codes", () => {
	test("generates the expected count, all distinct", () => {
		const codes = generateRecoveryCodes()
		expect(codes).toHaveLength(10)
		expect(new Set(codes).size).toBe(10)
	})

	test("omits characters that are misread when copied by hand", () => {
		const codes = generateRecoveryCodes(50).join("")
		for (const confusable of ["O", "0", "I", "1"]) {
			expect(codes).not.toContain(confusable)
		}
	})

	test("normalisation makes the displayed form and the typed form agree", () => {
		const [code] = generateRecoveryCodes(1)
		expect(code).toContain("-")
		// However the user retypes it, it has to hash to the stored value.
		expect(hashRecoveryCode(code)).toBe(
			hashRecoveryCode(normalizeRecoveryCode(code).toLowerCase())
		)
		expect(hashRecoveryCode(code)).toBe(
			hashRecoveryCode(` ${code.replace("-", " ")} `)
		)
	})

	test("different codes hash differently", () => {
		const [a, b] = generateRecoveryCodes(2)
		expect(hashRecoveryCode(a)).not.toBe(hashRecoveryCode(b))
	})
})
