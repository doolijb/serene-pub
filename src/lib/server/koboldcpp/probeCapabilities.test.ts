import { describe, expect, test } from "vitest"
import { capabilitiesFromFlags, flagsFrom, NO_FLAGS } from "./probeCapabilities"
import { resolveCapabilities, satisfies } from "@serene-pub/sdk"
import { adapterCapabilities } from "$lib/shared/connectionAdapters/manifest"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

/**
 * The KoboldCPP probe — the layer the whole capability model was built for.
 *
 * KoboldCPP writes replies and draws pictures from one process, so what it can
 * do is a property of which models are loaded, not of which software is running.
 * Its manifest entry says `text->image` is unproven, which means nothing but a
 * probe can ever switch it on.
 */

describe("reading the version endpoint's flags", () => {
	test("maps each flag to the capability it means", () => {
		const caps = capabilitiesFromFlags(
			flagsFrom({
				version: "1.86",
				txt2img: true,
				vision: true,
				tts: false,
				transcribe: false,
				embeddings: true
			})
		)
		expect(caps).toMatchObject({
			"text->image": 1,
			"text+image->text": 1,
			"text->embedding": 1
		})
	})

	test("a false flag is an explicit `none`, never an omission", () => {
		// A probe is an ANSWER. "The server says it cannot draw" has to be able
		// to switch OFF something an optimistic preset turned on, and a key left
		// out would let the older layer stand instead.
		const caps = capabilitiesFromFlags(NO_FLAGS)
		expect(caps["text->image"]).toBe(0)
		expect("text->image" in caps).toBe(true)
	})

	test("text generation is not conditional on a flag", () => {
		// This endpoint answering at all is a KoboldCPP that generates text —
		// there is no `txt2txt` flag to consult, and treating its absence as
		// "cannot chat" would refuse every KoboldCPP connection in existence.
		expect(capabilitiesFromFlags(NO_FLAGS)["text->text"]).toBe(1)
	})

	test("server features are not capabilities", () => {
		// `multiplayer`, `websearch` and `admin` are things the server does, not
		// things a model turns one kind of data into.
		const caps = capabilitiesFromFlags(
			flagsFrom({ multiplayer: true, websearch: true, admin: true })
		)
		expect(Object.keys(caps)).not.toContain("multiplayer")
		expect(Object.keys(caps)).not.toContain("websearch")
	})

	test("a junk payload reads as all-off rather than throwing", () => {
		// An unreachable or mid-restart server is routine, not a fault.
		expect(flagsFrom(undefined)).toEqual(NO_FLAGS)
		expect(flagsFrom("nonsense")).toEqual(NO_FLAGS)
	})
})

describe("the probe against the manifest — the Phase 4 gate", () => {
	const resolveFor = (flags: Parameters<typeof capabilitiesFromFlags>[0]) =>
		resolveCapabilities({
			adapter: adapterCapabilities(CONNECTION_TYPE.KOBOLDCPP)!,
			probe: capabilitiesFromFlags(flags)
		})

	test("a KoboldCPP started with an image model can draw", () => {
		const caps = resolveFor(flagsFrom({ txt2img: true }))
		expect(satisfies({ requires: ["text->image"] }, caps).ok).toBe(true)
	})

	test("one started without an image model cannot", () => {
		const caps = resolveFor(flagsFrom({ txt2img: false }))
		expect(satisfies({ requires: ["text->image"] }, caps).ok).toBe(false)
		// ...and still answers replies, which is the whole point of not having
		// one scalar decide.
		expect(satisfies({ requires: ["text->text"] }, caps).ok).toBe(true)
	})

	test("unprobed, image generation is off — `until: none`, not optimism", () => {
		// The state every KoboldCPP row is in until somebody presses Test. It
		// must be OFF: offering a connection that cannot draw fails at the
		// backend, where nobody can see why.
		const caps = resolveCapabilities({
			adapter: adapterCapabilities(CONNECTION_TYPE.KOBOLDCPP)!
		})
		expect(satisfies({ requires: ["text->image"] }, caps).ok).toBe(false)
	})

	test("the flags this app cannot yet act on are still recorded, and still discarded", () => {
		// ⚠ Two assertions that look contradictory and are not, which is why they
		// share a test: the probe MUST keep answering for speech, transcription and
		// embeddings, and resolution MUST ignore all three.
		//
		// The manifest declares none of them for either KoboldCPP type, because
		// nothing implements `synthesizeSpeech`, `transcribeAudio` or `embedText`
		// and the key space is derived from which actions exist. `resolveCapabilities`
		// iterates `supports` only, so an answer to a question nobody asked cannot
		// grant anything — which is correct, and is what stops a capability being
		// switchable and uncallable.
		//
		// The mapping stays anyway, because the probe records what the SERVER said
		// and that outlives what this app can do with it: the day one of those
		// actions lands, the key returns and every already-tested connection
		// resolves it with no re-test. If somebody "cleans up" the three lines in
		// `capabilitiesFromFlags` to match what resolution consumes, the first half
		// of this test is what stops them.
		const found = capabilitiesFromFlags(
			flagsFrom({ tts: true, transcribe: true, embeddings: true })
		)
		expect(found).toMatchObject({
			"text->audio": 1,
			"audio->text": 1,
			"text->embedding": 1
		})

		const resolved = resolveFor(
			flagsFrom({ tts: true, transcribe: true, embeddings: true })
		)
		for (const id of [
			"text->audio",
			"audio->text",
			"text->embedding"
		] as const)
			expect(satisfies({ requires: [id] }, resolved).ok).toBe(false)
	})

	test("the type still says text — which is exactly why the probe exists", () => {
		// The regression guard for the bug this replaced: `isImage` is the check
		// that refused KoboldCPP an image node for being what it is, and it is
		// still false here. Nothing about a drawing KoboldCPP changes its type.
		expect(CONNECTION_TYPE.isImage(CONNECTION_TYPE.KOBOLDCPP)).toBe(false)
		const caps = resolveFor(flagsFrom({ txt2img: true }))
		expect(satisfies({ requires: ["text->image"] }, caps).ok).toBe(true)
	})
})
