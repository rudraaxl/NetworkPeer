import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "@/lib/auth";

export default function Index() {
  const { worker, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color="#7C3AED" />
      </View>
    );
  }

  if (!worker) {
    return <Redirect href="/welcome" />;
  }

  return <Redirect href="/(tabs)" />;
}
