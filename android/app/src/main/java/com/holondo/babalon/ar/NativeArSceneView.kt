package com.holondo.babalon.ar

import android.content.Context
import android.net.Uri
import android.util.AttributeSet
import io.github.sceneview.ar.ARSceneView
import java.io.File
import com.google.ar.core.DepthPoint
import com.google.ar.core.HitResult
import com.google.ar.core.Plane
import com.google.ar.core.Point
import com.google.ar.core.TrackingState

/** Releases app-owned nodes before SceneView's lifecycle destroys its Filament engine. */
class NativeArSceneView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : ARSceneView(context, attrs) {
    var releaseContent: (() -> Unit)? = null

    // SceneView 2.2.1 treats a scheme-less absolute path as an APK asset path.
    suspend fun loadScene(file: File) = modelLoader.loadModelInstance(Uri.fromFile(file).toString())

    /** Accept measured surfaces before ARCore has consolidated a full plane polygon. */
    fun placementHit(x: Float, y: Float): HitResult? {
        val current = frame ?: return null
        if (current.camera.trackingState != TrackingState.TRACKING) return null
        val hits = current.hitTest(x, y)
        fun valid(hit: HitResult): Boolean {
            val trackable = hit.trackable
            if (trackable.trackingState != TrackingState.TRACKING || hit.distance !in 0.15f..5f) return false
            return when (trackable) {
                is Plane -> trackable.isPoseInPolygon(hit.hitPose)
                is Point -> trackable.orientationMode == Point.OrientationMode.ESTIMATED_SURFACE_NORMAL
                is DepthPoint -> true
                else -> false
            }
        }
        // Prefer a floor/table when multiple surfaces intersect the ray. Other measured
        // surfaces remain usable; the composition's initial orientation stays upright.
        return hits.firstOrNull { valid(it) && (it.trackable as? Plane)?.type == Plane.Type.HORIZONTAL_UPWARD_FACING }
            ?: hits.firstOrNull { valid(it) }
    }

    override fun destroy() {
        releaseContent?.also { releaseContent = null }?.invoke()
        super.destroy()
    }
}
