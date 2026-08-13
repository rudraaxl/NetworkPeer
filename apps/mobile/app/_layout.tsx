import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "@/lib/auth";

export default function RootLayout() {
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
