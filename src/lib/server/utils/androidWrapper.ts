/**
 * True when running inside the bundled Android app wrapper (NodeService.kt sets
 * this env var before spawning the server). Used to hide features that don't
 * make sense in that sandbox — managed local model runners need a binary we
 * don't/can't bundle for Android, and on-device embedding models are an
 * unverified native-dependency risk there.
 *
 * ⚠ Its own module for the reason `./appDataDir` is: `utils/index.ts` pulls in
 * `$lib/server/db` and the media stack. `localModels/onnxRuntime.ts` needs only
 * this check, and it sits on the boot path (`db/defaults.ts` →
 * `connections/localOnnxConnections.ts`), where importing the barrel binds
 * `checkSessionAccess`'s default handle — and every module the barrel reaches —
 * to the un-mocked database inside an int test. `utils/index.ts` re-exports
 * this, so every existing caller is unchanged.
 */
export function isAndroidWrapper() {
	return process.env.SERENE_PUB_PLATFORM === "android"
}
