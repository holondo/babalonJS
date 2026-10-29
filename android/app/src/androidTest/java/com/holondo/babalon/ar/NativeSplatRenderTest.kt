package com.holondo.babalon.ar

import android.graphics.Bitmap
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.android.filament.*
import com.google.android.filament.utils.Utils
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.max

/** Real Filament material/GLES rendering without requiring a physical ARCore tracking session. */
@RunWith(AndroidJUnit4::class)
class NativeSplatRenderTest {
    @Test fun gaussianRendersThroughTheSurfaceCapturePathWithPostProcessing() {
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val activity=instrumentation.startActivitySync(android.content.Intent(instrumentation.targetContext,com.holondo.babalon.MainActivity::class.java).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)) as com.holondo.babalon.MainActivity
        try { runBlocking { withContext(Dispatchers.Main) {
            val surface=io.github.sceneview.SceneView(activity,isOpaque=true,cameraManipulator=null)
            activity.setContentView(surface,android.view.ViewGroup.LayoutParams(256,256))
            surface.lifecycle=activity.lifecycle
            surface.view.renderQuality=View.RenderQuality().apply { hdrColorBuffer=View.QualityLevel.LOW }
            surface.view.antiAliasing=View.AntiAliasing.NONE
            surface.cameraNode.position=dev.romainguy.kotlin.math.Float3(0f,0f,3f)
            surface.cameraNode.lookAt(dev.romainguy.kotlin.math.Float3(0f))
            var node: NativeSplatNode?=null
            suspend fun capture(): Bitmap {
                val bitmap=Bitmap.createBitmap(256,256,Bitmap.Config.ARGB_8888)
                val result=CompletableDeferred<Int>()
                android.view.PixelCopy.request(surface,bitmap,{ result.complete(it) },android.os.Handler(android.os.Looper.getMainLooper()))
                assertEquals(android.view.PixelCopy.SUCCESS,result.await())
                return bitmap
            }
            try {
                // Establish a stock SceneView baseline before creating any Gaussian material.
                delay(1000)
                val baseline=capture(); val base=baseline.getPixel(0,0); baseline.recycle()
                Log.i("NativeSplatTest","stock SceneView post-process baseline=$base (black expected)")
                assumeTrue("Stock SceneView post processing produces white even without Gaussian nodes on this emulator",
                    !(android.os.Build.HARDWARE=="ranchu" && android.graphics.Color.red(base)>240))
                val data=SplatHierarchy(floatArrayOf(0f,0f,0f),floatArrayOf(1f),intArrayOf(-1,-1),intArrayOf(0),
                floatArrayOf(0.06f,0f,0f,0.002f,0f,0.01f),byteArrayOf(230.toByte(),60,30,255.toByte()),1)
                node=NativeSplatNode(activity,surface.engine,data)
                surface.addChildNode(node)
                delay(1500)
                val bitmap=capture()
                val center=bitmap.getPixel(128,128); val corner=bitmap.getPixel(0,0)
                Log.i("NativeSplatTest","surface center=$center, corner=$corner")
                File(activity.getExternalFilesDir(null),"native-gaussian-surface.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG,100,it) }
                assertTrue("Surface is uniformly blank",center!=corner)
                assertTrue("Gaussian color was lost",android.graphics.Color.red(center)>android.graphics.Color.blue(center)+30)
                bitmap.recycle()
            } finally { node?.let { surface.removeChildNode(it); it.destroy() }; surface.destroy() }
        } } } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
    @Test fun anisotropicGaussianDrawsInFilamentAndReleases() {
        val data=SplatHierarchy(floatArrayOf(0f,0f,0f),floatArrayOf(1f),intArrayOf(-1,-1),intArrayOf(0),
            floatArrayOf(0.06f,0f,0f,0.002f,0f,0.01f),byteArrayOf(230.toByte(),60,30,255.toByte()),1)
        render(data,"native-gaussian-ellipse.png",true)
    }

    @Test fun realSessionLoadsSelectsAndDrawsWithoutPointFallback() {
        val path=InstrumentationRegistry.getArguments().getString("glbPath")
        assumeTrue("Pass -e glbPath with a session exported by check-native-splat-browser.mjs",path!=null)
        val file=File.createTempFile("native-splat-check-",".glb",InstrumentationRegistry.getInstrumentation().targetContext.cacheDir)
        File(path!!).copyTo(file,overwrite=true)
        val data=requireNotNull(NativeSplatData.load(file))
        assertTrue(data.sourceCount>data.roots.size)
        assertTrue(data.count<=262143*data.roots.size)
        render(data,"native-gaussian-real.png",false)
        // Also exercise the ordinary glTF loader on a splat-only session (no renderable meshes).
        runBlocking { withContext(Dispatchers.Main) {
            val context=android.view.ContextThemeWrapper(InstrumentationRegistry.getInstrumentation().targetContext,androidx.appcompat.R.style.Theme_AppCompat)
            val view=NativeArSceneView(context)
            val meshFile=withContext(Dispatchers.Default) { NativeSplatData.meshFile(file) }
            try { assertNotNull(view.loadScene(meshFile)); assertTrue(meshFile.length()<file.length()) }
            finally { view.destroy(); if(meshFile!=file) meshFile.delete(); file.delete() }
        } }
    }

    private fun render(data: SplatHierarchy, filename: String, ellipse: Boolean) = runBlocking {
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val pixels=ByteBuffer.allocateDirect(256*256*4)
        val complete=CountDownLatch(1)
        withContext(Dispatchers.Main) {
            Utils.init()
            val engine=Engine.create(Engine.Backend.OPENGL)
            val renderer=engine.createRenderer()
            val scene=engine.createScene(); val view=engine.createView()
            val cameraEntity=EntityManager.get().create(); val camera=engine.createCamera(cameraEntity)
            val grading=ColorGrading.Builder().toneMapper(ToneMapper.Filmic()).build(engine)
            val skybox=Skybox.Builder().color(0f,0f,0f,1f).build(engine)
            scene.skybox=skybox
            val swap=engine.createSwapChain(256,256,0)
            val color=Texture.Builder().width(256).height(256).levels(1).sampler(Texture.Sampler.SAMPLER_2D)
                .format(Texture.InternalFormat.RGBA8).usage(Texture.Usage.COLOR_ATTACHMENT or Texture.Usage.SAMPLEABLE).build(engine)
            val depth=Texture.Builder().width(256).height(256).levels(1).sampler(Texture.Sampler.SAMPLER_2D)
                .format(Texture.InternalFormat.DEPTH24).usage(Texture.Usage.DEPTH_ATTACHMENT).build(engine)
            val target=RenderTarget.Builder().texture(RenderTarget.AttachmentPoint.COLOR,color).texture(RenderTarget.AttachmentPoint.DEPTH,depth).build(engine)
            var node: NativeSplatNode?=null
            try {
                view.scene=scene; view.camera=camera; view.viewport=Viewport(0,0,256,256)
                view.renderTarget=target
                view.colorGrading=grading; view.antiAliasing=View.AntiAliasing.NONE
                // SwiftShader's headless post-process readback is blank. Test covariance in
                // this raw target, and post processing separately through the real Surface.
                view.isPostProcessingEnabled=false
                renderer.clearOptions=Renderer.ClearOptions().apply { clear=true; clearColor=floatArrayOf(0f,0f,0f,1f) }
                camera.setProjection(45.0,1.0,0.01,1000.0,Camera.Fov.VERTICAL)
                camera.setExposure(1f)
                val min=FloatArray(3) { Float.POSITIVE_INFINITY }; val max=FloatArray(3) { Float.NEGATIVE_INFINITY }
                for(i in 0 until data.count) for(c in 0..2) { min[c]=minOf(min[c],data.positions[i*3+c]); max[c]=maxOf(max[c],data.positions[i*3+c]) }
                val center=DoubleArray(3) { (min[it]+max[it]).toDouble()/2 }
                val radius=if(ellipse) 1.0 else max(0.1,(0..2).maxOf { (max[it]-min[it]).toDouble()/2 })
                camera.lookAt(center[0],center[1],center[2]+radius*3.0,center[0],center[1],center[2],0.0,1.0,0.0)
                node=NativeSplatNode(instrumentation.targetContext,engine,data)
                scene.addEntity(node.entity)
                val projection=camera.getProjectionMatrix(DoubleArray(16)).map { it.toFloat() }.toFloatArray()
                val modelView=camera.getViewMatrix(FloatArray(16))
                node.update(modelView,projection,256)
                delay(1000)
                assertTrue(node.activeCount in 1..30000)
                if(data.sourceCount>30000) {
                    node.budget=1000
                    assertTrue("Budget reduction was not immediate",node.activeCount<=1000)
                    node.update(modelView,projection,256); delay(300)
                    assertTrue(node.activeCount in 1..1000)
                    node.budget=30000
                    node.update(modelView,projection,256); delay(500)
                    assertTrue(node.activeCount in 1001..30000)
                }
                repeat(4) {
                    if(renderer.beginFrame(swap,System.nanoTime())) { renderer.render(view); renderer.endFrame() }
                    engine.flushAndWait(); delay(100)
                }
                assertTrue(renderer.beginFrame(swap,System.nanoTime()))
                renderer.render(view)
                renderer.readPixels(target,0,0,256,256,Texture.PixelBufferDescriptor(pixels,Texture.Format.RGBA,Texture.Type.UBYTE).apply {
                    setCallback(java.util.concurrent.Executor { it.run() },Runnable { complete.countDown() })
                })
                renderer.endFrame(); engine.flushAndWait()
                Log.i("NativeSplatTest","source=${data.sourceCount}, atlas=${data.count}, active=${node.activeCount}")
            } finally {
                node?.let { scene.removeEntity(it.entity); it.destroy() }
                engine.destroyRenderTarget(target); engine.destroyTexture(color); engine.destroyTexture(depth)
                engine.destroySwapChain(swap); engine.destroyRenderer(renderer); engine.destroyView(view); engine.destroyScene(scene)
                engine.destroySkybox(skybox); engine.destroyColorGrading(grading); engine.destroyCameraComponent(cameraEntity); EntityManager.get().destroy(cameraEntity); engine.destroy()
            }
        }
        assertTrue("GPU readback did not complete",complete.await(5,TimeUnit.SECONDS))
        var left=256; var right=0; var top=256; var bottom=0; var visible=0
        for(y in 0..255) for(x in 0..255) { val i=(y*256+x)*4
            if((pixels.get(i).toInt() and 255)>15||(pixels.get(i+1).toInt() and 255)>15||(pixels.get(i+2).toInt() and 255)>15) {
                visible++; left=minOf(left,x); right=maxOf(right,x); top=minOf(top,y); bottom=maxOf(bottom,y)
            }
        }
        val bitmap=Bitmap.createBitmap(256,256,Bitmap.Config.ARGB_8888); pixels.rewind(); bitmap.copyPixelsFromBuffer(pixels)
        File(instrumentation.targetContext.getExternalFilesDir(null),filename).outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG,100,it) }; bitmap.recycle()
        Log.i("NativeSplatTest","pixels=$visible, bounds=${right-left}x${bottom-top}")
        assertTrue("Gaussian material rendered no visible content",visible>100)
        if(ellipse) assertTrue("Covariance was rendered as a round point",right-left>(bottom-top)*2)
    }
}
