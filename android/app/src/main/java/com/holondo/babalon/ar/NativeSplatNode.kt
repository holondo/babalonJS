package com.holondo.babalon.ar

import android.content.Context
import android.os.SystemClock
import com.google.android.filament.*
import io.github.sceneview.node.RenderableNode
import kotlinx.coroutines.*
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.ceil
import kotlin.math.sqrt

/** One globally sorted Gaussian draw, inside the same Filament surface as glTF and the camera. */
class NativeSplatNode(context: Context, engine: Engine, val hierarchy: SplatHierarchy) : RenderableNode(engine) {
    var budget = 30000
        set(value) { field=value.coerceIn(1,120000); generation++; lastPose=null
            // Enforce reductions synchronously; the next traversal replaces this temporary cut.
            if(activeCount>field) setCount(field)
        }
    var activeCount = 0
        private set
    private val capacity = minOf(120000,hierarchy.count)
    private val width = ceil(sqrt(maxOf(hierarchy.count,capacity).toDouble())).toInt()
    private val scope = CoroutineScope(SupervisorJob()+Dispatchers.Main.immediate)
    private val workspace = SplatLod.Workspace(hierarchy.count)
    private var previousOrder: IntArray? = null
    private var selection: Job? = null
    private var destroyed = false
    private var generation = 0
    private var lastUpdate = 0L
    private var lastPose: FloatArray? = null
    private var lastHeight = 0
    private var lastProjection: FloatArray? = null
    private val material: Material
    private val instance: MaterialInstance
    private val vertices: VertexBuffer
    private val indices: IndexBuffer
    private val textures = mutableListOf<Texture>()
    private val order: Texture

