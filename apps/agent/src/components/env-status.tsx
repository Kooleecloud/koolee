import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@koolee/ui";

import { describeEnvStatus, isDev, warnMissingEnvOnce } from "@/env";

/**
 * Dev-only diagnostic: which external services have credentials, and what the
 * app does when they do not. Renders nothing outside development.
 */
export function EnvStatus({ appName }: { appName: string }) {
  if (!isDev) return null;

  warnMissingEnvOnce(appName);
  const services = describeEnvStatus();
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
