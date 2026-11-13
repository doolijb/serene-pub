import { describe, expect, it } from "vitest"
import { imageFamilyLabel, parseRecommendedImageYaml } from "./recommendedImageGguf"

const YAML = `
# comment
- file: picx_real_q8_0.gguf
  family: sd15
  display_name: PicX Real
  description: Photoreal SD 1.5 finetune at 512², a good first image model.
  sampling: sampling-image-default
  recommended_vram: 4
  single_file: true

- file: hidream_o1_image_dev_q5_1.gguf
  family: hidream
  display_name: "HiDream O1 (dev)"
  description: Needs Clip and T5-XXL beside it.
  sampling: sampling-image-flux
  single_file: false
`

describe("the recommended image list", () => {
	it("reads flat entries by file, with the family, sentence, preset and the single-file flag", () => {
		const entries = parseRecommendedImageYaml(YAML)
		expect(entries).toHaveLength(2)
		expect(entries[0]).toEqual({
			file: "picx_real_q8_0.gguf",
			family: "sd15",
			display_name: "PicX Real",
			description: "Photoreal SD 1.5 finetune at 512², a good first image model.",
			sampling: "sampling-image-default",
			single_file: true,
			recommended_vram: 4
		})
		expect(entries[1].display_name).toBe("HiDream O1 (dev)")
		expect(entries[1].single_file).toBe(false)
		// No figure given reads as 0, which the card then withholds.
		expect(entries[1].recommended_vram).toBe(0)
	})
	it("names a family for a person, and passes an unknown one through", () => {
		expect(imageFamilyLabel("sdxl")).toBe("SDXL")
		expect(imageFamilyLabel("distilled")).toBe("Distilled SD")
		expect(imageFamilyLabel("wan")).toBe("wan")
	})
})
