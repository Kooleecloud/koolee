import * as React from "react";
import { ChevronLeft } from "lucide-react-native";

import { Button } from "./button";

export interface BackLinkProps {
  onPress: () => void;
  children: React.ReactNode;
  className?: string;
  testID?: string;
}

/**
 * Standard "go up one level" affordance: ghost button, leading chevron. An
 * `onPress` rather than the web's `href` — the caller owns the router.
 */
export function BackLink({
  onPress,
  children,
  className,
  testID = "back-link",
}: BackLinkProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      testID={testID}
      onPress={onPress}
      // The ghost variant's text is `text-foreground`; on the web the chevron
      // inherits it through currentColor.
      icon={<ChevronLeft size={16} color="#152337" />}
      className={`self-start ${className ?? ""}`}
    >
      {children}
    </Button>
  );
}