    init {
        val bytes=context.assets.open("materials/gaussian.filamat").use { it.readBytes() }
        val buffer=ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder()).put(bytes).apply { flip() }
        material=Material.Builder().payload(buffer,buffer.remaining()).build(engine)
        instance=material.createInstance()
        fun texture(name: String, format: Texture.InternalFormat): Texture = Texture.Builder().width(width).height(width).levels(1)
            .sampler(Texture.Sampler.SAMPLER_2D).format(format).build(engine).also {
                textures.add(it)
                instance.setParameter(name,it,TextureSampler(TextureSampler.MinFilter.NEAREST,TextureSampler.MagFilter.NEAREST,TextureSampler.WrapMode.CLAMP_TO_EDGE))
            }
        fun floats(name: String, values: FloatArray, stride: Int, offset: Int, components: Int) {
            val texture=texture(name,Texture.InternalFormat.RGBA32F)
            val data=ByteBuffer.allocateDirect(width*width*16).order(ByteOrder.nativeOrder()).asFloatBuffer()
            for(i in 0 until hierarchy.count) for(c in 0 until components) data.put(i*4+c,values[i*stride+offset+c])
            texture.setImage(engine,0,Texture.PixelBufferDescriptor(data,Texture.Format.RGBA,Texture.Type.FLOAT))
        }
        floats("centers",hierarchy.positions,3,0,3)
        floats("covarianceA",hierarchy.covariance,6,0,4)
        floats("covarianceB",hierarchy.covariance,6,4,2)
        val colorTexture=texture("colors",Texture.InternalFormat.RGBA8)
        val colorData=ByteBuffer.allocateDirect(width*width*4).put(hierarchy.colors).apply { rewind() }
        colorTexture.setImage(engine,0,Texture.PixelBufferDescriptor(colorData,Texture.Format.RGBA,Texture.Type.UBYTE))
        order=texture("drawOrder",Texture.InternalFormat.R32UI)
        instance.setParameter("textureWidth",width)
        // Four vertices/slot; position.z is the exact integer slot. This works with
        // pinned Filament 1.52 and avoids its newer hardware-instance material ABI.
        val vertexData=ByteBuffer.allocateDirect(capacity*4*12).order(ByteOrder.nativeOrder()).asFloatBuffer()
        val indexData=ByteBuffer.allocateDirect(capacity*6*4).order(ByteOrder.nativeOrder()).asIntBuffer()
        val quadIndices=intArrayOf(0,1,2,0,2,3)
        for(i in 0 until capacity) {
            for(c in 0..3) { vertexData.put(if(c==0||c==3) -1f else 1f); vertexData.put(if(c<2) -1f else 1f); vertexData.put(i.toFloat()) }
            for(c in quadIndices) indexData.put(i*4+c)
        }
        vertexData.flip(); indexData.flip()
        vertices=VertexBuffer.Builder().bufferCount(1).vertexCount(capacity*4)
            .attribute(VertexBuffer.VertexAttribute.POSITION,0,VertexBuffer.AttributeType.FLOAT3,0,12).build(engine)
        vertices.setBufferAt(engine,0,vertexData)
        indices=IndexBuffer.Builder().indexCount(capacity*6).bufferType(IndexBuffer.Builder.IndexType.UINT).build(engine)
        indices.setBuffer(engine,indexData)
        RenderableManager.Builder(1).boundingBox(Box(0f,0f,0f,1f,1f,1f)).culling(false)
            .castShadows(false).receiveShadows(false).material(0,instance)
            .geometry(0,RenderableManager.PrimitiveType.TRIANGLES,vertices,indices,0,6)
            .build(engine,entity)
        isTouchable=false
        isHittable=false
        upload(hierarchy.roots.take(capacity).toIntArray())
    }

    private fun setCount(count: Int) {
        activeCount=count
        val manager=engine.renderableManager; val renderable=manager.getInstance(entity)
        manager.setGeometryAt(renderable,0,RenderableManager.PrimitiveType.TRIANGLES,vertices,indices,0,maxOf(1,count)*6)
        manager.setLayerMask(renderable,0xff,if(count==0||!isVisible) 0 else 0xff)
    }

    private fun upload(selected: IntArray) {
        if(selected.contentEquals(previousOrder)&&activeCount==selected.size) return
        previousOrder=selected
        // Upload only selected order rows, not the static atlas or unused source records.
        val rows=maxOf(1,(selected.size+width-1)/width)
        val buffer=ByteBuffer.allocateDirect(width*rows*4).order(ByteOrder.nativeOrder()).asIntBuffer()
        buffer.put(selected); buffer.rewind()
        order.setImage(engine,0,0,0,width,rows,Texture.PixelBufferDescriptor(buffer,Texture.Format.R_INTEGER,Texture.Type.UINT))
        setCount(selected.size)
    }

    fun update(view: FloatArray, projection: FloatArray, height: Int) {
        val now=SystemClock.elapsedRealtime()
        if(destroyed||!isVisible||selection?.isActive==true||now-lastUpdate<150) return
        val world=engine.transformManager.getWorldTransform(transformInstance,FloatArray(16))
        val modelView=SplatLod.multiply(view,world)
        val old=lastPose
        if(old!=null&&height==lastHeight&&projection.contentEquals(lastProjection)&&modelView.indices.all { kotlin.math.abs(modelView[it]-old[it])<0.001f }) return
        lastUpdate=now; lastPose=modelView; lastHeight=height; lastProjection=projection.copyOf()
        val epoch=generation; val limit=budget; val p=projection.copyOf()
        selection=scope.launch {
            val selected=withContext(Dispatchers.Default) { SplatLod.select(hierarchy,modelView,p,height,limit,workspace) }
            if(!destroyed&&epoch==generation) upload(selected)
        }
    }

    override fun destroy() {
        if(destroyed) return
        destroyed=true; scope.cancel()
        super.destroy()
        engine.destroyMaterialInstance(instance)
        engine.destroyMaterial(material)
        textures.forEach { engine.destroyTexture(it) }
        engine.destroyVertexBuffer(vertices); engine.destroyIndexBuffer(indices)
    }
}
