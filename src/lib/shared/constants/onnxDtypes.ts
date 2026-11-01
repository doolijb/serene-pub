/**
 * The weight precisions transformers.js can be asked for, as the model finder
 * offers them. A list entry may publish a subset as `dtypes`; "add by id"
 * offers all four.
 */
export const ONNX_DTYPES = ["fp32", "fp16", "q8", "q4"] as const

export type OnnxDtype = (typeof ONNX_DTYPES)[number]

export const isOnnxDtype = (v: unknown): v is OnnxDtype =>
	typeof v === "string" && (ONNX_DTYPES as readonly string[]).includes(v)
