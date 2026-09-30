package com.networkpeer.mobile.core.evidence

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class EvidenceNetworkQualityTest {

    @Test
    fun `wifi gets full concurrency regardless of the radio estimate`() {
        listOf(-1, 0, 50, 400, 100_000).forEach { kbps ->
            assertEquals(
                "wifi @ $kbps",
                EvidenceNetworkQuality.MAX_CONCURRENT_UPLOADS,
                EvidenceNetworkQuality.concurrencyFor(highCapacityTransport = true, upstreamKbps = kbps),
            )
        }
    }

    @Test
    fun `a slow mobile uplink uploads one at a time`() {
        // The case this exists for: three parallel uploads on a village cell all
        // crawl and can all be lost to one stall, where one at a time actually
        // produces confirmed evidence the worker can submit against.
        listOf(1, 64, 128, 399).forEach { kbps ->
            assertEquals("$kbps kbps", 1, EvidenceNetworkQuality.concurrencyFor(false, kbps))
        }
    }

    @Test
    fun `a modest uplink uploads two at a time`() {
        listOf(400, 1_000, 1_999).forEach { kbps ->
            assertEquals("$kbps kbps", 2, EvidenceNetworkQuality.concurrencyFor(false, kbps))
        }
    }

    @Test
    fun `a fast mobile uplink gets full concurrency`() {
        listOf(2_000, 10_000).forEach { kbps ->
            assertEquals(
                "$kbps kbps",
                EvidenceNetworkQuality.MAX_CONCURRENT_UPLOADS,
                EvidenceNetworkQuality.concurrencyFor(false, kbps),
            )
        }
    }

    @Test
    fun `an unreported or nonsense estimate never stalls the drain`() {
        // linkUpstreamBandwidthKbps is 0 when the radio does not report, and some
        // radios have been seen to report negatives. Returning 0 here would mean
        // chunked(0) and a drain that uploads nothing at all.
        listOf(0, -1, Int.MIN_VALUE).forEach { kbps ->
            val concurrency = EvidenceNetworkQuality.concurrencyFor(false, kbps)
            assertTrue("$kbps produced $concurrency", concurrency >= 1)
        }
    }

    @Test
    fun `concurrency is always within one and the maximum`() {
        (-5..5_000 step 7).forEach { kbps ->
            listOf(true, false).forEach { wifi ->
                val c = EvidenceNetworkQuality.concurrencyFor(wifi, kbps)
                assertTrue(
                    "wifi=$wifi kbps=$kbps produced $c",
                    c in 1..EvidenceNetworkQuality.MAX_CONCURRENT_UPLOADS,
                )
            }
        }
    }
}
