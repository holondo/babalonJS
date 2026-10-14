package com.holondo.babalon.ar

import android.Manifest
import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.annotation.SuppressLint
import android.view.GestureDetector
import android.view.ScaleGestureDetector
import android.view.WindowManager
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.Job
import kotlinx.coroutines.CancellationException
import org.json.JSONObject
import io.github.sceneview.node.Node
import dev.romainguy.kotlin.math.Quaternion
import dev.romainguy.kotlin.math.degrees
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.MotionEvent
import android.view.View
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.google.ar.core.Config
import com.google.ar.core.HitResult
import com.google.ar.core.DepthPoint
import com.google.ar.core.TrackingFailureReason
import com.google.ar.core.Plane
import com.google.ar.core.Point
import com.google.ar.core.Anchor
import com.google.ar.core.TrackingState
import com.holondo.babalon.R
import com.holondo.babalon.databinding.ActivityArBinding
import com.holondo.babalon.databinding.ItemArMeasurementBinding
import dev.romainguy.kotlin.math.Float3
import io.github.sceneview.ar.node.AnchorNode
import io.github.sceneview.ar.scene.PlaneRenderer
import io.github.sceneview.collision.Vector3
import io.github.sceneview.node.ModelNode
import java.io.File
import java.util.Locale
import kotlin.math.roundToInt
import kotlin.math.sqrt

class ArActivity : AppCompatActivity() {

    private lateinit var binding: ActivityArBinding
    private var translations = JSONObject()
    private fun tr(text: String) = translations.optString(text, text)

    private var modelNode: ModelNode? = null
    private var modelLoad: Job? = null
    private var anchorNode: AnchorNode? = null
    private var isPlaced = false
    private var isMoving = false
    private var isOcclusionEnabled = false
    private var depthSupported = false
    private var placementHit: HitResult? = null
    private var lastHitTime = 0L
    private var sceneYaw = 0f
    private var placementBasis = Quaternion()
    private var baseYaw = 0f
    private var orientationSet = false
    private var sceneNode: Node? = null
    private var multiTouch = false
    private var lastTwist: Float? = null
    private var lastTrackingState: TrackingState? = null
    private var lastFrameTime = 0L
    private var frameCount = 0
    private var frameWindowStart = 0L
    private var isVideoMode = false
    private var isMeasuring = false

    // Measurement points
    private var pendingMeasurePoint: Anchor? = null
    private val measurements = mutableListOf<MeasurementData>()

    // Recording timer
    private var recordStartTime = 0L
    private val timerHandler = Handler(Looper.getMainLooper())
    private val timerRunnable = object : Runnable {
        override fun run() {
            if (SceneViewRecorder.isRecording) {
                val elapsed = (SystemClock.elapsedRealtime() - recordStartTime) / 1000
                val mins = elapsed / 60
                val secs = elapsed % 60
                binding.tvRecordTimer.text = String.format(Locale.US, "● REC %02d:%02d", mins, secs)
                timerHandler.postDelayed(this, 1000)
            }
        }
    }

    private data class MeasurementData(
        val p1: Anchor,
        val p2: Anchor,
        val view: View,
        val binding: ItemArMeasurementBinding
    )

