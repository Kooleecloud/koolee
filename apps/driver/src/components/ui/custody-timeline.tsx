import * as React from "react";
import { View } from "react-native";

import { ImageLightbox } from "./image-lightbox";
import { StageDot, type StageState } from "./stage-dot";
import { Text } from "./text";

export type CustodyItemState = StageState;

export interface CustodyTimelineItem {
  id: string;
  title: string;
  /** Pre-formatted timestamp line (in the booking's tz — see lib/time.ts). */
  meta?: string;
  /**
   * ISO instant behind `meta`. Kept for API parity with the web's `<time
   * dateTime>`; there is no `<time>` on native, so it is not rendered.
   */
  metaDateTime?: string;
  description?: React.ReactNode;
  /** Proof photo taken at this hand-off. */
  photoUrl?: string;
  photoAlt?: string;
  state?: CustodyItemState;
}

export interface CustodyTimelineProps {
  items: readonly CustodyTimelineItem[];
  /** Shown when there are no items yet. */
  emptyMessage?: string;
  className?: string;
  testID?: string;
}

/**
 * Chain-of-custody timeline — packages/ui CustodyTimeline, vertical only
 * (the horizontal variant is the marketing site's). Apps map their domain
 * events to items; the driver's task record does that in the screen.
 */
export function CustodyTimeline({
  items,
  emptyMessage = "Nothing has happened yet. Events appear here as your bags move.",
  className,
  testID,
}: CustodyTimelineProps) {
  if (items.length === 0) {
    return (
      <Text testID={testID} className="text-sm text-muted-foreground">
        {emptyMessage}
      </Text>
    );
  }

  return (
    <View testID={testID} className={className}>
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        const state = item.state ?? "complete";
        return (
          <View key={item.id} className="flex-row gap-4" testID={`custody-${item.id}`}>
            <View className="items-center">
              <StageDot state={state} className="mt-1.5" />
              {!isLast ? (
                // The rail is always blue — it is the thread the eye follows;
                // the dots, not the line, carry the state. Upcoming is the
                // one exception: dashed, in the border grey.
                <View
                  className={
                    state === "upcoming"
                      ? "w-0 flex-1 border border-dashed border-border"
                      : "w-0.5 flex-1 rounded-full bg-sky-400"
                  }
                />
              ) : null}
            </View>

            <View className="flex-1 gap-1 pb-6">
              <Text
                weight="medium"
                className={`text-sm ${state === "upcoming" ? "text-muted-foreground" : "text-navy-800"}`}
              >
                {item.title}
              </Text>
              {item.meta ? (
                <Text className="text-xs text-muted-foreground">{item.meta}</Text>
              ) : null}
              {item.description ? (
                typeof item.description === "string" ? (
                  <Text className="text-sm text-muted-foreground">
                    {item.description}
                  </Text>
                ) : (
                  <View>{item.description}</View>
                )
              ) : null}
              {item.photoUrl ? (
                <ImageLightbox
                  src={item.photoUrl}
                  alt={item.photoAlt ?? "Hand-off proof photo"}
                  title={item.title}
                  className="mt-1 h-48 w-48"
                  testID={`custody-${item.id}-photo`}
                />
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
