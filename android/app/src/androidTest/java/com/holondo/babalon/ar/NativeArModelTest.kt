package com.holondo.babalon.ar

import android.view.ContextThemeWrapper
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.romainguy.kotlin.math.Float3
import dev.romainguy.kotlin.math.Quaternion
import io.github.sceneview.node.ModelNode
import io.github.sceneview.node.Node
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Run with a GLB produced by scripts/fixtures/native-ar-export.html. */
@RunWith(AndroidJUnit4::class)
class NativeArModelTest {
    @Test
    fun exportedSkinLoadsAndReleasesWithoutDestroyingAssetEntitiesTwice() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val path = InstrumentationRegistry.getArguments().getString("glbPath")
        assumeTrue("Pass -e glbPath with the exported regression GLB on the device", path != null)
        val cached = File.createTempFile("native AR cena ç ", ".glb", instrumentation.targetContext.cacheDir)
        File(path!!).copyTo(cached, overwrite = true)
        assertTrue(cached.length() > 100)
        try { runBlocking { withContext(Dispatchers.Main) {
            repeat(2) {
                val context = ContextThemeWrapper(instrumentation.targetContext, androidx.appcompat.R.style.Theme_AppCompat)
                val view = NativeArSceneView(context)
                val instance = try { requireNotNull(view.loadScene(cached)) }
                    catch (error: Throwable) { view.destroy(); throw error }
                val model = ModelNode(instance, autoAnimate = false, scaleToUnits = null, centerOrigin = null)
                assertTrue(model.extents.x > 0f)
                assertTrue(model.playingAnimations.isEmpty())
                val content = Node(view.engine).apply { addChildNode(model) }
                view.addChildNode(content)
                model.position = Float3(-3.8611135f, -1f, -4f)
                content.position = Float3(0f, 0f, -2f)
                content.scale = Float3(2f)
                content.quaternion = Quaternion.fromAxisAngle(Float3(0f, 1f, 0f), 70f)
                // Check the actual model-space contact point, not the wrapper position.
                val contact = model.getWorldPosition(Float3(3.8611135f, 1f, 4f))
                assertEquals(0f, contact.x, 0.0001f)
                assertEquals(0f, contact.y, 0.0001f)
                assertEquals(-2f, contact.z, 0.0001f)
                model.onFrame(System.nanoTime()) // Pop renderables and update actual skin matrices.
                var released = 0
                view.releaseContent = {
                    released++
                    view.removeChildNode(content)
                    content.removeChildNode(model)
                    content.destroy()
                }
                view.destroy()
                view.destroy()
                assertEquals(1, released)
            }
        } } } finally { cached.delete() }
    }
}