    private val audioPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) {
        startVideoRecordingInternal()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityArBinding.inflate(layoutInflater)
        setContentView(binding.root)
        translations = intent.getStringExtra("placement")?.let {
            runCatching { JSONObject(it).optJSONObject("strings") }.getOrNull()
        } ?: JSONObject()
        binding.btnExit.contentDescription = tr("Exit AR")
        binding.btnOcclusion.contentDescription = tr("Depth occlusion")
        binding.btnHideUi.contentDescription = tr("Hide interface")
        binding.btnPlaceInFront.text = tr("Place scene")
        binding.btnMove.contentDescription = tr("Move scene")
        binding.btnMeasure.contentDescription = tr("Measure objects")
        binding.btnShutter.contentDescription = tr("Capture")
        binding.btnCaptureMode.contentDescription = tr("Toggle video mode")
        binding.btnShowUi.contentDescription = tr("Show interface")

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setupFullscreenAndInsets()
        setupListeners()

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(this, tr("Camera permission is required for AR"), Toast.LENGTH_LONG).show()
            finish()
            return
        }

        val glbPath = intent.getStringExtra("glb_path")
        if (glbPath.isNullOrEmpty() || !File(glbPath).exists()) {
            Toast.makeText(this, tr("3D model file not found"), Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        setupARScene(glbPath)
    }

    private fun setupFullscreenAndInsets() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val insetsController = WindowCompat.getInsetsController(window, window.decorView)
        insetsController.hide(WindowInsetsCompat.Type.systemBars())
        insetsController.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE

        ViewCompat.setOnApplyWindowInsetsListener(binding.uiContainer) { _, insets ->
            val sysBars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            val topPad = maxOf(sysBars.top, (16 * resources.displayMetrics.density).toInt())
            val bottomPad = maxOf(sysBars.bottom, (16 * resources.displayMetrics.density).toInt())

            binding.topBar.setPadding(
                (16 * resources.displayMetrics.density).toInt(),
                topPad,
                (16 * resources.displayMetrics.density).toInt(),
                (8 * resources.displayMetrics.density).toInt()
            )
            binding.bottomContainer.setPadding(
                (16 * resources.displayMetrics.density).toInt(),
                (8 * resources.displayMetrics.density).toInt(),
                (16 * resources.displayMetrics.density).toInt(),
                bottomPad + (16 * resources.displayMetrics.density).toInt()
            )
            insets
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun setupARScene(glbPath: String) {
        val sceneView = binding.sceneView
        val placement = intent.getStringExtra("placement")?.let { runCatching { JSONObject(it) }.getOrNull() }
        baseYaw = placement?.optDouble("baseYaw", 0.0)?.toFloat() ?: 0f
        sceneView.planeRenderer.apply {
            isEnabled = true
            isVisible = true
            isShadowReceiver = false
            planeRendererMode = PlaneRenderer.PlaneRendererMode.RENDER_CENTER
        }
        // Configure before attaching the lifecycle. The config-changed callback is a
        // notification, not a second chance to change ARCore's applied configuration.
        sceneView.sessionConfiguration = { session, config ->
            config.planeFindingMode = Config.PlaneFindingMode.HORIZONTAL_AND_VERTICAL
            config.instantPlacementMode = Config.InstantPlacementMode.DISABLED
            config.lightEstimationMode = Config.LightEstimationMode.DISABLED
            config.depthMode = Config.DepthMode.DISABLED
            depthSupported = session.isDepthModeSupported(Config.DepthMode.AUTOMATIC)
            binding.btnOcclusion.isEnabled = depthSupported
            binding.btnOcclusion.alpha = if (depthSupported) 1f else 0.4f
        }
        sceneView.cameraStream?.isDepthOcclusionEnabled = false
        sceneView.onSessionFailed = { exception ->
            Log.e("ArActivity", "ARCore session failed", exception)
            Toast.makeText(this, "${tr("AR error")}: ${exception.localizedMessage}", Toast.LENGTH_LONG).show()
            finish()
        }
        binding.btnPlaceInFront.isEnabled = false
        binding.reticleView.visibility = View.GONE
        binding.tvHint.text = tr("Loading 3D scene…")
        sceneView.releaseContent = { releaseSceneContent() }
        modelLoad = lifecycleScope.launch {
            val started = SystemClock.elapsedRealtime()
            try {
                val instance = sceneView.loadScene(File(glbPath))
                    ?: error(tr("Could not load 3D scene"))
                val model = ModelNode(instance, autoAnimate = false, scaleToUnits = null, centerOrigin = null)
                data class Clip(val index: Int, val speed: Float, val loop: Boolean, val duration: Float)
                val clips = mutableListOf<Clip>()
                placement?.optJSONArray("animations")?.let { animations ->
                    for (i in 0 until animations.length()) {
                        val clip = animations.getJSONObject(i)
                        val index = (0 until model.animationCount).firstOrNull {
                            model.animator.getAnimationName(it) == clip.getString("name")
                        } ?: continue
                        clips.add(Clip(index, clip.optDouble("speed", 1.0).toFloat(), clip.optBoolean("loop", true), model.animator.getAnimationDuration(index)))
                    }
                }
                // SceneView 2.2.1 removes completed clips while iterating its map.
                // Sample our fixed list instead, including multiple play-once clips.
                val animationStart = System.nanoTime()
                model.onFrame = { time ->
                    for (clip in clips) {
                        if (clip.duration <= 0f) continue
                        val elapsed = ((time - animationStart) / 1_000_000_000.0).toFloat() * kotlin.math.abs(clip.speed)
                        val position = if (clip.loop) elapsed % clip.duration else elapsed.coerceAtMost(clip.duration)
                        model.animator.applyAnimation(clip.index, if (clip.speed < 0f) clip.duration - position else position)
                    }
                    // ModelNode updates skin matrices immediately after this callback.
                }
                // Offset the composed scene as a whole, retaining meters and object spacing.
                // Use the editor's visible bounds, not a rest-pose glTF skin bounding box.
                val origin = placement?.optJSONArray("origin")
                model.position = if (origin != null && origin.length() == 3) {
                    Float3(-origin.getDouble(0).toFloat(), -origin.getDouble(1).toFloat(), -origin.getDouble(2).toFloat())
                } else {
                    Float3(-model.center.x, model.halfExtent.y - model.center.y, -model.center.z)
                }
                modelNode = model
                sceneNode = Node(sceneView.engine).apply {
                    addChildNode(model)
                    isVisible = false
                    sceneView.addChildNode(this)
                }
                Log.i("ArActivity", "Scene loaded in ${SystemClock.elapsedRealtime() - started} ms; size=${model.extents}; origin=${model.position}")
                binding.tvHint.text = tr("Move phone slowly and point at a surface")
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (exception: Exception) {
                Log.e("ArActivity", "Scene load failed", exception)
                Toast.makeText(this@ArActivity, "${tr("Could not load 3D scene")}: ${exception.message}", Toast.LENGTH_LONG).show()
                finish()
            }
        }
        sceneView.onSessionUpdated = { _, frame ->
            val tracking = frame.camera.trackingState
            if (tracking != lastTrackingState) {
                Log.i("ArActivity", "Camera tracking=$tracking; reason=${frame.camera.trackingFailureReason}")
                lastTrackingState = tracking
            }
            val now = SystemClock.elapsedRealtime()
            if (frame.timestamp != lastFrameTime) {
                lastFrameTime = frame.timestamp
                frameCount++
            }
            if (now - frameWindowStart >= 5000) {
                if (frameWindowStart != 0L) Log.d("ArActivity", "Camera fps=${frameCount * 1000 / (now - frameWindowStart)}; placed=$isPlaced; anchor=${anchorNode?.trackingState}")
                frameWindowStart = now
                frameCount = 0
            }
            if (tracking != TrackingState.TRACKING) {
                placementHit = null
                sceneNode?.takeIf { !isPlaced || isMoving }?.isVisible = false
                binding.reticleView.visibility = View.GONE
                binding.btnPlaceInFront.isEnabled = false
                binding.tvHint.text = when (frame.camera.trackingFailureReason) {
                    TrackingFailureReason.INSUFFICIENT_LIGHT -> tr("More light is needed")
                    TrackingFailureReason.EXCESSIVE_MOTION -> tr("Move phone more slowly")
                    TrackingFailureReason.INSUFFICIENT_FEATURES -> tr("Point at a textured surface and move slowly")
                    else -> tr("Move phone slowly to find a surface")
                }
            } else if (modelNode != null && (!isPlaced || isMoving) && now - lastHitTime >= 100) {
                lastHitTime = now
                placementHit = sceneView.placementHit(sceneView.width / 2f, sceneView.height / 2f)
                val hit = placementHit
                sceneNode?.let { preview ->
                    preview.isVisible = hit != null
                    if (hit != null) {
                        if (!orientationSet) {
                            val camera = frame.camera.pose
                            sceneYaw = kotlin.math.atan2(camera.tx() - hit.hitPose.tx(), camera.tz() - hit.hitPose.tz()) - baseYaw
                            orientationSet = true
                        }
                        preview.worldPosition = Float3(hit.hitPose.tx(), hit.hitPose.ty(), hit.hitPose.tz())
                        preview.worldQuaternion = Quaternion.fromAxisAngle(Float3(0f, 1f, 0f), degrees(sceneYaw))
                    }
                }
                binding.reticleView.visibility = if (hit != null && binding.uiContainer.visibility == View.VISIBLE) View.VISIBLE else View.GONE
                binding.btnPlaceInFront.isEnabled = hit != null
                binding.tvHint.text = if (hit == null) tr("Move phone slowly and point at a surface") else tr("Tap to place the scene here")
            } else if (isPlaced && !isMoving && !isMeasuring) {
                binding.tvHint.text = if (anchorNode?.trackingState == TrackingState.TRACKING) tr("Drag to turn · pinch to resize") else tr("Recovering the scene position…")
            }
            updateMeasurementLabels()
        }
        // Handle gestures on the composition. A ModelNode cannot drag on an AnchorNode's
        // collision shape; that default gesture otherwise detaches/moves the wrong node.
        val taps = GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onDown(e: MotionEvent) = true
            override fun onSingleTapUp(e: MotionEvent): Boolean {
                if (multiTouch) return true
                if (isMeasuring) {
                    measurementHit(e.x, e.y)?.let { handleMeasurementTap(it) }
                } else if (!isPlaced || isMoving) {
                    placeSceneAt(e.x, e.y)
                }
                return true
            }
            override fun onScroll(e1: MotionEvent?, e2: MotionEvent, distanceX: Float, distanceY: Float): Boolean {
                if (canManipulate() && !multiTouch) {
                    sceneYaw -= distanceX / sceneView.width * kotlin.math.PI.toFloat()
                    updateSceneRotation()
                }
                return true
            }
        })
        val pinch = ScaleGestureDetector(this, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
            override fun onScale(detector: ScaleGestureDetector): Boolean {
                if (canManipulate()) {
                    sceneNode?.let { it.scale = Float3((it.scale.x * detector.scaleFactor).coerceIn(0.05f, 10f)) }
                    updateScaleButton()
                }
                return true
            }
        })
        sceneView.setOnTouchListener { _, event ->
            if (event.actionMasked == MotionEvent.ACTION_DOWN) { multiTouch = false; lastTwist = null }
            if (event.pointerCount > 1) {
                multiTouch = true
                val angle = kotlin.math.atan2(event.getY(1) - event.getY(0), event.getX(1) - event.getX(0))
                if (event.actionMasked == MotionEvent.ACTION_MOVE && canManipulate()) {
                    lastTwist?.let {
                        val delta = angle - it
                        sceneYaw -= kotlin.math.atan2(kotlin.math.sin(delta), kotlin.math.cos(delta))
                        updateSceneRotation()
                    }
                }
                lastTwist = angle
            }
            pinch.onTouchEvent(event)
            taps.onTouchEvent(event)
            true
        }
        sceneView.lifecycle = lifecycle
    }

    private fun measurementHit(x: Float, y: Float): HitResult? {
        val frame = binding.sceneView.frame ?: return null
        if (frame.camera.trackingState != TrackingState.TRACKING) return null
        return frame.hitTest(x, y).firstOrNull { hit ->
            val trackable = hit.trackable
            trackable.trackingState == TrackingState.TRACKING && when (trackable) {
                is Plane -> trackable.isPoseInPolygon(hit.hitPose)
                is DepthPoint -> true
                is Point -> trackable.orientationMode == Point.OrientationMode.ESTIMATED_SURFACE_NORMAL
                else -> false
            }
        }
    }

    private fun performHitTest(x: Float, y: Float): HitResult? =
        binding.sceneView.placementHit(x, y)

    private fun updateSceneRotation() {
        sceneNode?.quaternion = placementBasis * Quaternion.fromAxisAngle(Float3(0f, 1f, 0f), degrees(sceneYaw))
    }

    private fun canManipulate() = isPlaced && !isMoving && !isMeasuring &&
        binding.sceneView.frame?.camera?.trackingState == TrackingState.TRACKING &&
        anchorNode?.trackingState == TrackingState.TRACKING

    internal val placementTrackingState: TrackingState?
        get() = anchorNode?.trackingState

    internal fun placeSceneAt(x: Float, y: Float): Boolean =
        performHitTest(x, y)?.let { placeModel(it) } ?: false

    private fun placeModel(hitResult: HitResult): Boolean {
        val content = sceneNode ?: return false
        val sceneView = binding.sceneView
        try {
            // Create first: a failed anchor must not discard the current placement.
            val anchor = hitResult.createAnchor()
            sceneView.removeChildNode(content)
            content.parent?.removeChildNode(content)
            anchorNode?.let { sceneView.removeChildNode(it); it.destroy() }
            val placed = AnchorNode(sceneView.engine, anchor).apply {
                isPositionEditable = false
                addChildNode(content)
            }
            anchorNode = placed
            sceneView.addChildNode(placed)
            content.position = Float3(0f)
            content.isVisible = true
            // Convert once into anchor space. ARCore world-map refinements must move
            // and rotate the composition with its anchor, without counter-rotation.
            placementBasis = placed.getLocalQuaternion(Quaternion())
            updateSceneRotation()
            isPlaced = true
            isMoving = false
            placementHit = null
            sceneView.planeRenderer.isVisible = false
            binding.reticleView.visibility = View.GONE
            binding.btnPlaceInFront.visibility = View.GONE
            binding.placedControls.visibility = View.VISIBLE
            binding.tvHint.text = tr("Drag to turn · pinch to resize")
            updateScaleButton()
            Log.i("ArActivity", "Placed on ${hitResult.trackable.javaClass.simpleName}; pose=${anchor.pose}; scale=${content.scale.x}")
            return true
        } catch (exception: Exception) {
            Log.w("ArActivity", "Placement failed", exception)
            Toast.makeText(this, tr("Point at a tracked surface and try again"), Toast.LENGTH_SHORT).show()
            return false
        }
    }

    private fun placeInFrontOfMe() {
        // Refresh the hit at tap time. Never use a stale reticle or a camera-relative anchor.
        placeSceneAt(binding.sceneView.width / 2f, binding.sceneView.height / 2f)
    }

    private fun updateScaleButton() {
        val node = sceneNode ?: return
        val scale = node.scale.x
        val percent = (scale * 100f).roundToInt()
        binding.btnScale.text = if (percent in 98..102) "1:1" else "$percent%"
    }

    private fun resetScale() {
        sceneNode?.let {
            it.scale = Float3(1f, 1f, 1f)
            updateScaleButton()
            Toast.makeText(this, tr("Scale reset to real size (1:1)"), Toast.LENGTH_SHORT).show()
        }
    }

    private fun handleMeasurementTap(hitResult: HitResult) {
        val point = try { hitResult.createAnchor() } catch (exception: Exception) {
            Log.w("ArActivity", "Measurement anchor failed", exception)
            return
        }
        val first = pendingMeasurePoint
        if (first == null) {
            pendingMeasurePoint = point
            binding.tvHint.text = tr("Tap the second surface point")
        } else {
            val label = ItemArMeasurementBinding.inflate(layoutInflater, binding.measurementsContainer, false)
            binding.measurementsContainer.addView(label.root)
            val measurement = MeasurementData(first, point, label.root, label)
            label.root.setOnClickListener {
                first.detach()
                point.detach()
                measurements.remove(measurement)
                binding.measurementsContainer.removeView(label.root)
            }
            measurements.add(measurement)
            pendingMeasurePoint = null
            binding.tvHint.text = tr("Measuring: tap surface point")
            updateMeasurementLabels()
        }
    }

    private fun updateMeasurementLabels() {
        val sceneView = binding.sceneView
        val camera = sceneView.frame?.camera ?: return
        for (m in measurements) {
            val p1 = m.p1.pose
            val p2 = m.p2.pose
            val mid = floatArrayOf((p1.tx() + p2.tx()) / 2f, (p1.ty() + p2.ty()) / 2f, (p1.tz() + p2.tz()) / 2f)
            // SceneView 2.x worldToScreenPoint returns x/y only (z is always zero).
            val inFront = camera.pose.inverse().transformPoint(mid)[2] < -0.05f
            val tracking = camera.trackingState == TrackingState.TRACKING &&
                m.p1.trackingState == TrackingState.TRACKING && m.p2.trackingState == TrackingState.TRACKING
            if (tracking && inFront) {
                val screen = sceneView.cameraNode.worldToScreenPoint(Vector3(mid[0], mid[1], mid[2]))
                val dx = p2.tx() - p1.tx()
                val dy = p2.ty() - p1.ty()
                val dz = p2.tz() - p1.tz()
                val distance = sqrt(dx * dx + dy * dy + dz * dz)
                m.binding.tvDistance.text = if (distance < 1f) String.format(Locale.getDefault(), "%.1f cm", distance * 100f)
                    else String.format(Locale.getDefault(), "%.2f m", distance)
                m.view.visibility = View.VISIBLE
                m.view.translationX = screen.x - m.view.width / 2f
                m.view.translationY = screen.y - m.view.height / 2f
            } else {
                m.view.visibility = View.GONE
            }
        }
    }

    private fun clearPendingMeasurement() {
        pendingMeasurePoint?.detach()
        pendingMeasurePoint = null
    }

    private fun clearMeasurements() {
        measurements.forEach { it.p1.detach(); it.p2.detach() }
        measurements.clear()
        binding.measurementsContainer.removeAllViews()
        clearPendingMeasurement()
    }

    private fun setupListeners() {
        binding.btnExit.setOnClickListener { finish() }

        binding.btnPlaceInFront.setOnClickListener { placeInFrontOfMe() }

        binding.btnMove.setOnClickListener {
            placementBasis = Quaternion()
            if (isMeasuring) { isMeasuring = false; clearPendingMeasurement(); binding.btnMeasure.setColorFilter(Color.WHITE) }
            sceneNode?.let {
                anchorNode?.removeChildNode(it)
                it.isVisible = false
                binding.sceneView.addChildNode(it)
            }
            isMoving = true
            binding.sceneView.planeRenderer.isVisible = true
            binding.btnPlaceInFront.isEnabled = false
            binding.reticleView.visibility = View.VISIBLE
            binding.btnPlaceInFront.visibility = View.VISIBLE
            binding.placedControls.visibility = View.GONE
            binding.tvHint.text = tr("Tap surface to place new location")
            Toast.makeText(this, tr("Move mode: tap to place scene"), Toast.LENGTH_SHORT).show()
        }

        binding.btnScale.setOnClickListener { resetScale() }

        binding.btnOcclusion.setOnClickListener {
            if (!depthSupported) return@setOnClickListener
            val enabled = !isOcclusionEnabled
            try {
                val session = binding.sceneView.session ?: return@setOnClickListener
                session.configure(session.config.apply { depthMode = if (enabled) Config.DepthMode.AUTOMATIC else Config.DepthMode.DISABLED })
                binding.sceneView.cameraStream?.isDepthOcclusionEnabled = enabled
                isOcclusionEnabled = enabled
            } catch (exception: Exception) {
                Log.w("ArActivity", "Depth configuration failed", exception)
                return@setOnClickListener
            }
            binding.btnOcclusion.setColorFilter(if (isOcclusionEnabled) Color.parseColor("#F5C542") else Color.WHITE)
            Toast.makeText(
                this,
                if (isOcclusionEnabled) tr("Depth occlusion ON") else tr("Depth occlusion OFF"),
                Toast.LENGTH_SHORT
            ).show()
        }

        binding.btnMeasure.setOnClickListener {
            isMeasuring = !isMeasuring
            clearPendingMeasurement()
            binding.btnMeasure.setColorFilter(if (isMeasuring) Color.parseColor("#F5C542") else Color.WHITE)
            if (isMeasuring) {
                binding.tvHint.text = tr("Measure: tap first surface point")
            } else {
                binding.tvHint.text = tr("Drag to turn · pinch to resize")
            }
        }

        binding.btnCaptureMode.setOnClickListener {
            isVideoMode = !isVideoMode
            if (isVideoMode) {
                binding.btnCaptureMode.setImageResource(R.drawable.ic_ar_video)
                binding.btnCaptureMode.setColorFilter(Color.parseColor("#F5C542"))
                binding.btnShutter.setBackgroundResource(R.drawable.bg_shutter)
                Toast.makeText(this, tr("Switched to Video Mode"), Toast.LENGTH_SHORT).show()
            } else {
                binding.btnCaptureMode.setImageResource(R.drawable.ic_ar_video)
                binding.btnCaptureMode.setColorFilter(Color.WHITE)
                binding.btnShutter.setBackgroundResource(R.drawable.bg_shutter)
                Toast.makeText(this, tr("Switched to Photo Mode"), Toast.LENGTH_SHORT).show()
            }
        }

        binding.btnShutter.setOnClickListener {
            if (isVideoMode) {
                handleVideoRecord()
            } else {
                takePhoto()
            }
        }

        binding.btnHideUi.setOnClickListener {
            binding.uiContainer.visibility = View.GONE
            binding.reticleView.visibility = View.GONE
            binding.measurementsContainer.visibility = View.GONE
            binding.btnShowUi.visibility = View.VISIBLE
        }

        binding.btnShowUi.setOnClickListener {
            binding.uiContainer.visibility = View.VISIBLE
            binding.measurementsContainer.visibility = View.VISIBLE
            binding.btnShowUi.visibility = View.GONE
        }
    }

    private fun takePhoto() {
        binding.flashView.apply {
            alpha = 0.85f
            visibility = View.VISIBLE
            animate()
                .alpha(0f)
                .setDuration(350)
                .setListener(object : AnimatorListenerAdapter() {
                    override fun onAnimationEnd(animation: Animator) {
                        visibility = View.GONE
                    }
                })
        }

        SceneViewRecorder.takePhoto(
            activity = this,
            sceneView = binding.sceneView,
            onSaved = {
                Toast.makeText(this, tr("Photo saved to Gallery"), Toast.LENGTH_SHORT).show()
            },
            onError = { error ->
                Toast.makeText(this, "${tr("Photo failed")}: $error", Toast.LENGTH_SHORT).show()
            }
        )
    }

    private fun handleVideoRecord() {
        if (!SceneViewRecorder.isRecording) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                audioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                return
            }
            startVideoRecordingInternal()
        } else {
            stopVideoRecordingInternal()
        }
    }

    private fun startVideoRecordingInternal() {
        SceneViewRecorder.startVideoRecord(
            activity = this,
            sceneView = binding.sceneView,
            onStarted = {
                binding.btnCaptureMode.isEnabled = false
                binding.btnShutter.setBackgroundResource(R.drawable.bg_shutter_recording)
                binding.recordingIndicator.visibility = View.VISIBLE
                recordStartTime = SystemClock.elapsedRealtime()
                timerHandler.post(timerRunnable)
                Toast.makeText(this, tr("Recording started"), Toast.LENGTH_SHORT).show()
            },
            onError = { error ->
                binding.btnCaptureMode.isEnabled = true
                Toast.makeText(this, "${tr("Recording failed")}: $error", Toast.LENGTH_SHORT).show()
            }
        )
    }

    private fun stopVideoRecordingInternal(share: Boolean = true) {
        binding.btnCaptureMode.isEnabled = true
        timerHandler.removeCallbacks(timerRunnable)
        binding.btnShutter.setBackgroundResource(R.drawable.bg_shutter)
        binding.recordingIndicator.visibility = View.GONE

        SceneViewRecorder.stopVideoRecord(
            activity = this,
            share = share,
            sceneView = binding.sceneView,
            onStopped = {
                Toast.makeText(this, tr("Video saved to Gallery"), Toast.LENGTH_SHORT).show()
            },
            onError = { error ->
                Toast.makeText(this, "${tr("Recording failed")}: $error", Toast.LENGTH_SHORT).show()
            }
        )
    }

    override fun onPause() {
        if (SceneViewRecorder.isRecording) stopVideoRecordingInternal(share = false)
        super.onPause()
    }

    private fun releaseSceneContent() {
        modelLoad?.cancel()
        clearMeasurements()
        // ModelLoader owns every glTF entity, including ModelNode's root. Destroying
        // that root here would double-free it when the loader releases its asset.
        sceneNode?.let { content ->
            content.parent?.removeChildNode(content)
            binding.sceneView.removeChildNode(content)
            modelNode?.let { content.removeChildNode(it) }
            content.destroy()
        }
        anchorNode?.let { binding.sceneView.removeChildNode(it); it.destroy() }
        modelNode = null
        sceneNode = null
        anchorNode = null
    }

    override fun onDestroy() {
        timerHandler.removeCallbacks(timerRunnable)
        super.onDestroy()
    }
}
