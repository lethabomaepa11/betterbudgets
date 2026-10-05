import { CameraView, useCameraPermissions } from "expo-camera";
import { Stack, useRouter } from "expo-router";
import { Button, Card, useThemeColor } from "heroui-native";
import { useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

export default function ScanScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const background = useThemeColor("background");
  const foreground = useThemeColor("foreground");

  if (!permission) {
    return <View style={[styles.center, { backgroundColor: background }]} />;
  }

  if (!permission.granted) {
    return (
      <View style={[styles.center, { backgroundColor: background }]}>
        <Stack.Screen options={{ title: "Scan transfer QR" }} />
        <Card style={styles.card}>
          <Text style={[styles.title, { color: foreground }]}>Camera access is needed</Text>
          <Text style={[styles.body, { color: foreground }]}>
            Allow camera access to scan a secure betterbudgets transfer link.
          </Text>
          <Button onPress={requestPermission}>Allow camera</Button>
          <Pressable onPress={() => router.back()}>
            <Text style={[styles.cancel, { color: foreground }]}>Cancel</Text>
          </Pressable>
        </Card>
      </View>
    );
  }

  return (
    <View style={styles.cameraContainer}>
      <Stack.Screen options={{ title: "Scan transfer QR" }} />
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={
          scanned
            ? undefined
            : ({ data }) => {
                setScanned(true);
                void Linking.openURL(data).catch(() => setScanned(false));
              }
        }
      />
      <View style={styles.overlay}>
        <View style={styles.scanWindow} />
        <Text style={styles.hint}>Point your camera at a betterbudgets QR code</Text>
        {scanned && (
          <Button onPress={() => setScanned(false)} variant="secondary">
            Scan again
          </Button>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cameraContainer: { flex: 1, backgroundColor: "#000" },
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  scanWindow: {
    width: 260,
    height: 260,
    borderWidth: 3,
    borderColor: "#fff",
    borderRadius: 24,
  },
  hint: { color: "#fff", fontSize: 16, textAlign: "center", paddingHorizontal: 32 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  card: { gap: 16, padding: 24, width: "100%" },
  title: { fontSize: 20, fontWeight: "700" },
  body: { fontSize: 15, lineHeight: 22 },
  cancel: { textAlign: "center", padding: 8 },
});
