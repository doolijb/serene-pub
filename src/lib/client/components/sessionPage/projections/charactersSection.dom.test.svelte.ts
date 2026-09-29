/**
 * The page's live `characters.v1`: the page replaces its session payload on
 * every streamed chunk, and a chunk that changes no member's current sprite
 * must leave the section exactly as it was (no rebuild, nothing new for a
 * widget's wire to serialise). A new current sprite, a sprite-set pick, a
 * pin and the voiced persona each still move it.
 */
import { afterEach, describe, expect, test } from "vitest"
import { flushSync } from "svelte"
import type { SessionCharactersV1 } from "@serene-pub/sdk"
import { charactersSection } from "./charactersSection.svelte"

const ada = {
	id: 3,
	userId: 20,
	name: "Ada",
	spriteSets: [
		{
			name: "Casual",
			isDefault: true,
			sprites: [
				{ label: "neutral", position: 0, file: { uuid: "00000000-0000-4000-8000-000000000002", rev: 1 } },
				{ label: "happy", position: 0, file: { uuid: "00000000-0000-4000-8000-000000000003", rev: 1 } }
			]
		}
	]
}
const wren = { id: 9, userId: 30, name: "Wren" }
const moss = { id: 11, userId: 30, name: "Moss" }

type Msg = { id: number; characterId: number; content: string; metadata?: unknown }
const line = (id: number, content: string, label = "neutral"): Msg => ({
	id,
	characterId: 3,
	content,
	metadata: { sprite: { set: "Casual", label } }
})

let stop: (() => void) | null = null
afterEach(() => {
	stop?.()
	stop = null
})

function open() {
	let session = $state<any>({
		id: 5,
		userId: 30,
		sessionCharacters: [{ isActive: true, removedAt: null, position: 0, character: ada }],
		sessionPersonas: [
			{ removedAt: null, position: 0, persona: wren },
			{ removedAt: null, position: 1, persona: moss }
		],
		spriteSetOverrides: {},
		sessionMessages: [line(1, "Hello")]
	})
	let voiced = $state<number | null>(null)
	let pins = $state<{ left: string | null; right: string | null }>({ left: null, right: null })
	const builds: SessionCharactersV1[] = []
	stop = $effect.root(() => {
		const section = charactersSection({
			sessionId: () => 5,
			session: () => session,
			viewerUserId: () => 30,
			voicedPersonaId: () => voiced,
			sceneImages: () => pins
		})
		$effect(() => {
			const now = section.current
			if (now && builds[builds.length - 1] !== now) builds.push(now)
		})
	})
	flushSync()
	return {
		builds,
		/** The page's chunk handler: the payload replaced, one line's content grown. */
		stream(msgs: Msg[]) {
			session = { ...session, sessionMessages: msgs }
			flushSync()
		},
		pick(set: string) {
			session.spriteSetOverrides = { 3: set }
			flushSync()
		},
		voice(id: number) {
			voiced = id
			flushSync()
		},
		pin(left: string) {
			pins = { left, right: null }
			flushSync()
		}
	}
}

describe("charactersSection", () => {
	test("a streamed chunk that moves no current sprite leaves the section as it was", () => {
		const page = open()
		expect(page.builds).toHaveLength(1)
		page.stream([line(1, "Hello"), line(2, "Th")])
		page.stream([line(1, "Hello"), line(2, "The r")])
		page.stream([line(1, "Hello"), line(2, "The rain came")])
		expect(page.builds).toHaveLength(1)
	})

	test("a new current sprite, a pick, the voiced persona and a pin each rebuild it", () => {
		const page = open()
		const ada = () => page.builds[page.builds.length - 1].members.find((m) => m.characterId === 3)!
		const neutral = ada().sprite

		page.stream([line(1, "Hello"), line(2, "Ha!", "happy")])
		expect(page.builds).toHaveLength(2)
		expect(ada().sprite).not.toBe(neutral)

		page.voice(11)
		expect(page.builds).toHaveLength(3)
		expect(page.builds[2].members.filter((m) => m.mine).map((m) => m.characterId)).toEqual([11])

		page.pin("/somewhere.png")
		expect(page.builds).toHaveLength(4)
		expect(page.builds[3].sceneImages.left).toEqual({ src: "/somewhere.png", ref: null })

		page.pick("Casual")
		expect(page.builds).toHaveLength(5)
		expect(ada().spriteSet).toBe("Casual")
	})
})
