import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@koolee/ui";

import { AgentMain } from "@/components/shell/agent-main";

export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <AgentMain bare>
      <Card>
        <CardHeader>
          <CardTitle>You&apos;re offline</CardTitle>
          <CardDescription>
            Your jobs and everything you record need a connection.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Nothing you were part-way through has been submitted, and nothing is lost. Get
          signal and open the app again — the step you were on will still be there.
        </CardContent>
      </Card>
    </AgentMain>
  );
}
