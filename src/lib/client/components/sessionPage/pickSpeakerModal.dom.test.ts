/** Pick who speaks lists card-less seats and sends each seat's ref. */
import { afterEach, describe, expect, test } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import PickSpeakerModal from "./PickSpeakerModal.svelte"

let apps: ReturnType<typeof mount>[] = []
afterEach(() => {
	for (const app of apps) unmount(app)
	apps = []
	document.body.innerHTML = ""
})

async function open(search = "") {
	const picked: string[] = []
	const host = document.createElement("div")
	document.body.append(host)
	apps.push(
		mount(PickSpeakerModal, {
			target: host,
			props: {
				open: true,
				onOpenChange: () => {},
				sessionCharacters: [
					{
						id: 1,
						characterId: null,
						castMemberId: 7,
						character: null,
						removedAt: null,
						ref: "seated-member:7"
					},
					{
						id: 2,
						characterId: 3,
						castMemberId: 50,
						character: {
							id: 3,
							name: "Adeline",
							nickname: null,
							description: "A bard."
						},
						removedAt: null,
						ref: "seated-member:50"
					}
				] as any,
				cardlessSeatShown: {
					7: { name: "Nobody", nickname: "Nob", faceMediaId: null }
				},
				pickSpeakerSearch: search,
				narratorTurn: false,
				narratorFunction: false,
				narratorRowChip: undefined,
				ownVoice: "",
				narratorName: "",
				onNarratorRow: () => {},
				onPickSpeaker: (ref: string) => picked.push(ref)
			}
		})
	)
	flushSync()
	await tick()
	return picked
}

const rowButtons = () =>
	[...document.querySelectorAll("button")].filter((b) =>
		/Nob|Adeline/.test(b.textContent ?? "")
	)

describe("PickSpeakerModal", () => {
	test("a card-less seat is listed and pressing it sends seated-member:<M>", async () => {
		const picked = await open()
		const btn = rowButtons().find((b) => b.textContent?.includes("Nob"))
		expect(btn).toBeTruthy()
		btn!.click()
		expect(picked).toEqual(["seated-member:7"])
	})

	test("a carded seat sends its host-filled ref", async () => {
		const picked = await open()
		rowButtons()
			.find((b) => b.textContent?.includes("Adeline"))!
			.click()
		expect(picked).toEqual(["seated-member:50"])
	})

	test("search matches a card-less row's shown name", async () => {
		await open("nob")
		expect(rowButtons().length).toBe(1)
	})
})
