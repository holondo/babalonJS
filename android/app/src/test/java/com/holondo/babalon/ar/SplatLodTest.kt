package com.holondo.babalon.ar

import org.junit.Assert.*
import org.junit.Test

class SplatLodTest {
    private val identity=floatArrayOf(1f,0f,0f,0f,0f,1f,0f,0f,0f,0f,1f,0f,0f,0f,0f,1f)
    private val projection=floatArrayOf(2f,0f,0f,0f,0f,2f,0f,0f,0f,0f,-1.002f,-1f,0f,0f,-0.02002f,0f)
    @Test fun globalBudgetAndDepthOrderingAcrossObjects() {
        val data=SplatHierarchy(floatArrayOf(-0.2f,0f,-2f, 0.2f,0f,-4f, 0f,0f,-3f, 0f,0f,-5f),
            floatArrayOf(0.2f,0.2f,1f,0.2f),intArrayOf(-1,-1,-1,-1,0,1,-1,-1),intArrayOf(2,3),FloatArray(24),ByteArray(16),3)
        val limited=SplatLod.select(data,identity,projection,1000,2)
        assertEquals(1,SplatLod.select(data,identity,projection,1000,1).size)
        assertEquals(2,limited.size); assertTrue(limited.contains(2)); assertTrue(limited.contains(3))
        val refined=SplatLod.select(data,identity,projection,1000,3)
        assertArrayEquals(intArrayOf(3,1,0),refined)
        val far=identity.copyOf().apply { this[14]=-10000f }
        assertTrue(SplatLod.select(data,far,projection,1000,3).size<refined.size)
        val behind=identity.copyOf().apply { this[14]=100f }
        assertEquals(0,SplatLod.select(data,behind,projection,1000,3).size)
    }
}
