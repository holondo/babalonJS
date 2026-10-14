package com.holondo.babalon.ar

import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.media.CamcorderProfile
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.provider.MediaStore
import android.util.Log
import android.view.PixelCopy
import android.Manifest
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.lifecycleScope
import io.github.sceneview.ar.ARSceneView
import androidx.core.content.FileProvider
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.max
import kotlin.math.min

object SceneViewRecorder {
    private const val TAG = "SceneViewRecorder"
    // Saving a capture must finish even if the Activity closes during disk IO.
    private val captureScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private fun createCapture(context: Context, video: Boolean): Uri {
        val extension = if (video) "mp4" else "jpg"
        val name = "Babalon-AR-${SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.US).format(Date())}.$extension"
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            val file = File(context.cacheDir, name).apply { createNewFile() }
            return FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        }
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, if (video) "video/mp4" else "image/jpeg")
            put(MediaStore.MediaColumns.RELATIVE_PATH, "${if (video) Environment.DIRECTORY_MOVIES else Environment.DIRECTORY_DCIM}/Babalon")
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        return context.contentResolver.insert(
            if (video) MediaStore.Video.Media.EXTERNAL_CONTENT_URI else MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            values
        ) ?: error("Could not create capture file")
    }

    private fun publishCapture(context: Context, uri: Uri) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) context.contentResolver.update(uri,
            ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
    }

    private var mediaRecorder: MediaRecorder? = null
    private var recordFileDescriptor: ParcelFileDescriptor? = null
    private var recordUri: Uri? = null
    var isRecording = false
        private set

    fun takePhoto(
        activity: Activity,
        sceneView: ARSceneView,
        onStart: (() -> Unit)? = null,
        onSaved: ((Uri) -> Unit)? = null,
        onError: ((String) -> Unit)? = null
    ) {
        onStart?.invoke()
        val bitmap = Bitmap.createBitmap(max(1, sceneView.width), max(1, sceneView.height), Bitmap.Config.ARGB_8888)
        try {
            PixelCopy.request(sceneView, bitmap, { result ->
                captureScope.launch {
                    var uri: Uri? = null
                    try {
                        check(result == PixelCopy.SUCCESS) { "PixelCopy failed: $result" }
                        withContext(Dispatchers.IO) {
                            uri = createCapture(activity, video = false)
                            activity.contentResolver.openOutputStream(uri!!)?.use { out ->
                                check(bitmap.compress(Bitmap.CompressFormat.JPEG, 95, out)) { "Could not encode photo" }
                            } ?: error("Could not open capture file")
                            publishCapture(activity, uri!!)
                        }
                        if (!activity.isFinishing && !activity.isDestroyed) {
                            onSaved?.invoke(uri!!)
                            shareMedia(activity, uri!!, "image/jpeg")
                        }
                    } catch (e: Exception) {
                        uri?.let { runCatching { activity.contentResolver.delete(it, null, null) } }
                        Log.e(TAG, "Error taking AR photo", e)
                        if (!activity.isDestroyed) onError?.invoke(e.message ?: "Failed to take photo")
                    } finally {
                        bitmap.recycle()
                    }
                }
            }, Handler(Looper.getMainLooper()))
        } catch (e: Exception) {
            bitmap.recycle()
            onError?.invoke(e.message ?: "Failed to take photo")
        }
    }

    fun startVideoRecord(
        activity: Activity,
        sceneView: ARSceneView,
        onStarted: (() -> Unit)? = null,
        onError: ((String) -> Unit)? = null
    ) {
        val lifecycleOwner = activity as? LifecycleOwner ?: return
        if (isRecording) return

        lifecycleOwner.lifecycleScope.launch {
            try {
                recordUri = createCapture(activity, video = true)

                recordFileDescriptor = activity.contentResolver.openFileDescriptor(recordUri!!, "w")
                    ?: throw IllegalStateException("Could not open file descriptor")

                val profile = if (CamcorderProfile.hasProfile(CamcorderProfile.QUALITY_1080P)) {
                    CamcorderProfile.get(CamcorderProfile.QUALITY_1080P)
                } else if (CamcorderProfile.hasProfile(CamcorderProfile.QUALITY_720P)) {
                    CamcorderProfile.get(CamcorderProfile.QUALITY_720P)
                } else {
                    CamcorderProfile.get(CamcorderProfile.QUALITY_HIGH)
                }

                // Mirror the viewport without stretching it or rotating already upright pixels.
                val factor = min(1f, min(
                    min(profile.videoFrameWidth, profile.videoFrameHeight).toFloat() / min(sceneView.width, sceneView.height),
                    max(profile.videoFrameWidth, profile.videoFrameHeight).toFloat() / max(sceneView.width, sceneView.height)
                ))
                val width = ((sceneView.width * factor).toInt() / 2 * 2).coerceAtLeast(2)
                val height = ((sceneView.height * factor).toInt() / 2 * 2).coerceAtLeast(2)
                val audio = ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

                mediaRecorder = (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    MediaRecorder(activity)
                } else {
                    @Suppress("DEPRECATION")
                    MediaRecorder()
                })
                mediaRecorder!!.apply {
                    setOrientationHint(0)
                    if (audio) setAudioSource(MediaRecorder.AudioSource.MIC)
                    setVideoSource(MediaRecorder.VideoSource.SURFACE)
                    setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                    setOutputFile(recordFileDescriptor!!.fileDescriptor)
                    setVideoEncodingBitRate(profile.videoBitRate.coerceAtLeast(8_000_000))
                    setVideoFrameRate(30)
                    setVideoSize(width, height)
                    setVideoEncoder(MediaRecorder.VideoEncoder.H264)
                    if (audio) {
                        setAudioChannels(2)
                        setAudioSamplingRate(44100)
                        setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                        setAudioEncodingBitRate(128000)
                    }
                    prepare()
                    start()
                }

                sceneView.startMirroring(
                    mediaRecorder!!.surface,
                    0, 0,
                    width,
                    height
                )

                isRecording = true
                onStarted?.invoke()
            } catch (e: Exception) {
                Log.e(TAG, "Failed to start AR video recording", e)
                cleanupRecorder(activity, discard = true)
                onError?.invoke(e.message ?: "Failed to start video recording")
            }
        }
    }

    fun stopVideoRecord(
        activity: Activity,
        sceneView: ARSceneView,
        share: Boolean = true,
        onStopped: ((Uri) -> Unit)? = null,
        onError: ((String) -> Unit)? = null
    ) {
        if (!isRecording) return
        // Release synchronously before Activity/SceneView destruction, even if its
        // lifecycleScope is cancelled. Clear the flag before opening a share sheet.
        isRecording = false
        val uri = recordUri
        var saved = false
        try {
            mediaRecorder?.surface?.let { sceneView.stopMirroring(it) }
            mediaRecorder?.stop()
            if (uri != null) publishCapture(activity, uri)
            saved = true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to stop AR video recording", e)
            onError?.invoke(e.message ?: "Failed to save video")
        } finally {
            cleanupRecorder(activity, discard = !saved)
        }
        if (saved && uri != null) {
            onStopped?.invoke(uri)
            if (share && !activity.isFinishing) shareMedia(activity, uri, "video/mp4")
        }
    }

    private fun cleanupRecorder(context: Context, discard: Boolean) {
        isRecording = false
        runCatching { mediaRecorder?.reset() }
        runCatching { mediaRecorder?.release() }
        mediaRecorder = null
        runCatching { recordFileDescriptor?.close() }
        recordFileDescriptor = null
        if (discard) recordUri?.let { runCatching { context.contentResolver.delete(it, null, null) } }
        recordUri = null
    }

    private fun shareMedia(activity: Activity, uri: Uri, mimeType: String) {
        try {
            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = mimeType
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(Intent.createChooser(shareIntent, null))
        } catch (e: Exception) {
            Log.e(TAG, "Could not launch share chooser", e)
        }
    }
}
