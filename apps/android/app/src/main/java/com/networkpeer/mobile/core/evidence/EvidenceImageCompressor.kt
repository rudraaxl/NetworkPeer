package com.networkpeer.mobile.core.evidence

import android.content.ContentResolver
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.File

/**
 * Shrinks a captured photograph before it is uploaded.
 *
 * Workers on this platform are in the field on mobile data, and the photographs
 * were being sent at whatever resolution the camera produced -- 3 to 12 MB each.
 * QualityCheckEngine downsamples to 640px to analyse the frame, but that is a
 * throwaway bitmap; the file itself was never touched, so the full-resolution
 * original is what went to S3.
 *
 * At a realistic rural uplink of ~150 kbps a 5 MB page takes about four and a
 * half minutes. Forty pages of a book is therefore closer to three hours than to
 * the fifteen minutes it should be, and it costs the worker roughly 200 MB of
 * their own data for one job. A page of text is fully legible -- to a reader and
 * to OCR -- at 2048px on the long edge, which lands around 300-500 KB. That is
 * the whole difference between this being usable in the field and not.
 *
 * WHY THIS RUNS BEFORE inspect(). The reservation carries file_size_bytes and
 * checksum_sha256, and the API re-checks the stored object's length against them
 * on confirmation. So the bytes have to be final before they are measured: the
 * queue compresses first, then inspects whatever it is actually going to send.
 *
 * ON EXIF. BitmapFactory does not apply EXIF orientation, so a decode-and-
 * re-encode without handling it would silently rotate every photograph taken in
 * anything but the sensor's native orientation. The rotation is baked into the
 * pixels here and the re-encoded file carries no EXIF at all. Nothing depends on
 * that metadata -- capture time and location travel in the reservation, and
 * integrity is established by the SHA-256 and S3's own version id, not by tags
 * inside the file -- and dropping it avoids shipping incidental camera and
 * location data to the client as a side effect.
 */
object EvidenceImageCompressor {
    /** Long edge, in pixels. ~150 DPI across an A5 page: comfortably readable. */
    const val MAX_LONG_EDGE_PX = 2048

    const val JPEG_QUALITY = 80

    /**
     * Below this, the round trip through a bitmap is not worth the CPU, the
     * battery, or the risk of making the file bigger than it started.
     */
    const val MIN_BYTES_WORTH_COMPRESSING = 400L * 1024L

    private val COMPRESSIBLE = setOf("image/jpeg", "image/png", "image/webp")

    fun isCompressible(mimeType: String?): Boolean = mimeType?.lowercase() in COMPRESSIBLE

    /**
     * Returns a new app-owned URI holding the smaller image, or null when the
     * original should be sent as it is -- not an image, already small, or the
     * re-encode came out no better.
     *
     * Never throws: a failure to compress is not a failure to upload. The caller
     * falls back to the original file, which is exactly the previous behaviour.
     */
    fun compress(context: Context, resolver: ContentResolver, uri: Uri): Uri? = try {
        compressOrThrow(context, resolver, uri)
    } catch (_: Throwable) {
        // Includes OutOfMemoryError: a phone too tight on memory to re-encode
        // should still be able to send the photograph.
        null
    }

    private fun compressOrThrow(context: Context, resolver: ContentResolver, uri: Uri): Uri? {
        val mimeType = resolver.getType(uri)?.lowercase()
        if (!isCompressible(mimeType)) return null

        val originalBytes = sizeOf(resolver, uri)
        val bounds = readBounds(resolver, uri) ?: return null
        val longEdge = maxOf(bounds.first, bounds.second)
        // Already small in both bytes and pixels: leave it alone.
        if (originalBytes in 1 until MIN_BYTES_WORTH_COMPRESSING && longEdge <= MAX_LONG_EDGE_PX) {
            return null
        }

        val decoded = decodeDownsampled(resolver, uri, longEdge) ?: return null
        val oriented = try {
            applyExifRotation(resolver, uri, decoded)
        } catch (failure: Throwable) {
            decoded.recycle()
            throw failure
        }
        val scaled = try {
            scaleToLongEdge(oriented)
        } catch (failure: Throwable) {
            oriented.recycle()
            throw failure
        }

        val target = File(File(context.filesDir, "evidence").apply { mkdirs() }, "compressed-${System.nanoTime()}.jpg")
        try {
            target.outputStream().use { out ->
                if (!scaled.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)) {
                    throw IllegalStateException("JPEG encode failed")
                }
            }
        } finally {
            scaled.recycle()
        }

        // A re-encode that did not actually help is not worth substituting: the
        // original is at least the file the quality check ran against.
        if (originalBytes > 0 && target.length() >= originalBytes) {
            target.delete()
            return null
        }
        if (target.length() <= 0) {
            target.delete()
            return null
        }
        return FileProvider.getUriForFile(context, "${context.packageName}.evidence", target)
    }

    private fun sizeOf(resolver: ContentResolver, uri: Uri): Long =
        try {
            resolver.openAssetFileDescriptor(uri, "r")?.use { it.length }?.takeIf { it > 0 } ?: -1L
        } catch (_: Throwable) {
            -1L
        }

    private fun readBounds(resolver: ContentResolver, uri: Uri): Pair<Int, Int>? {
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) } ?: return null
        if (options.outWidth <= 0 || options.outHeight <= 0) return null
        return options.outWidth to options.outHeight
    }

    /**
     * Decoding at full size then scaling would allocate the entire camera bitmap
     * -- around 48 MB for a 12 MP frame at ARGB_8888 -- so inSampleSize gets it
     * close first. The power-of-two step can leave it up to 2x the target, which
     * scaleToLongEdge then trims exactly.
     */
    private fun decodeDownsampled(resolver: ContentResolver, uri: Uri, longEdge: Int): Bitmap? {
        var sample = 1
        while (longEdge / (sample * 2) >= MAX_LONG_EDGE_PX) sample *= 2
        val options = BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        return resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
    }

    private fun applyExifRotation(resolver: ContentResolver, uri: Uri, bitmap: Bitmap): Bitmap {
        val orientation = try {
            resolver.openInputStream(uri)?.use { stream ->
                ExifInterface(stream).getAttributeInt(
                    ExifInterface.TAG_ORIENTATION,
                    ExifInterface.ORIENTATION_NORMAL,
                )
            } ?: ExifInterface.ORIENTATION_NORMAL
        } catch (_: Throwable) {
            ExifInterface.ORIENTATION_NORMAL
        }

        val matrix = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.postRotate(90f); matrix.postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.postRotate(270f); matrix.postScale(-1f, 1f) }
            else -> return bitmap
        }
        val rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        if (rotated !== bitmap) bitmap.recycle()
        return rotated
    }

    private fun scaleToLongEdge(bitmap: Bitmap): Bitmap {
        val longEdge = maxOf(bitmap.width, bitmap.height)
        if (longEdge <= MAX_LONG_EDGE_PX) return bitmap
        val ratio = MAX_LONG_EDGE_PX.toDouble() / longEdge
        val width = (bitmap.width * ratio).toInt().coerceAtLeast(1)
        val height = (bitmap.height * ratio).toInt().coerceAtLeast(1)
        val scaled = Bitmap.createScaledBitmap(bitmap, width, height, true)
        if (scaled !== bitmap) bitmap.recycle()
        return scaled
    }
}
