package pub.serene.app

/**
 * JNI entry point into node-bridge.cpp / node::Start(). Node runs in-process
 * (a thread within this app, not a spawned subprocess) because the official
 * nodejs.org Linux ARM64 build is glibc-linked and cannot execute on
 * Android's Bionic userspace under any packaging scheme — libnode.so here is
 * a genuine Bionic-targeted build from nodejs-mobile instead. See
 * src/main/cpp/node-bridge.cpp and scripts/build-android.js.
 */
object NodeBridge {
    init {
        // node-bridge.so is linked against libnode.so (IMPORTED in CMakeLists.txt)
        // so the dynamic linker resolves that dependency automatically, but
        // loading it explicitly first — matching nodejs-mobile-react-native's
        // own init order — avoids relying on that implicit resolution.
        System.loadLibrary("node")
        System.loadLibrary("node-bridge")
    }

    /**
     * Blocks the calling thread until Node's event loop exits — call this
     * from a background Thread, never the main thread. [arguments] is a
     * plain argv (arguments[0] is the conventional program name, e.g.
     * "node"); [envVars] are "KEY=VALUE" strings applied via setenv() to
     * this process before Node starts, since there's no child-process
     * environment to set here the way there was with ProcessBuilder.
     */
    @JvmStatic
    external fun startNodeWithArguments(arguments: Array<String>, envVars: Array<String>): Int
}
