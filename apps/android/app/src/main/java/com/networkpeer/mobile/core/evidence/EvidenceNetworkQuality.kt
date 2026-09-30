package com.networkpeer.mobile.core.evidence

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities

/**
 * How many evidence uploads it is sensible to have in flight at once.
 *
 * Three concurrent uploads is right on a decent connection and actively harmful
 * on a bad one: they share the same narrow uplink, so each crawls, each is
 * exposed to the call timeout for longer, and a stall can lose all three at once
 * rather than one. One at a time on a slow link means individual photographs
 * finish and get confirmed, which is what the worker actually needs -- confirmed
 * evidence is what lets them submit, and partial progress across three files
 * gets them nothing.
 *
 * linkUpstreamBandwidthKbps is a coarse hint from the radio about the class of
 * connection, not measured throughput, and it can be absent or optimistic. It is
 * used only to pick between 1, 2 and 3, where being wrong costs a little
 * throughput rather than correctness, and every branch falls back to a value
 * that works.
 */
object EvidenceNetworkQuality {
    const val MAX_CONCURRENT_UPLOADS = 3

    /** Below this the link cannot usefully carry more than one upload at a time. */
    private const val SLOW_UPSTREAM_KBPS = 400

    /** Below this, two is a reasonable compromise. */
    private const val MODEST_UPSTREAM_KBPS = 2_000

    /** Used when the connection cannot be read or reports nothing usable. */
    private const val FALLBACK = 2

    fun suggestedConcurrency(context: Context): Int {
        val capabilities = try {
            val manager = context.getSystemService(ConnectivityManager::class.java) ?: return FALLBACK
            manager.getNetworkCapabilities(manager.activeNetwork) ?: return FALLBACK
        } catch (_: Throwable) {
            return FALLBACK
        }
        // Wi-Fi and ethernet: the radio's own estimate is unreliable here and the
        // link is rarely the constraint.
        val highCapacity = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
        return concurrencyFor(highCapacity, capabilities.linkUpstreamBandwidthKbps)
    }

    /**
     * Split out from the Context lookup so the thresholds can be tested directly.
     * upstreamKbps arrives straight from the platform, so it has to tolerate 0
     * (not reported) and negative values (seen from some radios) without ever
     * returning a concurrency below 1 -- a zero would stall the drain entirely.
     */
    fun concurrencyFor(highCapacityTransport: Boolean, upstreamKbps: Int): Int = when {
        highCapacityTransport -> MAX_CONCURRENT_UPLOADS
        // Not reported, or nonsense. Assume a worker on mobile data in the field
        // rather than the best case: two keeps the pipe busy without gambling
        // three photographs on one narrow uplink.
        upstreamKbps <= 0 -> FALLBACK
        upstreamKbps < SLOW_UPSTREAM_KBPS -> 1
        upstreamKbps < MODEST_UPSTREAM_KBPS -> 2
        else -> MAX_CONCURRENT_UPLOADS
    }
}
