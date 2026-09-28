import * as React from "react";
import { Linking, Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
  type BarcodeType,
} from "expo-camera";
import { Camera, X } from "lucide-react-native";

import { Button, Text } from "@/components/ui";

/**
 * The camera half of "scan or type the seal" — decision 11. The web app
 * only ever had the typing half (its TODO sits above the seal Input), so
 * this has no web twin; it hands a string to the same Input the driver
 * could have typed into and gets out of the way.
 *
 * FIRST HIT WINS. The scanner fires on every frame the code is in view,
 * a dozen times a second, and each one would otherwise fill the input and
 * close the sheet again. A ref, not state: the guard has to hold between
 * two events in the same frame, before React has re-rendered.
 *
 * The seal id stays an opaque string either way. Whatever the barcode
 * decodes to is what gets checked; the server is the one that knows
 * whether it matches, and it says so in a sentence the step shows verbatim.
 */
export const SEAL_BARCODE_TYPES: readonly BarcodeType[] = [
  "qr",
  "code128",
  "code39",
  "ean13",
  "datamatrix",
  "pdf417",
];

export interface SealScannerProps {
  visible: boolean;
  /** The decoded value, trimmed. Called at most once per opening. */
  onScanned: (value: string) => void;
  onClose: () => void;
  testID?: string;
}

export function SealScanner({
  visible,
  onScanned,
  onClose,
  testID = "seal-scanner",
}: SealScannerProps) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const handled = React.useRef(false);

  React.useEffect(() => {
    if (visible) handled.current = false;
  }, [visible]);

  const onBarcode = React.useCallback(
    (result: BarcodeScanningResult) => {
      if (handled.current) return;
      const value = result.data.trim();
      if (!value) return;
      handled.current = true;
      onScanned(value);
    },
    [onScanned],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      {permission?.granted ? (
        <View className="flex-1 bg-black" testID={testID}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: [...SEAL_BARCODE_TYPES] }}
            onBarcodeScanned={onBarcode}
          />
          {/* Chrome over the preview, not inside CameraView: its children
              are not reliably laid out on Android. */}
          <View
            pointerEvents="box-none"
            className="absolute inset-0"
            style={{ paddingTop: insets.top }}
          >
            <View className="flex-row items-center justify-between px-4 py-2">
              <Text weight="semibold" className="text-base text-white">
                Scan a seal
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                testID={`${testID}-close`}
                onPress={onClose}
                className="h-10 w-10 items-center justify-center rounded-full bg-black/50 active:opacity-80"
              >
                <X size={20} color="#ffffff" />
              </Pressable>
            </View>
            <View className="flex-1 items-center justify-center">
              <View className="h-40 w-64 rounded-xl border-2 border-white/80" />
            </View>
            <View
              className="gap-3 rounded-t-2xl bg-background px-4 pt-4"
              style={{ paddingBottom: Math.max(insets.bottom, 16) }}
            >
              <Text className="text-sm text-muted-foreground">
                Point the camera at the barcode on the seal. It fills in the seal id for
                you.
              </Text>
              <Button variant="outline" testID={`${testID}-type`} onPress={onClose}>
                Type it instead
              </Button>
            </View>
          </View>
        </View>
      ) : (
        <View
          className="flex-1 justify-center gap-4 bg-background px-4"
          style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
          testID={`${testID}-permission`}
        >
          <View className="items-center">
            <Camera size={32} color="#58687e" />
          </View>
          {permission === null ? (
            <Text className="text-center text-sm text-muted-foreground">
              Checking camera access…
            </Text>
          ) : permission.canAskAgain ? (
            <>
              <Text weight="semibold" className="text-center text-base text-navy-800">
                Camera access
              </Text>
              <Text className="text-center text-sm text-muted-foreground">
                Koolee uses the camera to read the barcode on a seal. You can always type
                the id instead.
              </Text>
              <Button
                size="lg"
                testID={`${testID}-allow`}
                onPress={() => void requestPermission()}
              >
                Allow camera
              </Button>
            </>
          ) : (
            <>
              <Text weight="semibold" className="text-center text-base text-navy-800">
                Camera is off
              </Text>
              <Text className="text-center text-sm text-muted-foreground">
                Allow camera access in Settings to scan a seal.
              </Text>
              <Button
                size="lg"
                variant="secondary"
                testID={`${testID}-settings`}
                onPress={() => void Linking.openSettings()}
              >
                Open Settings
              </Button>
            </>
          )}
          <Button variant="outline" testID={`${testID}-close`} onPress={onClose}>
            Type it instead
          </Button>
        </View>
      )}
    </Modal>
  );
}
