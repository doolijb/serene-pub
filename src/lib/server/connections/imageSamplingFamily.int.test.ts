/**
 * 🚧 Use and the image sampling preset (owner ruling 2026-11-08): the preset
 * follows what the model FILE says, never a file name. A managed KoboldCPP
 * image GGUF carries `general.architecture`; anything else leaves the preset
 * and says where to switch it; an admin's own sampling config is never
 * touched.
 */
import { beforeEach, describe, expect, it } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { capabilityDefault, setCapabilityDefault } from "./capabilityDefaults"
import { imagePresetForArchitecture, settleImageSamplingAfterUse } from "./imageSamplingFamily"

let db: TestDb
let imageDir: string

/** GGUF's length-prefixed UTF-8 string: u64-LE byte count, then the bytes. */
function gstr(s: string): Buffer {
	const bytes = Buffer.from(s, "utf8")
	const len = Buffer.alloc(8)
	len.writeBigUInt64LE(BigInt(bytes.length))
	return Buffer.concat([len, bytes])
}
const u32 = (n: number) => {
	const b = Buffer.alloc(4)
	b.writeUInt32LE(n)
	return b
}
const u64 = (n: number) => {
	const b = Buffer.alloc(8)
	b.writeBigUInt64LE(BigInt(n))
	return b
}
/** A GGUF whose only metadata is `general.architecture`. */
const ggufWithArch = (arch: string) =>
	Buffer.concat([
		Buffer.from("GGUF", "latin1"),
		u32(3),
		u64(112),
		u64(1),
		gstr("general.architecture"),
		u32(8),
		gstr(arch)
	])

beforeEach(async () => {
	db = await createTestDb()
	imageDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-image-family-"))
	await db.insert(schema.koboldCppSettings).values({
		id: 1,
		koboldCppManagerEnabled: true,
		koboldCppManagerModelsDir: path.join(imageDir, "llm"),
		koboldCppImageModelsDir: imageDir
	} as any)
	await db.insert(schema.samplingConfigs).values([
		{ seedKey: "sampling-image-default", name: "SD 1.5", isImmutable: true, shape: "core:shape/image-gen@1", values: { width: 512 }, enabled: ["width"] },
		{ seedKey: "sampling-image-sdxl", name: "SDXL", isImmutable: true, shape: "core:shape/image-gen@1", values: { width: 1024 }, enabled: ["width"] },
		{ seedKey: null, name: "Mine", isImmutable: false, shape: "core:shape/image-gen@1", values: { width: 768 }, enabled: ["width"] }
	] as any)
}, 60_000)

async function sampling(name: string) {
	const [row] = await db.select().from(schema.samplingConfigs).where((await import("drizzle-orm")).eq(schema.samplingConfigs.name, name))
	return row!
}

async function pair(type: string, file: string) {
	const [conn] = await db
		.insert(schema.connections)
		.values({ name: `img ${file}`, type, modality: "image-gen", baseUrl: "http://localhost:7860", extraJson: {}, capabilities: {} } as any)
		.returning()
	const [model] = await db
		.insert(schema.connectionModels)
		.values({ connectionId: conn!.id, model: file, name: file, enabled: true })
		.returning()
	return { connectionId: conn!.id, connectionModelId: model!.id }
}

async function useIn(p: { connectionId: number; connectionModelId: number }, samplingName: string) {
	await setCapabilityDefault(db as any, "text->image", { ...p, samplingConfigId: (await sampling(samplingName)).id })
	return settleImageSamplingAfterUse(db as any, "text->image", p)
}

const currentSamplingName = async () => {
	const d = await capabilityDefault(db as any, "text->image")
	const [row] = await db.select().from(schema.samplingConfigs).where((await import("drizzle-orm")).eq(schema.samplingConfigs.id, d!.samplingConfigId!))
	return row!.name
}

describe("the architecture → preset table", () => {
	it("maps the families a core preset is written for, by prefix, and nothing else", () => {
		expect(imagePresetForArchitecture("sdxl")).toBe("sampling-image-sdxl")
		expect(imagePresetForArchitecture("sd1")).toBe("sampling-image-default")
		expect(imagePresetForArchitecture("flux1")).toBe("sampling-image-flux")
		expect(imagePresetForArchitecture("sd3")).toBe("sampling-image-sd3")
		expect(imagePresetForArchitecture("hidream")).toBeNull()
		expect(imagePresetForArchitecture("")).toBeNull()
		expect(imagePresetForArchitecture(null)).toBeNull()
	})
})

describe("settling the sampling preset after Use", () => {
	it("a managed KoboldCPP GGUF whose header says sdxl moves the seeded SD 1.5 preset to SDXL", async () => {
		await fs.writeFile(path.join(imageDir, "dreamshaperXL.gguf"), ggufWithArch("sdxl"))
		const p = await pair(CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE, "dreamshaperXL.gguf")
		const note = await useIn(p, "SD 1.5")
		expect(note).toBe("Sampling set to SDXL, read from the model file.")
		expect(await currentSamplingName()).toBe("SDXL")
	})

	it("a header that already matches says so and changes nothing", async () => {
		await fs.writeFile(path.join(imageDir, "picx.gguf"), ggufWithArch("sd1"))
		const p = await pair(CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE, "picx.gguf")
		expect(await useIn(p, "SD 1.5")).toBe("Sampling is SD 1.5, read from the model file.")
		expect(await currentSamplingName()).toBe("SD 1.5")
	})

	it("a checkpoint nothing can be read from keeps the preset and says where to switch it — never a guess from the name", async () => {
		const p = await pair(CONNECTION_TYPE.COMFYUI, "sd_xl_base_1.0.safetensors")
		expect(await useIn(p, "SD 1.5")).toBe(
			"Sampling stays SD 1.5 — switch it on the loadout if this is an SDXL, SD 3 or Flux model."
		)
		expect(await currentSamplingName()).toBe("SD 1.5")
	})

	it("an admin's own sampling config is left alone and unmentioned", async () => {
		await fs.writeFile(path.join(imageDir, "xl.gguf"), ggufWithArch("sdxl"))
		const p = await pair(CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE, "xl.gguf")
		expect(await useIn(p, "Mine")).toBeNull()
		expect(await currentSamplingName()).toBe("Mine")
	})
})
