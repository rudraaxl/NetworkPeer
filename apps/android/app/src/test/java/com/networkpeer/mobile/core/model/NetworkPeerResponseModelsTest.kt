package com.networkpeer.mobile.core.model

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class NetworkPeerResponseModelsTest {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    @Test
    fun `notification page preserves server cursor and read state`() {
        val page = json.decodeFromString<NotificationPage>(
            """
            {
              "items": [{
                "id": "7a1592f2-1aa1-4e59-a29d-2c9d5b91ec4b",
                "cursor": "922337203685477580",
                "topic": "JOB_STATUS_CHANGED",
                "title": "Job updated",
                "body": "Your job is in progress.",
                "data": {"job_id": "642509d5-5f80-4f54-8dbe-79a1ab9de0c2"},
                "read_at": null,
                "created_at": "2026-08-23T12:00:00.000Z"
              }],
              "has_more": false,
              "next_cursor": null
            }
            """.trimIndent(),
        )

        assertEquals("922337203685477580", page.items.single().cursor)
        assertNull(page.items.single().read_at)
        assertNull(page.next_cursor)
    }

    @Test
    fun `client evidence review parses the api issued download target`() {
        val response = json.decodeFromString<ClientEvidenceReviewResponse>(
            """
            {
              "evidence": [{
                "id": "8b3a92be-ccf9-4de4-a0e5-ae7494eeb1b1",
                "job_id": "642509d5-5f80-4f54-8dbe-79a1ab9de0c2",
                "subtask_id": "ce76cbcd-6c48-4701-b5b4-a26135ce58bf",
                "media_type": "IMAGE",
                "mime_type": "image/jpeg",
                "file_size_bytes": 42,
                "captured_at": "2026-08-23T12:00:00.000Z",
                "uploaded_at": "2026-08-23T12:01:00.000Z",
                "status": "UPLOADED",
                "download": {
                  "url": "https://example.invalid/evidence",
                  "expires_at": "2026-08-23T12:16:00.000Z"
                }
              }]
            }
            """.trimIndent(),
        )

        assertEquals(MediaType.IMAGE, response.evidence.single().media_type)
        assertEquals("https://example.invalid/evidence", response.evidence.single().download.url)
    }

    @Test
    fun `otp requests use the Cognito challenge wire format`() {
        val result = json.decodeFromString<OtpRequestResult>(
            """
            {
              "challenge_id": "cognito-challenge",
              "expires_in_seconds": 600,
              "otp_length": 6,
              "delivery": {"transport": "sms", "to": "+15551234567"}
            }
            """.trimIndent(),
        )

        assertEquals("cognito-challenge", result.challengeId)
        assertEquals(600, result.expiresInSeconds)
        assertEquals(6, result.otpLength)
        // `delivery` is nullable on the model, so assert it is present before
        // reading it: a missing object should fail as a missing object rather
        // than as a null-pointer somewhere further down.
        val delivery = result.delivery
        assertNotNull("delivery should be parsed from the response", delivery)
        assertEquals("sms", delivery!!.transport)
        assertEquals("+15551234567", delivery.to)
    }
}
