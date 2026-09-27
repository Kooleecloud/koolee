import * as React from "react";
import { View } from "react-native";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card";

export interface EmptyStateProps {
  /** Optional glyph above the title — a lucide icon at size 32, muted. */
  icon?: React.ReactNode;
  title: string;
  description?: string;
  /** Optional way forward — a CTA beats a dead end. */
  action?: React.ReactNode;
  className?: string;
  testID?: string;
}

/** packages/ui EmptyState: a centred Card with icon, title, description, action. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  testID,
}: EmptyStateProps) {
  return (
    <Card testID={testID} className={className}>
      <CardHeader className="items-center">
        {icon ? <View className="mb-1">{icon}</View> : null}
        <CardTitle className="text-center text-base">{title}</CardTitle>
        {description ? (
          <CardDescription className="text-center">{description}</CardDescription>
        ) : null}
      </CardHeader>
      {action ? <CardContent className="items-center">{action}</CardContent> : null}
    </Card>
  );
}
