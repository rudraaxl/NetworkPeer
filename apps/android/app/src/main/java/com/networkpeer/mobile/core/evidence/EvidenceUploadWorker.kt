package com.networkpeer.mobile.core.evidence

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.networkpeer.mobile.NetworkPeerApplication
import com.networkpeer.mobile.R

/**
 * Drains the durable evidence queue outside of any screen's lifetime.
 *
 * Before this existed there was no WorkManager in the module and no foreground
 * service: the only thing that ever re-drove a stalled upload was a
 * `LaunchedEffect(jobId)` on the task screen, so an upload interrupted by the
 * process dying resumed only if the worker happened to reopen that exact job. A
 * photo taken at a client site and then backgrounded was simply never sent.
 *
 * WorkManager persists the request in its own database, so the drain resumes after
 * the app is killed and after a reboot. It runs in the foreground while draining
 * because OEM builds routinely kill background work mid-request, and because a
 * worker uploading forty pages of a book deserves to see it happening.
 */
class EvidenceUploadWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

    private val container get() = (applicationContext as NetworkPeerApplication).container

    override suspend fun doWork(): Result {
        val queue = container.evidenceQueue
        if (!queue.hasRetryableWork()) return Result.success()

        // Promoting to the foreground can be refused -- no notification permission,
        // or the OS declining a background start. The drain is still worth attempting
        // in that case; it just loses the protection.
        runCatching { setForeground(foregroundInfo(queue.pendingCount())) }

        val outcome = try {
            queue.drain { remaining ->
                runCatching { setForegroundAsync(foregroundInfo(remaining)) }
            }
        } catch (failure: Throwable) {
            if (failure is kotlinx.coroutines.CancellationException) throw failure
            // The queue records per-item failures itself; anything escaping is a fault
            // in the drain rather than in one upload, so let WorkManager back off.
            return Result.retry()
        }

        // Items parked on a permanent failure are deliberately not retried here: they
        // need the worker to retake or retry by hand, and asking WorkManager to run
        // again would spin forever against a file that will never be accepted.
        return if (outcome.retryable > 0) Result.retry() else Result.success()
    }

    private fun foregroundInfo(remaining: Int): ForegroundInfo {
        ensureChannel(applicationContext)
        val text = if (remaining <= 0) {
            applicationContext.getString(R.string.evidence_upload_finishing)
        } else {
            applicationContext.resources.getQuantityString(
                R.plurals.evidence_upload_remaining,
                remaining,
                remaining,
            )
        }
        val notification = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(applicationContext.getString(R.string.evidence_upload_title))
            .setContentText(text)
            .setOngoing(true)
            .setSilent(true)
            .setProgress(0, 0, true)
            .build()
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(NOTIFICATION_ID, notification)
        }
    }

    companion object {
        const val UNIQUE_WORK_NAME = "networkpeer.evidence.upload"
        private const val CHANNEL_ID = "networkpeer_evidence_uploads"
        private const val NOTIFICATION_ID = 4711

        private fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val channel = NotificationChannel(
                CHANNEL_ID,
                context.getString(R.string.evidence_upload_channel_name),
                // Low: this is a progress indicator, not something to interrupt a
                // worker who is in the middle of photographing a page.
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = context.getString(R.string.evidence_upload_channel_description)
                setShowBadge(false)
            }
            context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }

        fun canPostForegroundNotification(context: Context): Boolean =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.POST_NOTIFICATIONS,
                ) == PackageManager.PERMISSION_GRANTED
    }
}

/**
 * The single place that asks for a drain. Callers do not need to know whether one
 * is already queued -- APPEND_OR_REPLACE keeps exactly one chain alive, so a worker
 * taking thirty photos in a minute does not create thirty competing drains.
 */
object EvidenceUploadScheduler {
    fun schedule(context: Context) {
        val request = OneTimeWorkRequestBuilder<EvidenceUploadWorker>()
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build(),
            )
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            EvidenceUploadWorker.UNIQUE_WORK_NAME,
            // Keeping an existing chain would drop a newly captured photo's kick if a
            // drain were already running; replacing outright would cancel a drain
            // mid-upload. Appending runs the new pass after the current one settles.
            ExistingWorkPolicy.APPEND_OR_REPLACE,
            request,
        )
    }
}
