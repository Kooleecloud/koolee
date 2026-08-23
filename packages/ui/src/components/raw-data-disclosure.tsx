import { cn } from "../lib/utils";

/**
 * Collapsed escape hatch for the underlying record behind a humanized view.
 *
 * Prose summaries are a reading aid, not a replacement for the record — when
 * an operator is reconstructing what happened they need the actual stored
 * fields, including any our copy does not know how to phrase. This keeps that
 * one click away instead of removing it.
 */
export interface RawDataDisclosureProps {
  data: unknown;
  label?: string;
  className?: string;
}

function RawDataDisclosure({
  data,
  label = "Raw data",
  className,
}: RawDataDisclosureProps) {
  if (data == null) return null;

  return (
    <details className={cn("group", className)}>
      <summary className="w-fit cursor-pointer list-none text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">{label} ▸</span>
        <span className="hidden group-open:inline">{label} ▾</span>
      </summary>
      <pre className="mt-1 overflow-x-auto rounded-sm bg-muted/50 p-2 text-[11px] leading-relaxed">
        {JSON.stringify(data, null, 2)}
      </pre>
    </details>
  );
}

export { RawDataDisclosure };
