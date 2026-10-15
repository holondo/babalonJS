package com.holondo.babalon.ar

import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.view.WindowManager
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.holondo.babalon.R
import io.github.sceneview.node.ModelNode
import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Real camera/model teardown; no surface tracking or user movement required. */
@RunWith(AndroidJUnit4::class)
class NativeArLifecycleTest {
    @Test
    fun loadedCameraSessionCanCloseAndReopen() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val args = InstrumentationRegistry.getArguments()
        val path = args.getString("glbPath")
        assumeTrue("Pass glbPath and lifecycleProbe=true on an ARCore device",
            path != null && args.getString("lifecycleProbe") == "true")
        val context = instrumentation.targetContext
        val cached = File.createTempFile("ar-lifecycle-test-", ".glb", context.cacheDir)
        File(path!!).copyTo(cached, overwrite = true)
        try {
            repeat(3) { cycle ->
                val activity = instrumentation.startActivitySync(Intent(context, ArActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("glb_path", cached.absolutePath))
                instrumentation.runOnMainSync {
                    activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                }
                try {
                    val deadline = SystemClock.elapsedRealtime() + 30_000
                    var ready = false
                    while (!ready && SystemClock.elapsedRealtime() < deadline) {
                        instrumentation.runOnMainSync {
                            val view = activity.findViewById<NativeArSceneView>(R.id.sceneView)
                            ready = (view.frame?.timestamp ?: 0L) > 0L &&
                                view.childNodes.any { node -> node.childNodes.any { it is ModelNode } }
                        }
                        SystemClock.sleep(100)
                    }
                    assertTrue("Cycle $cycle did not load the model and camera", ready)
                } finally {
                    instrumentation.runOnMainSync { activity.finish() }
                    instrumentation.waitForIdleSync()
                }
                val deadline = SystemClock.elapsedRealtime() + 15_000
                var destroyed = false
                while (!destroyed && SystemClock.elapsedRealtime() < deadline) {
                    instrumentation.runOnMainSync { destroyed = activity.isDestroyed }
                    SystemClock.sleep(100)
                }
                assertTrue("Cycle $cycle did not destroy the Activity", destroyed)
                instrumentation.sendStatus(0, Bundle().apply { putInt("closedCycle", cycle + 1) })
            }
        } finally {
            cached.delete()
        }
    }
}
