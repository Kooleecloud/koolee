import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ContentColumn,
} from "@koolee/ui";

export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <ContentColumn width="narrow">
      <Card>
        <CardHeader>
          <CardTitle>You&apos;re offline</CardTitle>
          <CardDescription>
            The agent app needs a connection to load tasks and record custody events.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Anything you were mid-way through has not been submitted. Reconnect and try
          again.
        </CardContent>
      </Card>
    </ContentColumn>
  );
}
