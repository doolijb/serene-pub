// Minimal JNI bridge to run Node.js in-process via node::Start(), adapted
// from nodejs-mobile-react-native's native-lib.cpp (MIT licensed) with the
// React Native message-channel bridge (rn-bridge.cpp) removed — Serene Pub's
// Node process talks to the WebView over plain loopback HTTP/WebSocket
// exactly as it did as a spawned subprocess, so no custom native<->JS
// messaging channel is needed here.
//
// This exists because the official nodejs.org Linux ARM64 build is linked
// against glibc (ELF interpreter /lib/ld-linux-aarch64.so.1), which doesn't
// exist on Android's Bionic-based userspace — execve() on it fails with
// ENOENT on the interpreter, not the binary itself. libnode.so here is a
// genuine Android/Bionic-targeted build (no PT_INTERP segment — a real
// dlopen()-able shared library, not a standalone executable), pulled from
// nodejs-mobile's prebuilt npm package. See scripts/build-android.js.

#include <jni.h>
#include <string>
#include <cstdlib>
#include <cstring>
#include <pthread.h>
#include <unistd.h>
#include <android/log.h>

#include "node.h"

#define APPNAME "NodeJS"

extern "C" int callIntoNode(int argc, char *argv[]) {
    const int exit_code = node::Start(argc, argv);
    return exit_code;
}

// Redirect stdout/stderr to logcat so `adb logcat | grep NodeJS` shows the
// same output it did when Node ran as a spawned subprocess with
// redirectErrorStream(true).
static int pipe_stdout[2];
static int pipe_stderr[2];
static pthread_t thread_stdout;
static pthread_t thread_stderr;

static void *thread_stdout_func(void *) {
    ssize_t redirect_size;
    char buf[2048];
    while ((redirect_size = read(pipe_stdout[0], buf, sizeof buf - 1)) > 0) {
        if (buf[redirect_size - 1] == '\n') --redirect_size;
        buf[redirect_size] = 0;
        __android_log_write(ANDROID_LOG_INFO, APPNAME, buf);
    }
    return nullptr;
}

static void *thread_stderr_func(void *) {
    ssize_t redirect_size;
    char buf[2048];
    while ((redirect_size = read(pipe_stderr[0], buf, sizeof buf - 1)) > 0) {
        if (buf[redirect_size - 1] == '\n') --redirect_size;
        buf[redirect_size] = 0;
        __android_log_write(ANDROID_LOG_ERROR, APPNAME, buf);
    }
    return nullptr;
}

static int start_redirecting_stdout_stderr() {
    setvbuf(stdout, 0, _IONBF, 0);
    pipe(pipe_stdout);
    dup2(pipe_stdout[1], STDOUT_FILENO);

    setvbuf(stderr, 0, _IONBF, 0);
    pipe(pipe_stderr);
    dup2(pipe_stderr[1], STDERR_FILENO);

    if (pthread_create(&thread_stdout, 0, thread_stdout_func, 0) == -1) return -1;
    pthread_detach(thread_stdout);

    if (pthread_create(&thread_stderr, 0, thread_stderr_func, 0) == -1) return -1;
    pthread_detach(thread_stderr);

    return 0;
}

extern "C"
JNIEXPORT jint JNICALL
Java_pub_serene_app_NodeBridge_startNodeWithArguments(
        JNIEnv *env,
        jclass /* this */,
        jobjectArray arguments,
        jobjectArray envVars) {

    // Apply KEY=VALUE environment variables to THIS process before starting
    // Node — the embedded runtime reads process.env from the same process
    // table, since it's not a separate child process.
    jsize envCount = env->GetArrayLength(envVars);
    for (int i = 0; i < envCount; i++) {
        auto jEntry = (jstring) env->GetObjectArrayElement(envVars, i);
        const char *entry = env->GetStringUTFChars(jEntry, 0);
        const char *eq = strchr(entry, '=');
        if (eq != nullptr) {
            std::string key(entry, eq - entry);
            std::string value(eq + 1);
            setenv(key.c_str(), value.c_str(), 1);
        }
        env->ReleaseStringUTFChars(jEntry, entry);
        env->DeleteLocalRef(jEntry);
    }

    // The old spawned-subprocess model set the child's working directory via
    // ProcessBuilder().directory(File(dataDir)) — several server code paths
    // (e.g. drizzle.config.ts's migrationsDir = "./drizzle") rely on relative
    // paths resolved against that. There's no ProcessBuilder equivalent for
    // an in-process embedded runtime, so process.cwd() would otherwise
    // inherit whatever directory the Android app process itself started in.
    // Restoring the same guarantee here via chdir() before node::Start()
    // keeps every existing relative-path assumption in the server working
    // unchanged, rather than patching each call site individually.
    const char *dataDir = getenv("SERENE_PUB_DATA_DIR");
    if (dataDir != nullptr) {
        chdir(dataDir);
    }

    start_redirecting_stdout_stderr();

    // node's libuv requires all arguments in one contiguous memory block
    // (uv_setup_args() reuses this memory for process-title manipulation on
    // Linux) — mirroring nodejs-mobile-react-native's exact approach here
    // rather than individually-allocated strings.
    jsize argument_count = env->GetArrayLength(arguments);

    int c_arguments_size = 0;
    for (int i = 0; i < argument_count; i++) {
        auto jArg = (jstring) env->GetObjectArrayElement(arguments, i);
        const char *arg = env->GetStringUTFChars(jArg, 0);
        c_arguments_size += strlen(arg) + 1; // +1 for '\0'
        env->ReleaseStringUTFChars(jArg, arg);
        env->DeleteLocalRef(jArg);
    }

    char *args_buffer = (char *) calloc(c_arguments_size, sizeof(char));
    char **argv = (char **) calloc(argument_count, sizeof(char *));
    char *current_args_position = args_buffer;

    for (int i = 0; i < argument_count; i++) {
        auto jArg = (jstring) env->GetObjectArrayElement(arguments, i);
        const char *arg = env->GetStringUTFChars(jArg, 0);
        size_t len = strlen(arg);
        strncpy(current_args_position, arg, len);
        argv[i] = current_args_position;
        current_args_position += len + 1;
        env->ReleaseStringUTFChars(jArg, arg);
        env->DeleteLocalRef(jArg);
    }

    int exit_code = callIntoNode(argument_count, argv);

    free(argv);
    free(args_buffer);

    return jint(exit_code);
}
