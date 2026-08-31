package pub.serene.app

import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.MimeTypeMap
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebSettings
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import android.content.res.ColorStateList
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import kotlinx.coroutines.*
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : AppCompatActivity() {
    private enum class OverlayKind { NONE, LOADING, RECOVERY }

    private lateinit var webView: WebView
    private lateinit var rootLayout: FrameLayout
    private var overlayView: android.view.View? = null
    private var overlayKind = OverlayKind.NONE
    private var serverCheckJob: Job? = null
    private var nodeDiedReceiver: BroadcastReceiver? = null

    /**
     * Outstanding `<input type="file">` callback, if a picker is open. WebView
     * hands us exactly one of these per chooser and expects exactly one
     * onReceiveValue() back — miss it and it believes a chooser is still open,
     * so every later tap on any file input is silently ignored for the life of
     * the page.
     */
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    // Registered as a field so it lands before the Activity reaches STARTED,
    // which registerForActivityResult() requires.
    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val callback = filePathCallback
        filePathCallback = null
        // parseResult() yields null on cancel, which is the "no files" answer
        // WebView wants — it must still be delivered.
        callback?.onReceiveValue(
            WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        )
    }

    companion object {
        const val SERVER_URL = "http://localhost:3000"
        // Generous enough to cover first-run asset extraction (node_modules
        // included, observed ~60s) PLUS actual Node startup — extraction now
        // happens inside NodeService itself, concurrently with this polling
        // loop, not beforehand. Subsequent launches (already extracted) return
        // as soon as the server responds, well under this ceiling.
        const val MAX_WAIT_TIME = 120000L // 2 minutes
        const val CHECK_INTERVAL = 500L // 500ms

        /**
         * Extensions the app's `accept` lists use that MimeTypeMap doesn't
         * reliably resolve across the API levels we support (26+). Anything
         * missing here still falls back to MimeTypeMap, then to no filtering.
         */
        private val EXTRA_MIME_TYPES = mapOf(
            "json" to "application/json",
            "apng" to "image/apng",
            "webp" to "image/webp",
            "avif" to "image/avif"
        )
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Setup WebView
        webView = WebView(this)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            // The server (Node, embedded, restarted with the app) and the
            // client bundle it serves both live entirely inside this app's own
            // package — there's no real network between them, so HTTP caching
            // buys nothing but risk: a rebuilt client bundle serves new
            // content-hashed filenames from the exact same http://localhost:3000
            // origin WebView already has cached responses for, and a cached
            // failure from an earlier broken server state (a 404/500 during
            // startup, before the server was fully up) can otherwise persist
            // and get served back instead of the real, working response.
            cacheMode = WebSettings.LOAD_NO_CACHE
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            allowFileAccess = true
            allowContentAccess = true
        }
        // Belt-and-suspenders for anyone upgrading from a build that shipped
        // with caching enabled: proactively clear out whatever's already on
        // disk, not just future requests.
        webView.clearCache(true)

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
                view.loadUrl(url)
                return true
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                super.onReceivedError(view, request, error)
                // Only the top-level page failing matters here — a broken sub-resource
                // (an image, a failed API call surfaced as a resource error, etc.)
                // shouldn't tear down the whole WebView.
                if (request.isForMainFrame) {
                    showRecoveryView("The connection to Serene Pub was lost.")
                }
            }
        }

        // Without a WebChromeClient overriding onShowFileChooser(), WebView's
        // default answer is "not handled" and tapping any <input type="file">
        // does nothing at all — no picker, no error. Every upload in the app
        // (character/persona/lorebook import, avatars, backgrounds, themes)
        // goes through one, so this is what makes them work on Android.
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                // Answer any previous chooser before dropping its callback.
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback

                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                    val mimeTypes = toMimeTypes(params.acceptTypes)
                    if (mimeTypes.isNotEmpty()) {
                        putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes)
                    }
                    if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) {
                        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                    }
                }

                return try {
                    fileChooserLauncher.launch(intent)
                    true
                } catch (e: ActivityNotFoundException) {
                    filePathCallback = null
                    callback.onReceiveValue(null)
                    Toast.makeText(
                        this@MainActivity,
                        "No file picker available on this device.",
                        Toast.LENGTH_SHORT
                    ).show()
                    false
                }
            }
        }

        webView.setBackgroundColor(Color.parseColor("#13131f"))

        rootLayout = FrameLayout(this)
        rootLayout.addView(
            webView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        setContentView(rootLayout)

        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (webView.canGoBack()) {
                        webView.goBack()
                    } else {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                    }
                }
            }
        )

        nodeDiedReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                showRecoveryView("Server stopped unexpectedly.")
            }
        }
        ContextCompat.registerReceiver(
            this,
            nodeDiedReceiver,
            IntentFilter(NodeService.ACTION_NODE_PROCESS_DIED),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )

        // Cover the WebView with a proper loading screen immediately — left
        // alone, the WebView paints solid white the moment it's attached
        // (before any page has loaded into it), and first-run startup here
        // covers asset extraction + Node boot, which can take well over a
        // minute. A blank white screen for that long reads as "the app is
        // broken/frozen," not "still loading."
        showLoadingView()

        // Start the foreground service immediately, while the app is freshly
        // launched and definitely eligible to do so. Asset extraction (first
        // run only — hundreds of MB, node_modules included) and Node startup
        // both now happen inside NodeService itself, after it's already
        // running as a foreground service: starting the service only *after*
        // a ~60s extraction delay previously tripped Android's restrictions on
        // starting foreground services from the background ("not allowed due
        // to mAllowStartForeground false"), since that eligibility window can
        // expire before extraction finishes. setContentView() above has
        // already put the (empty) WebView on screen, so this doesn't block
        // the Activity's own launch either way.
        startNodeService()
        waitForServerAndLoad()
    }

    /**
     * Translates an HTML `accept` list into MIME types for EXTRA_MIME_TYPES.
     *
     * WebView passes `accept` through verbatim, and the app's import zones list
     * *extensions* (".png,.apng,.jpeg,.jpg,.webp,.json"). Android's picker only
     * understands MIME types, so handing it those raw would filter the list down
     * to nothing selectable. Anything we can't resolve makes us give up on
     * filtering entirely — an empty result leaves the intent on its wildcard
     * type — rather than show a picker where the wanted file isn't tappable.
     */
    private fun toMimeTypes(acceptTypes: Array<String>?): Array<String> {
        if (acceptTypes.isNullOrEmpty()) return emptyArray()
        val out = LinkedHashSet<String>()
        for (raw in acceptTypes) {
            // A single acceptTypes entry can itself be comma-joined.
            for (part in raw.split(",")) {
                val entry = part.trim()
                if (entry.isEmpty()) continue
                if (!entry.startsWith(".")) {
                    // Already a MIME type or wildcard ("image/*").
                    out.add(entry)
                    continue
                }
                val ext = entry.removePrefix(".").lowercase()
                val mime = EXTRA_MIME_TYPES[ext]
                    ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext)
                    ?: return emptyArray()
                out.add(mime)
            }
        }
        return out.toTypedArray()
    }

    private fun startNodeService() {
        val intent = Intent(this, NodeService::class.java)
        intent.putExtra("dataDir", filesDir.path)
        startForegroundService(intent)
    }

    private fun waitForServerAndLoad() {
        var elapsedTime = 0L

        serverCheckJob = CoroutineScope(Dispatchers.IO).launch {
            while (elapsedTime < MAX_WAIT_TIME) {
                if (isServerReady()) {
                    withContext(Dispatchers.Main) {
                        hideOverlay()
                        webView.loadUrl(SERVER_URL)
                        Toast.makeText(
                            this@MainActivity,
                            "Serene Pub ready!",
                            Toast.LENGTH_SHORT
                        ).show()
                    }
                    return@launch
                }
                delay(CHECK_INTERVAL)
                elapsedTime += CHECK_INTERVAL
            }

            // Timeout
            withContext(Dispatchers.Main) {
                showRecoveryView("Server startup timed out.")
            }
        }
    }

    private fun isServerReady(): Boolean {
        return try {
            val url = URL(SERVER_URL)
            val connection = url.openConnection() as HttpURLConnection
            connection.connectTimeout = 1000
            connection.requestMethod = "GET"
            connection.connect()
            val responseCode = connection.responseCode
            connection.disconnect()
            responseCode in 200..399
        } catch (e: Exception) {
            false
        }
    }

    /** Shown from launch until the server responds — replaces the otherwise-blank WebView. */
    private fun showLoadingView() {
        if (overlayKind == OverlayKind.LOADING) return
        setOverlay(OverlayKind.LOADING, buildOverlayContainer {
            addView(ImageView(this@MainActivity).apply {
                setImageResource(R.mipmap.ic_launcher)
            }, LinearLayout.LayoutParams(160, 160))
            addView(ProgressBar(this@MainActivity).apply {
                isIndeterminate = true
                indeterminateTintList = ColorStateList.valueOf(Color.parseColor("#a7bef3"))
            }, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = 48 })
            addView(TextView(this@MainActivity).apply {
                text = "Starting Serene Pub..."
                setTextColor(Color.WHITE)
                textSize = 16f
                gravity = Gravity.CENTER
            }, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = 24 })
        })
    }

    /** Shows a "server's down, tap to restart" overlay in place of the dead WebView. */
    private fun showRecoveryView(message: String) {
        if (overlayKind == OverlayKind.RECOVERY) return
        setOverlay(OverlayKind.RECOVERY, buildOverlayContainer {
            addView(TextView(this@MainActivity).apply {
                text = message
                setTextColor(Color.WHITE)
                textSize = 16f
                gravity = Gravity.CENTER
            })
            addView(Button(this@MainActivity).apply {
                text = "Restart"
                setOnClickListener { restartApp() }
            }, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = 32 })
        })
    }

    private fun buildOverlayContainer(populate: LinearLayout.() -> Unit): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#13131f"))
            setPadding(64, 64, 64, 64)
            populate()
        }
    }

    /** Replaces whatever overlay is currently showing (loading or recovery), if any. */
    private fun setOverlay(kind: OverlayKind, view: android.view.View) {
        hideOverlay()
        rootLayout.addView(
            view,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        overlayView = view
        overlayKind = kind
    }

    private fun hideOverlay() {
        overlayView?.let { rootLayout.removeView(it) }
        overlayView = null
        overlayKind = OverlayKind.NONE
    }

    /**
     * Recovery now means restarting the whole app process, not just
     * re-starting NodeService: Node runs in-process (via node::Start(), see
     * NodeBridge/node-bridge.cpp) instead of as a spawned subprocess, and
     * node::Start() cannot safely be invoked a second time within the same
     * OS process (global V8/libuv init state). A fresh process is the only
     * supported way to get a fresh Node instance.
     */
    private fun restartApp() {
        val restartIntent = packageManager.getLaunchIntentForPackage(packageName)
        if (restartIntent != null) {
            val mainIntent = Intent.makeRestartActivityTask(restartIntent.component)
            startActivity(mainIntent)
        }
        Runtime.getRuntime().exit(0)
    }

    override fun onDestroy() {
        super.onDestroy()
        // Release a chooser still waiting on us, so WebView isn't left holding
        // an unanswered callback.
        filePathCallback?.onReceiveValue(null)
        filePathCallback = null
        serverCheckJob?.cancel()
        nodeDiedReceiver?.let { unregisterReceiver(it) }
        stopService(Intent(this, NodeService::class.java))
    }
}
