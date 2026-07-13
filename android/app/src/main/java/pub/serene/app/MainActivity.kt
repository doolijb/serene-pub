package pub.serene.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebSettings
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import kotlinx.coroutines.*
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var rootLayout: FrameLayout
    private var recoveryView: android.view.View? = null
    private var serverCheckJob: Job? = null
    private var nodeDiedReceiver: BroadcastReceiver? = null

    companion object {
        const val SERVER_URL = "http://localhost:3000"
        // Generous enough to cover first-run asset extraction (node_modules
        // included, observed ~60s) PLUS actual Node startup — extraction now
        // happens inside NodeService itself, concurrently with this polling
        // loop, not beforehand. Subsequent launches (already extracted) return
        // as soon as the server responds, well under this ceiling.
        const val MAX_WAIT_TIME = 120000L // 2 minutes
        const val CHECK_INTERVAL = 500L // 500ms
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
        Toast.makeText(this, "Starting Serene Pub...", Toast.LENGTH_LONG).show()
        startNodeService()
        waitForServerAndLoad()
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
                        hideRecoveryView()
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

    /** Shows a simple "server's down, tap to restart" overlay in place of the dead WebView. */
    private fun showRecoveryView(message: String) {
        if (recoveryView != null) return // already showing

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#13131f"))
            setPadding(64, 64, 64, 64)
        }
        container.addView(TextView(this).apply {
            text = message
            setTextColor(Color.WHITE)
            textSize = 16f
            gravity = Gravity.CENTER
        })
        container.addView(Button(this).apply {
            text = "Restart"
            setOnClickListener { restartApp() }
        }.apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = 32 }
        })

        rootLayout.addView(
            container,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        recoveryView = container
    }

    private fun hideRecoveryView() {
        recoveryView?.let { rootLayout.removeView(it) }
        recoveryView = null
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
        serverCheckJob?.cancel()
        nodeDiedReceiver?.let { unregisterReceiver(it) }
        stopService(Intent(this, NodeService::class.java))
    }
}
