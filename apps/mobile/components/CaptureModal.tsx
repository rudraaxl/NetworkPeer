import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useAudioRecorder, useAudioRecorderState, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync } from "expo-audio";
import * as Application from "expo-application";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import Constants from "expo-constants";
import { getCurrentLocation } from "@/lib/location";
import { api } from "@/lib/api";

type CaptureModalProps = {
  visible: boolean;
  jobId: string;
  subtaskId: string;
  mediaType: "IMAGE" | "VIDEO" | "AUDIO";
  onDone: (staged: { localId: string; localUri: string; uploaded: boolean; mediaId?: string }) => void;
  onCancel: () => void;
};

const APP_VERSION = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "unknown";

async function getDeviceId(): Promise<string> {
  try {
    const androidId = Application.getAndroidId();
    if (androidId) return androidId;
    const iosId = await Application.getIosIdForVendorAsync();
    return iosId ?? "device";
  } catch {
    return "device";
  }
}

function randomId(subtaskId: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${subtaskId.slice(0, 8)}-${Date.now().toString(36)}-${rand}`;
}

function mimeFor(mediaType: "IMAGE" | "VIDEO" | "AUDIO", uri: string): string {
  const ext = uri.split(".").pop()?.toLowerCase();
  if (mediaType === "IMAGE") return "image/jpeg";
  if (mediaType === "VIDEO") return ext === "webm" ? "video/webm" : "video/mp4";
  if (mediaType === "AUDIO") return ext === "wav" ? "audio/wav" : "audio/mp4";
  return "image/jpeg";
}

async function sha256Hex(uri: string): Promise<string> {
  const data = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, data);
}

export default function CaptureModal({ visible, jobId, subtaskId, mediaType, onDone, onCancel }: CaptureModalProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (visible && !permission?.granted && !permission?.canAskAgain) {
      setCameraError("Camera access is turned off. Enable it in your device settings.");
    }
  }, [visible, permission]);

  const startCameraFlow = useCallback(async () => {
    if (permission?.granted) return;
    const result = await requestPermission();
    if (!result.granted) {
      setCameraError("Camera access is required to capture evidence.");
    }
  }, [permission, requestPermission]);

  useEffect(() => {
    if (visible) {
      setCameraReady(false);
      setCameraError(null);
      setRecording(false);
      if (mediaType !== "AUDIO") {
        startCameraFlow();
      }
      if (mediaType === "AUDIO") {
        setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true }).catch(() => {});
      }
    }
  }, [visible, mediaType, startCameraFlow]);

  const ensureLocation = useCallback(async () => {
    try {
      const location = await getCurrentLocation();
      if (!location) {
        Alert.alert("Location required", "NetworkPeers attaches GPS to every capture. Allow location access to continue.");
        return null;
      }
      return location;
    } catch {
      Alert.alert("Location unavailable", "We couldn't read your GPS position. Check that location services are on, then try again.");
      return null;
    }
  }, []);

  async function finalize(localUri: string, capturedAt: string) {
    const location = await ensureLocation();
    if (!location) {
      setBusy(false);
      return;
    }

    setBusy(true);
    try {
      const info = await FileSystem.getInfoAsync(localUri);
      if (!info.exists) {
        Alert.alert("Capture failed", "The captured file could not be read.");
        setBusy(false);
        return;
      }
      const size = typeof info.size === "number" ? info.size : 0;
      const checksum = await sha256Hex(localUri);
      const mimeType = mimeFor(mediaType, localUri);

      const reservation = await api.reserveEvidenceUpload({
        jobId,
        subtaskId,
        mediaType,
        mimeType,
        fileSizeBytes: size,
        capturedAt,
        location: { type: "Point", coordinates: [location.longitude, location.latitude] },
        checksumSha256: checksum,
        idempotencyKey: randomId(subtaskId),
      });

      if (reservation.upload) {
        const form = new FormData();
        for (const [name, value] of Object.entries(reservation.upload.fields)) {
          form.append(name, value);
        }
        form.append("file", {
          uri: localUri,
          name: localUri.split("/").pop() ?? "evidence",
          type: mimeType,
        } as unknown as Blob);
        const uploadResponse = await fetch(reservation.upload.url, { method: "POST", body: form });
        if (!uploadResponse.ok) {
          throw new Error(`Upload rejected (${uploadResponse.status})`);
        }
      }

      const confirmed = await api.confirmEvidence(reservation.evidence.id);
      if (mountedRef.current) {
        onDone({ localId: reservation.evidence.id, localUri, uploaded: true, mediaId: confirmed.id });
      }
    } catch (e) {
      if (mountedRef.current) {
        Alert.alert("Upload failed", e instanceof Error ? e.message : "Evidence could not be uploaded. It will stay staged locally.");
        onDone({ localId: "", localUri, uploaded: false });
      }
    } finally {
      setBusy(false);
    }
  }

  async function takePhoto() {
    if (!cameraRef.current || !cameraReady) {
      Alert.alert("Camera not ready", "The camera is still starting. Wait a moment and try again.");
      return;
    }
    setBusy(true);
    try {
      const photo = await cameraRef.current.takePictureAsync();
      if (photo?.uri) {
        await finalize(photo.uri, new Date().toISOString());
      } else {
        setBusy(false);
        Alert.alert("Capture failed", "No photo was returned. Try again.");
      }
    } catch (e) {
      setBusy(false);
      Alert.alert("Capture failed", e instanceof Error && e.message ? e.message : "The camera could not take a photo. Try again.");
    }
  }

  async function startRecording() {
    if (mediaType === "AUDIO") {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        Alert.alert("Microphone access required", "Allow microphone access to record audio evidence.");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true }).catch(() => {});
      try {
        await audioRecorder.prepareToRecordAsync();
        audioRecorder.record();
        setRecording(true);
      } catch (e) {
        Alert.alert("Recording failed", e instanceof Error && e.message ? e.message : "Could not start audio recording. Try again.");
      }
    } else if (mediaType === "VIDEO") {
      if (!cameraRef.current || !cameraReady) {
        Alert.alert("Camera not ready", "The camera is still starting. Wait a moment and try again.");
        return;
      }
      try {
        setRecording(true);
        const video = await cameraRef.current.recordAsync({ maxDuration: 120 });
        if (video?.uri) {
          await finalize(video.uri, new Date().toISOString());
        } else {
          setBusy(false);
          Alert.alert("Recording failed", "No video was returned. Try again.");
        }
      } catch (e) {
        Alert.alert("Recording failed", e instanceof Error && e.message ? e.message : "Could not record video. Try again.");
      } finally {
        setRecording(false);
      }
    }
  }

  async function stopRecording() {
    if (mediaType === "AUDIO") {
      try {
        await audioRecorder.stop();
      } catch {
        // recorder may already be stopped
      }
      setRecording(false);
      const uri = audioRecorder.uri ?? recorderState.url;
      if (uri) {
        await finalize(uri, new Date().toISOString());
      } else {
        Alert.alert("Recording failed", "No audio file was produced. Try again.");
      }
    } else if (mediaType === "VIDEO") {
      try {
        cameraRef.current?.stopRecording();
      } catch {
        // handled by recordAsync's catch
      }
    }
  }

  function cancel() {
    if (mediaType === "AUDIO" && (recorderState?.isRecording || audioRecorder.isRecording)) {
      audioRecorder.stop().catch(() => {});
    } else if (mediaType === "VIDEO") {
      try {
        cameraRef.current?.stopRecording();
      } catch {
        // ignore
      }
    }
    setRecording(false);
    onCancel();
  }

  const isMedia = mediaType === "IMAGE" || mediaType === "VIDEO";
  const showSpinner = busy || (isMedia && visible && !cameraReady && !cameraError && permission?.granted);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={cancel}>
      <View style={styles.container}>
        {isMedia && (
          <CameraView
            key={visible ? "camera-on" : "camera-off"}
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
            mode={mediaType === "VIDEO" ? "video" : "picture"}
            onCameraReady={() => setCameraReady(true)}
            onMountError={(error) => {
              setCameraError(error.message ?? "Camera failed to start");
              setCameraReady(false);
            }}
          />
        )}

        {mediaType === "AUDIO" && (
          <View style={styles.audioScreen}>
            <Text style={styles.audioTitle}>Recording audio evidence</Text>
            <Text style={styles.audioHint}>State the job reference, date and location in your note.</Text>
            {recording && <View style={styles.recDot} />}
          </View>
        )}

        {cameraError && (
          <View style={styles.errorOverlay}>
            <Text style={styles.errorTitle}>Camera unavailable</Text>
            <Text style={styles.errorText}>{cameraError}</Text>
            <Pressable style={styles.errorRetry} onPress={cancel}>
              <Text style={styles.errorRetryText}>Close</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.overlay}>
          {recording && (
            <View style={styles.recBadge}>
              <View style={styles.recBadgeDot} />
              <Text style={styles.recBadgeText}>REC</Text>
            </View>
          )}

          {showSpinner && <ActivityIndicator size="large" color="#fff" style={styles.busy} />}

          {!cameraError && (
            <View style={styles.controls}>
              {mediaType === "IMAGE" && (
                <Pressable style={[styles.shutter, (busy || !cameraReady) && styles.disabled]} onPress={takePhoto} disabled={busy || !cameraReady} />
              )}
              {mediaType !== "IMAGE" && (
                <Pressable
                  style={[styles.recordButton, recording && styles.recording, (busy || (!cameraReady && isMedia)) && styles.disabled]}
                  onPress={recording ? stopRecording : startRecording}
                  disabled={busy || (!cameraReady && isMedia)}
                >
                  <Text style={styles.recordText}>{recording ? "Stop" : mediaType === "VIDEO" ? "Start video" : "Record"}</Text>
                </Pressable>
              )}
            </View>
          )}

          <Pressable style={styles.cancelButton} onPress={cancel} disabled={busy}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  audioScreen: { flex: 1, alignItems: "center", justifyContent: "center" },
  audioTitle: { color: "#fff", fontSize: 20, fontWeight: "800" },
  audioHint: { color: "#CBD5E1", fontSize: 14, marginTop: 8, textAlign: "center", paddingHorizontal: 32 },
  recDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: "#EF4444", marginTop: 20 },
  overlay: { position: "absolute", bottom: 40, left: 0, right: 0, alignItems: "center" },
  recBadge: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(239,68,68,0.9)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, marginBottom: 16 },
  recBadgeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff", marginRight: 6 },
  recBadgeText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  busy: { position: "absolute", top: -60 },
  controls: { alignItems: "center" },
  shutter: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#fff", borderWidth: 6, borderColor: "rgba(255,255,255,0.4)" },
  recordButton: { backgroundColor: "#EF4444", paddingHorizontal: 28, paddingVertical: 14, borderRadius: 30 },
  recording: { backgroundColor: "#B91C1C" },
  recordText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  disabled: { opacity: 0.5 },
  cancelButton: { marginTop: 24, paddingVertical: 10, paddingHorizontal: 24 },
  cancelText: { color: "#CBD5E1", fontSize: 14 },
  errorOverlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  errorTitle: { color: "#fff", fontSize: 18, fontWeight: "800" },
  errorText: { color: "#CBD5E1", fontSize: 14, marginTop: 8, textAlign: "center" },
  errorRetry: { backgroundColor: "#7C3AED", borderRadius: 12, paddingHorizontal: 28, paddingVertical: 12, marginTop: 20 },
  errorRetryText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
