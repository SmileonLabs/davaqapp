import { useAuth } from "@/lib/davaqAuth";
import { Redirect, Slot } from "expo-router";
import { ActivityIndicator, View } from "react-native";

export default function AdminLayout() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color="#8B5CF6" />
      </View>
    );
  }

  if (!isSignedIn) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return <Slot />;
}
