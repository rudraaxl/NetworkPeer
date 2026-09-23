package com.networkpeer.mobile.core.model

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Guards the correctionist review queue against the defect that kept it from
 * ever loading.
 *
 * The API sends snake_case and the Kotlin model declared camelCase with no
 * @SerialName. Because the client's Json sets `ignoreUnknownKeys = true`, the
 * incoming keys were discarded rather than rejected, and decoding then threw on
 * the fields that had no default. The screen caught that and showed an empty
 * queue, so a guaranteed failure looked like "no work to review".
 *
 * The payloads below are copied from the handlers that produce them --
 * `presentSubmission` in routes/worker-jobs.ts and the submissions projection
 * in routes/client-jobs.ts -- rather than from the older contract types, which
 * is the distinction the original model got wrong.
 */
class ReviewQueueDecodingTest {
    // Matches NetworkPeerClient's configuration, including the setting that
    // turned a schema mismatch into a silent one.
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    @Test
    fun `review queue item decodes the payload the worker route actually sends`() {
        val response = json.decodeFromString<ReviewQueueResponse>(
            """
            {
              "submissions": [{
                "id": "0d5f1f6e-6b3a-4a0e-9a7c-1f2b3c4d5e6f",
                "job_id": "642509d5-5f80-4f54-8dbe-79a1ab9de0c2",
                "subtask_id": "9c8b7a65-4321-4f0e-8d9c-0a1b2c3d4e5f",
                "worker_id": "3f2e1d0c-9b8a-4756-8493-2a1b0c9d8e7f",
                "media_type": "IMAGE",
                "mime_type": "image/jpeg",
                "file_size_bytes": 248193,
                "captured_at": "2026-09-24T08:14:02.000Z",
                "uploaded_at": "2026-09-24T08:14:09.512Z",
                "status": "UPLOADED",
                "verification_notes": null,
                "ocr_status": "unavailable",
                "media": {
                  "url": "https://s3.example.invalid/evidence.jpg?X-Amz-Signature=redacted",
                  "expires_at": "2026-09-24T09:14:09.512Z"
                }
              }]
            }
            """.trimIndent(),
        )

        val item = response.submissions.single()
        assertEquals("0d5f1f6e-6b3a-4a0e-9a7c-1f2b3c4d5e6f", item.id)
        assertEquals("642509d5-5f80-4f54-8dbe-79a1ab9de0c2", item.jobId)
        assertEquals(MediaType.IMAGE, item.mediaType)
        assertEquals(248193L, item.fileSizeBytes)
        assertEquals("2026-09-24T08:14:02.000Z", item.capturedAt)
        assertTrue(item.media?.url?.startsWith("https://") == true)
    }

    @Test
    fun `an unavailable ocr_status never reads as a finished extraction`() {
        val item = json.decodeFromString<ReviewQueueItem>(
            """{"id": "a", "ocr_status": "unavailable"}""",
        )
        assertEquals(OcrStatus.UNAVAILABLE, item.ocrStatus)
        // Nothing to display, and nothing invented to fill the gap.
        assertNull(item.ocrResult)
    }

    @Test
    fun `a missing or unrecognised ocr_status is not treated as ready`() {
        // The previous model defaulted ocrStatus to "ready", so an absent field
        // asserted that extraction had succeeded.
        assertEquals(
            OcrStatus.UNAVAILABLE,
            json.decodeFromString<ReviewQueueItem>("""{"id": "a"}""").ocrStatus,
        )
        assertEquals(
            OcrStatus.UNAVAILABLE,
            json.decodeFromString<ReviewQueueItem>("""{"id": "a", "ocr_status": "queued"}""").ocrStatus,
        )
    }

    @Test
    fun `ocr status maps every value the contract defines`() {
        assertEquals(OcrStatus.READY, OcrStatus.from("ready"))
        assertEquals(OcrStatus.PROCESSING, OcrStatus.from("processing"))
        assertEquals(OcrStatus.FAILED, OcrStatus.from("failed"))
        assertEquals(OcrStatus.UNAVAILABLE, OcrStatus.from(null))
    }

    @Test
    fun `an ocr result carries only what the server sent`() {
        // The model used to default confidence to 0.98 and detectedScript to
        // "bilingual", so a real result missing those fields would have been
        // reported as 98% confident and bilingual on no evidence.
        val result = json.decodeFromString<OCRResult>("""{"text": "SHOP NO 14"}""")
        assertEquals("SHOP NO 14", result.text)
        assertNull(result.confidence)
        assertNull(result.language)
        assertNull(result.engineVersion)
    }

    @Test
    fun `the development otp is read from the field the API actually sends`() {
        // Declared as `otp` with no @SerialName, this never decoded, so the
        // convenience it exists to provide was unavailable to testers.
        val result = json.decodeFromString<OtpRequestResult>(
            """
            {
              "challenge_id": "chn_9f8e7d6c5b4a39281706",
              "expires_in_seconds": 600,
              "otp_length": 6,
              "delivery": {"transport": "email"},
              "development_otp": "418209"
            }
            """.trimIndent(),
        )
        assertEquals("chn_9f8e7d6c5b4a39281706", result.challengeId)
        assertEquals(600, result.expiresInSeconds)
        assertEquals(6, result.otpLength)
        assertEquals("418209", result.developmentOtp)
    }

    @Test
    fun `production omits the development otp`() {
        val result = json.decodeFromString<OtpRequestResult>(
            """{"challenge_id": "chn_abc", "expires_in_seconds": 600, "otp_length": 6}""",
        )
        assertNull(result.developmentOtp)
    }
}
