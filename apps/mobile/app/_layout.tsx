import { useEffect } from "react";
import { AppState } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "@/lib/auth";
import { flushPendingEvidence } from "@/lib/evidenceQueue";

function useEvidenceAutoFlush() {
  useEffect(() => {
    let active = true;

    const flush = () => {
      if (!active) return;
      flushPendingEvidence().catch(() => undefined);
    };

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") flush();
    });

    flush();
    const interval = setInterval(flush, 20_000);

    return () => {
      active = false;
      subscription.remove();
      clearInterval(interval);
    };
  }, []);
}

export default function RootLayout() {
  useEvidenceAutoFlush();

  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="welcome" />
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="job/[jobId]" options={{ headerShown: true, title: "Job details" }} />
        <Stack.Screen name="task/[jobId]" options={{ headerShown: true, title: "Task execution" }} />
      </Stack>
    </AuthProvider>
  );
}