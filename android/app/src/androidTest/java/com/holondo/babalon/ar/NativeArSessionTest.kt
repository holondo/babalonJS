package com.holondo.babalon.ar

import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.ar.core.Plane
import com.google.ar.core.Point
import com.google.ar.core.TrackingState
import com.holondo.babalon.R
import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Physical-device probe of the real Activity and camera session, not a model-only test. */
@RunWith(AndroidJUnit4::class)
class NativeArSessionTest {
    @Test
    fun cameraSessionFindsSurfaces() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val args = InstrumentationRegistry.getArguments()
        val path = args.getString("glbPath")
        assumeTrue("Pass glbPath and cameraProbe=true on a physical ARCore device", path != null && args.getString("cameraProbe") == "true")
        val context = instrumentation.targetContext
        val cached = File.createTempFile("ar-session-test-", ".glb", context.cacheDir)
        File(path!!).copyTo(cached, overwrite = true)
        val activity = instrumentation.startActivitySync(Intent(context, ArActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("glb_path", cached.absolutePath))
        var frames = 0
        var lastTimestamp = 0L
        var tracked = 0
        var planes = 0
        var hits = 0
        var acceptedHits = 0
        var firstPosition: FloatArray? = null
        var maxTravel = 0f
        var maxFeatures = 0
        var placed = false
        var anchorSamples = 0
        var firstPlacementMs: Long? = null
        var minDistance = Float.POSITIVE_INFINITY
        var maxDistance = 0f
        val started = SystemClock.elapsedRealtime()
        val hitTypes = mutableSetOf<String>()
        var configuration = "no session"
        val reasons = mutableSetOf<String>()
        try {
            repeat(80) {
                instrumentation.runOnMainSync {
                    val view = activity.findViewById<NativeArSceneView>(R.id.sceneView)
                    view.session?.let { session ->
                        val camera = session.cameraConfig
                        configuration = "planes=${session.config.planeFindingMode}, focus=${session.config.focusMode}, depth=${session.config.depthMode}, instant=${session.config.instantPlacementMode}, camera=${camera.cameraId}/${camera.facingDirection}, image=${camera.imageSize}, texture=${camera.textureSize}, fps=${camera.fpsRange}"
                        planes = maxOf(planes, session.getAllTrackables(Plane::class.java).count { it.trackingState == TrackingState.TRACKING })
                    }
                    view.frame?.let { frame ->
                        if (frame.timestamp != lastTimestamp) { frames++; lastTimestamp = frame.timestamp }
                        reasons.add("${frame.camera.trackingState}/${frame.camera.trackingFailureReason}")
                        if (frame.camera.trackingState == TrackingState.TRACKING) {
                            tracked++
                            val position = frame.camera.pose.translation
                            val start = firstPosition ?: position.also { firstPosition = it }
                            maxTravel = maxOf(maxTravel, kotlin.math.sqrt(position.indices.sumOf { ((position[it] - start[it]) * (position[it] - start[it])).toDouble() }).toFloat())
                            frame.acquirePointCloud().use { cloud -> maxFeatures = maxOf(maxFeatures, cloud.points.remaining() / 4) }
                            for (x in listOf(0.25f, 0.5f, 0.75f)) for (y in listOf(0.25f, 0.5f, 0.75f)) {
                                val results = frame.hitTest(view.width*x, view.height*y)
                                hits = maxOf(hits, results.size)
                                results.forEach {
                                    val point = it.trackable as? Point
                                    hitTypes.add("${it.trackable.javaClass.simpleName}/${point?.orientationMode}")
                                    minDistance = minOf(minDistance, it.distance)
                                    maxDistance = maxOf(maxDistance, it.distance)
                                }
                                if (view.placementHit(view.width*x, view.height*y) != null) {
                                    acceptedHits++
                                    if (!placed) placed = (activity as ArActivity).placeSceneAt(view.width*x, view.height*y)
                                    if (placed && firstPlacementMs == null) firstPlacementMs = SystemClock.elapsedRealtime() - started
                                }
                            }
                        }
                    }
                    if ((activity as ArActivity).placementTrackingState == TrackingState.TRACKING) anchorSamples++
                }
                SystemClock.sleep(250)
            }
            val debuggable = context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0
            val report = "$configuration; debuggable=$debuggable; frames=$frames; trackingSamples=$tracked; travel=${maxTravel}m; features=$maxFeatures; planes=$planes; hits=$hits; accepted=$acceptedHits; placed=$placed; firstPlacementMs=$firstPlacementMs; anchorSamples=$anchorSamples; types=$hitTypes; distances=$minDistance..$maxDistance; states=$reasons"
            instrumentation.sendStatus(0, Bundle().apply { putString("arSession", report) })
            assertTrue("No camera frames: $report", frames > 10)
            assertTrue("ARCore never tracked: $report", tracked > 0)
            assertTrue("No surfaces detected: $report", hits > 0)
            assertTrue("All real surface hits were rejected: $report", acceptedHits > 0)
            assertTrue("Scene was not placed with a tracking anchor: $report", placed && anchorSamples > 5)
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
            instrumentation.waitForIdleSync()
            cached.delete()
        }
    }
}
