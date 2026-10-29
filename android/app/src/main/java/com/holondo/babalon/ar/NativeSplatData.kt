package com.holondo.babalon.ar

import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.sqrt

/** Reads our temporary session extension, never a user SPZ or saved project. */
object NativeSplatData {
    /** Avoid making gltfio retain/upload the Gaussian atlas as unused ordinary mesh data. */
    fun meshFile(file: File): File = RandomAccessFile(file,"r").use { input ->
        val header=ByteArray(20); input.readFully(header)
        val originalHeader=ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN)
        val jsonLength=originalHeader.getInt(12)
        require(jsonLength in 1..(64*1024*1024))
        val bytes=ByteArray(jsonLength); input.readFully(bytes)
        val json=JSONObject(String(bytes,Charsets.UTF_8))
        val extension=json.optJSONObject("extensions")?.optJSONObject("BABALON_ar_gaussian_lod") ?: return@use file
        val meshBytes=extension.getInt("meshBufferByteLength"); val viewCount=extension.getInt("meshBufferViewCount")
        require(meshBytes>=0&&meshBytes%4==0&&28L+jsonLength+meshBytes<=input.length())
        val views=json.getJSONArray("bufferViews"); require(viewCount in 0..views.length())
        while(views.length()>viewCount) views.remove(views.length()-1)
        json.getJSONObject("extensions").remove("BABALON_ar_gaussian_lod")
        val used=json.getJSONArray("extensionsUsed")
        for(i in used.length()-1 downTo 0) if(used.getString(i)=="BABALON_ar_gaussian_lod") used.remove(i)
        if(meshBytes>0) json.getJSONArray("buffers").getJSONObject(0).put("byteLength",meshBytes)
        else { json.remove("buffers"); json.remove("bufferViews") }
        val encoded=json.toString().toByteArray(Charsets.UTF_8)
        val padded=ByteArray((encoded.size+3)/4*4) { 32 }; encoded.copyInto(padded)
        val outputHeader=ByteBuffer.allocate(20).order(ByteOrder.LITTLE_ENDIAN)
        outputHeader.putInt(0x46546c67).putInt(2).putInt(20+padded.size+if(meshBytes>0) 8+meshBytes else 0).putInt(padded.size).putInt(0x4e4f534a)
        val target=File.createTempFile("native-ar-mesh-",".glb",file.parentFile)
        try {
            target.outputStream().use { output ->
                output.write(outputHeader.array()); output.write(padded)
                if(meshBytes>0) {
                    output.write(ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putInt(meshBytes).putInt(0x004e4942).array())
                    input.seek(28L+jsonLength)
                    val copy=ByteArray(65536); var remaining=meshBytes
                    while(remaining>0) { val n=minOf(copy.size,remaining); input.readFully(copy,0,n); output.write(copy,0,n); remaining-=n }
                }
            }
            target
        } catch(error: Throwable) { target.delete(); throw error }
    }

    fun load(file: File): SplatHierarchy? = RandomAccessFile(file, "r").use { input ->
        fun ints(bytes: ByteArray) = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        val header=ByteArray(20); input.readFully(header); val h=ints(header)
        require(h.getInt(0)==0x46546c67&&h.getInt(4)==2) { "Invalid AR session GLB" }
        val jsonLength=h.getInt(12)
        require(jsonLength in 1..(64*1024*1024)&&h.getInt(16)==0x4e4f534a)
        val jsonBytes=ByteArray(jsonLength); input.readFully(jsonBytes)
        val json=JSONObject(String(jsonBytes,Charsets.UTF_8))
        val extension=json.optJSONObject("extensions")?.optJSONObject("BABALON_ar_gaussian_lod") ?: return@use null
        require(extension.getInt("version")==1) { "Unsupported AR Gaussian version" }
        val trees=extension.getJSONArray("trees"); val views=json.getJSONArray("bufferViews")
        require(trees.length() in 1..10000)
        val binHeader=ByteArray(8); input.readFully(binHeader)
        val binLength=ints(binHeader).getInt(0)
        val binStart=28L+jsonLength
        require(ints(binHeader).getInt(4)==0x004e4942&&binLength>=0&&binStart+binLength<=input.length())
        fun read(index: Int, expected: Int): ByteBuffer {
            val view=views.getJSONObject(index); val offset=view.optLong("byteOffset",0)
            require(view.optInt("buffer",0)==0&&view.getInt("byteLength")==expected&&offset>=0&&offset+expected<=binLength)
            val bytes=ByteArray(expected); input.seek(binStart+offset); input.readFully(bytes); return ints(bytes)
        }
        var count=0; var sourceCount=0
        for(t in 0 until trees.length()) { val tree=trees.getJSONObject(t); val n=tree.getInt("count"); require(n in 1..262143); count=Math.addExact(count,n); sourceCount=Math.addExact(sourceCount,tree.getInt("sourceCount")) }
        require(count<=2_000_000) { "AR Gaussian session exceeds the native atlas limit" }
        val positions=FloatArray(count*3); val covariance=FloatArray(count*6); val colors=ByteArray(count*4)
        val radii=FloatArray(count); val children=IntArray(count*2); val roots=IntArray(trees.length())
        var base=0
        for(t in 0 until trees.length()) {
            val tree=trees.getJSONObject(t); val n=tree.getInt("count"); val root=tree.getInt("root")
            require(root in 0 until n); roots[t]=base+root
            val records=read(tree.getInt("records"),n*32); val rs=read(tree.getInt("radii"),n*4); val cs=read(tree.getInt("children"),n*8)
            val matrix=tree.getJSONArray("matrix"); require(matrix.length()==16)
            val m=FloatArray(16) { matrix.getDouble(it).toFloat().also { v -> require(v.isFinite()) } }
            require(m[3]==0f&&m[7]==0f&&m[11]==0f&&m[15]==1f)
            val alpha=tree.optDouble("alpha",1.0).toFloat().coerceIn(0f,1f)
            val scale=sqrt((0..2).sumOf { c -> (0..2).sumOf { r -> (m[c*4+r]*m[c*4+r]).toDouble() } }).toFloat()
            val rotation=FloatArray(9); val factor=FloatArray(9)
            for(i in 0 until n) {
                val dst=base+i; val x=records.getFloat(i*32); val y=records.getFloat(i*32+4); val z=records.getFloat(i*32+8)
                require(x.isFinite()&&y.isFinite()&&z.isFinite())
                positions[dst*3]=m[0]*x+m[4]*y+m[8]*z+m[12]; positions[dst*3+1]=m[1]*x+m[5]*y+m[9]*z+m[13]; positions[dst*3+2]=m[2]*x+m[6]*y+m[10]*z+m[14]
                radii[dst]=rs.getFloat(i*4)*scale; require(radii[dst].isFinite()&&radii[dst]>=0f)
                for(c in 0..1) { val child=cs.getInt((i*2+c)*4); require(child == -1 || child in 0 until i); children[dst*2+c]=if(child<0) -1 else base+child }
                var w=(records.get(i*32+28).toInt() and 255)-127.5f; var qx=(records.get(i*32+29).toInt() and 255)-127.5f
                var qy=(records.get(i*32+30).toInt() and 255)-127.5f; var qz=(records.get(i*32+31).toInt() and 255)-127.5f
                val norm=sqrt(w*w+qx*qx+qy*qy+qz*qz); w/=norm; qx/=norm; qy/=norm; qz/=norm
                rotation[0]=1-2*(qy*qy+qz*qz); rotation[1]=2*(qx*qy-w*qz); rotation[2]=2*(qx*qz+w*qy)
                rotation[3]=2*(qx*qy+w*qz); rotation[4]=1-2*(qx*qx+qz*qz); rotation[5]=2*(qy*qz-w*qx)
                rotation[6]=2*(qx*qz-w*qy); rotation[7]=2*(qy*qz+w*qx); rotation[8]=1-2*(qx*qx+qy*qy)
                for(r in 0..2) for(c in 0..2) {
                    val s=records.getFloat(i*32+12+c*4); require(s.isFinite())
                    factor[r*3+c]=(m[r]*rotation[c]+m[4+r]*rotation[3+c]+m[8+r]*rotation[6+c])*s
                }
                var k=dst*6
                for(r in 0..2) for(c in r..2) { var v=0f; for(a in 0..2) v+=factor[r*3+a]*factor[c*3+a]; require(v.isFinite()); covariance[k++]=v }
                for(c in 0..2) colors[dst*4+c]=records.get(i*32+24+c)
                colors[dst*4+3]=(((records.get(i*32+27).toInt() and 255)*alpha).toInt()).toByte()
            }
            base+=n
        }
        SplatHierarchy(positions,radii,children,roots,covariance,colors,sourceCount)
    }
}
