import * as React from "react";
import { Image, Modal, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { emulatorHost } from "@/lib/emulator-host";

import { Button } from "./button";
import { Text } from "./text";

export interface ImageLightboxProps {
  /** Full-size source. Signed URLs and local file URIs are both fine. */
  src: string;
  /** Describes the photo for a screen reader AND names the dialog. */
  alt: string;
  /** Dialog heading. Falls back to `alt`. */
  title?: string;
  /** Optional line under the heading — seal id, weight, who took it. */
  description?: string;
  /** Sizing for the thumbnail lives with the caller, e.g. "h-48 w-48". */
  className?: string;
  /** The thumbnail; the close button gets `${testID}-close`. */
  testID?: string;
}

/**
 * A photo thumbnail that opens full-size — packages/ui ImageLightbox.
 *
 * Evidence photos are captured at ~1600px and shown here at 192px, so the
 * detail that makes them evidence — the seal number, a scuff, a broken zip —
 * is in the file and invisible on screen until it is opened. The driver needs
 * this to confirm their own capture is not a blurred thumb over the lens.
 */
export function ImageLightbox({
  src,
  alt,
  title,
  description,
  className,
  testID = "image-lightbox",
}: ImageLightboxProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={`Enlarge: ${alt}`}
        testID={testID}
        onPress={() => setOpen(true)}
        className={`overflow-hidden rounded-md border border-border active:opacity-90 ${className ?? ""}`}
      >
        <Image
          source={{ uri: emulatorHost(src) }}
          accessibilityLabel={alt}
          resizeMode="cover"
          className="h-full w-full"
        />
      </Pressable>

      <Modal
        visible={open}
        animationType="fade"
        presentationStyle="fullScreen"
        onRequestClose={() => setOpen(false)}
      >
        <SafeAreaView className="flex-1 bg-background">
          <View className="flex-1 gap-4 p-6">
            <View className="gap-1.5">
              <Text weight="semibold" className="text-lg text-foreground">
                {title ?? alt}
              </Text>
              {description ? (
                <Text className="text-sm text-muted-foreground">{description}</Text>
              ) : null}
            </View>
            {/* `contain`, and it takes the remaining height so a portrait
                photo cannot push the close button off-screen. */}
            <Image
              source={{ uri: emulatorHost(src) }}
              accessibilityLabel={alt}
              resizeMode="contain"
              className="w-full flex-1 rounded-md"
            />
            <Button
              variant="outline"
              testID={`${testID}-close`}
              onPress={() => setOpen(false)}
            >
              Close
            </Button>
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}
