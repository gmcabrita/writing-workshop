import type { RefObject } from "react";

import { cn } from "@/lib/utils";

export interface LeadFieldProps {
  /** Tone of the active lead note's pass, or null when no lead note is active. */
  readonly activeTone: number | null;
  readonly maxLength: number;
  onChange(lead: string): void;
  /** Outer element, so the workspace can scroll the lead into view. */
  readonly ref: RefObject<HTMLDivElement | null>;
  readonly value: string;
}

/**
 * The lead sits between the title and the prose: a short summary or hook
 * shown outside the piece. The browser enforces `maxLength` on typing only,
 * so a stored lead that exceeds a limit lowered later in settings stays
 * visible: the counter turns red and the writer can only delete.
 */
export const LeadField = ({ activeTone, maxLength, onChange, ref, value }: LeadFieldProps) => {
  const over = value.length > maxLength;

  return (
    <div
      className="mb-8 rounded-r border-l-2 border-border pl-4 transition-colors"
      ref={ref}
      // Lead notes have no highlight in the text, so the whole field takes
      // the active note's pass colour instead.
      style={
        activeTone === null
          ? undefined
          : {
              background: `var(--tone-${activeTone})`,
              borderLeftColor: `var(--tone-${activeTone}-strong)`,
            }
      }
    >
      <textarea
        aria-label="Lead"
        className="field-sizing-content w-full resize-none bg-transparent text-lg leading-snug text-muted-foreground outline-none placeholder:text-muted-foreground/50"
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Lead: one or two sentences shown outside the piece."
        rows={1}
        value={value}
      />
      <div
        className={cn(
          "mt-1 text-right text-xs tabular-nums text-muted-foreground/70",
          over && "text-destructive",
        )}
      >
        {value.length} / {maxLength}
      </div>
    </div>
  );
};
