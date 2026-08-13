import * as Location from "expo-location";

export type DeviceLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters: number | undefined;
};

export async function ensureLocationPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === "granted";
}

export async function getCurrentLocation(): Promise<DeviceLocation | null> {
  const permitted = await ensureLocationPermission();
  if (!permitted) return null;
  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyMeters: position.coords.accuracy ?? undefined,
    };
  } catch {
    return null;
  }
}
