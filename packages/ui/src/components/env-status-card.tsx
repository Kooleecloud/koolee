import { Badge } from "./badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card";

export interface EnvStatusCardProps {
  services: Array<{
    service: string;
    configured: boolean;
    fallback: string;
    keys: string[];
  }>;
  appName: string;
}

/**
 * Dev-only diagnostic card: which external services have credentials, and
 * what the app does when they do not. Purely presentational — each app's
 * `EnvStatus` wrapper decides whether to render it and feeds it the status
 * list from its own `@/env` module.
 */
function EnvStatusCard({ services }: EnvStatusCardProps) {
  const configured = services.filter((s) => s.configured).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-4 text-base">
          <span>Environment</span>
          <Badge variant={configured === services.length ? "success" : "secondary"}>
            {configured}/{services.length} configured
          </Badge>
        </CardTitle>
        <CardDescription>
          Dev-only. Everything below degrades gracefully — the app boots with zero
          credentials.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y text-sm">
          {services.map((s) => (
            <li key={s.service} className="flex flex-col gap-1 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">{s.service}</span>
                <Badge variant={s.configured ? "success" : "outline"}>
                  {s.configured ? "set" : "missing"}
                </Badge>
              </div>
              {!s.configured && (
                <span className="text-xs text-muted-foreground">{s.fallback}</span>
              )}
              <code className="text-[11px] text-muted-foreground/70">
                {s.keys.join(", ")}
              </code>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export { EnvStatusCard };
