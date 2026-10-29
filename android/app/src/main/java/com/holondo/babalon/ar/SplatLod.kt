package com.holondo.babalon.ar

import java.util.Arrays
import kotlin.math.max
import kotlin.math.sqrt

/** Immutable session hierarchy, in glTF composition coordinates; independent of Android/GPU. */
data class SplatHierarchy(
    val positions: FloatArray, val radii: FloatArray, val children: IntArray,
    val roots: IntArray, val covariance: FloatArray, val colors: ByteArray,
    val sourceCount: Int
) {
    val count get() = radii.size
}

/** Global screen-space refinement and painter's order, called only on a background dispatcher. */
object SplatLod {
    class Workspace(count: Int) {
        val scores=FloatArray(count)
        val depths=FloatArray(count)
        val heap=IntArray(count)
        val done=IntArray(minOf(count,120000))
        val keys=LongArray(minOf(count,120000))
    }
    fun multiply(a: FloatArray, b: FloatArray): FloatArray = FloatArray(16).also { out ->
        for (c in 0..3) for (r in 0..3) for (k in 0..3) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
    }

    fun select(data: SplatHierarchy, modelView: FloatArray, projection: FloatArray, height: Int, budget: Int, workspace: Workspace = Workspace(data.count)): IntArray {
        val limit = budget.coerceIn(1, 120000)
        val clip = multiply(projection, modelView)
        val planes = FloatArray(24)
        for (p in 0..5) {
            val axis = p / 2; val sign = if (p % 2 == 0) 1f else -1f
            for (c in 0..3) planes[p * 4 + c] = clip[c * 4 + 3] + sign * clip[c * 4 + axis]
            val n = sqrt(planes[p*4]*planes[p*4]+planes[p*4+1]*planes[p*4+1]+planes[p*4+2]*planes[p*4+2]).coerceAtLeast(1e-12f)
            for (c in 0..3) planes[p*4+c] /= n
        }
        val scale = sqrt((0..2).sumOf { c -> (0..2).sumOf { r -> (modelView[c*4+r]*modelView[c*4+r]).toDouble() } }).toFloat()
        val focal = kotlin.math.abs(projection[5]) * height / 2f
        val scores = workspace.scores
        val depths = workspace.depths
        fun score(i: Int): Float {
            val o = i*3; val x=data.positions[o]; val y=data.positions[o+1]; val z=data.positions[o+2]
            val vx=modelView[0]*x+modelView[4]*y+modelView[8]*z+modelView[12]
            val vy=modelView[1]*x+modelView[5]*y+modelView[9]*z+modelView[13]
            val vz=modelView[2]*x+modelView[6]*y+modelView[10]*z+modelView[14]
            depths[i]=vz
            val distance=sqrt(vx*vx+vy*vy+vz*vz)
            // Frustum planes are normalized in composition space. Add a pose-latency margin.
            val margin=data.radii[i]+distance/max(scale,1e-8f)*0.15f
            for (p in 0..5) if (planes[p*4]*x+planes[p*4+1]*y+planes[p*4+2]*z+planes[p*4+3] < -margin) return -1f
            val radius=data.radii[i]*scale
            return focal*radius/max(0.01f,distance-radius)
        }
        val heap=workspace.heap; var heapSize=0
        fun push(i: Int) {
            var k=heapSize++
            while(k>0) { val parent=(k-1)/2; if(scores[heap[parent]]>=scores[i]) break; heap[k]=heap[parent]; k=parent }
            heap[k]=i
        }
        fun pop(): Int {
            val first=heap[0]; val last=heap[--heapSize]; var k=0
            while(k*2+1<heapSize) { var c=k*2+1; if(c+1<heapSize&&scores[heap[c+1]]>scores[heap[c]]) c++; if(scores[last]>=scores[heap[c]]) break; heap[k]=heap[c]; k=c }
            if(heapSize>0) heap[k]=last
            return first
        }
        // Every root represents an object. Pathological scenes keep the largest visible roots.
        val roots=data.roots.filter { scores[it]=score(it); scores[it]>=0f }.sortedByDescending { scores[it] }.take(limit)
        roots.forEach { push(it) }
        var selected=heapSize; val done=workspace.done; var doneSize=0
        while(heapSize>0&&scores[heap[0]]>6f) {
            val parent=pop(); val left=data.children[parent*2]; val right=data.children[parent*2+1]
            if(left<0) { done[doneSize++]=parent; continue }
            scores[left]=score(left); if(right>=0) scores[right]=score(right)
            val a=if(scores[left]>=0f) left else -1; val b=if(right>=0&&scores[right]>=0f) right else -1
            val extra=(if(a>=0) 1 else 0)+(if(b>=0) 1 else 0)-1
            if(selected+extra>limit) { push(parent); break }
            selected+=extra; if(a>=0) push(a); if(b>=0) push(b)
        }
        val keys=workspace.keys; val resultSize=doneSize+heapSize
        fun key(i: Int): Long {
            val bits=depths[i].toRawBits(); val ordered=bits xor ((bits shr 31) and 0x7fffffff)
            return (ordered.toLong() shl 32) or (i.toLong() and 0xffffffffL)
        }
        for(i in 0 until doneSize) keys[i]=key(done[i])
        for(i in 0 until heapSize) keys[doneSize+i]=key(heap[i])
        Arrays.sort(keys,0,resultSize)
        return IntArray(resultSize) { keys[it].toInt() }
    }
}
