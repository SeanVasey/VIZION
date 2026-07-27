import { MODE_LABEL, type ModeId, type TargetModelId } from "@/lib/constants";
import { TARGET_LABEL } from "@/lib/providers/formatters";

export interface ExportData {
  input: string;
  output: string;
  rationale: string;
  mode: ModeId;
  target: TargetModelId;
  modelUsed: string;
}

/** Markdown export (product-spec §4.4). Pure + testable. The human-facing
 *  heading uses the mode LABEL; the JSON export keeps the raw id (a machine
 *  artifact whose stability outlives label renames). */
export function toMarkdown(d: ExportData): string {
  return [
    `# VIZ(IO)N — ${MODE_LABEL[d.mode]} → ${TARGET_LABEL[d.target]}`,
    "",
    "## Input",
    "",
    "```",
    d.input,
    "```",
    "",
    "## Enhanced",
    "",
    "```",
    d.output,
    "```",
    "",
    "## What changed",
    "",
    d.rationale,
    "",
    `_Model: ${d.modelUsed}_`,
    "",
  ].join("\n");
}

/** JSON export. */
export function toJson(d: ExportData): string {
  return JSON.stringify(
    {
      mode: d.mode,
      target: d.target,
      model: d.modelUsed,
      input: d.input,
      output: d.output,
      rationale: d.rationale,
    },
    null,
    2,
  );
}

/** Plain-text export. */
export function toText(d: ExportData): string {
  return `${d.output}\n`;
}

export const EXPORTERS = {
  md: { label: "Markdown", ext: "md", mime: "text/markdown", render: toMarkdown },
  json: { label: "JSON", ext: "json", mime: "application/json", render: toJson },
  txt: { label: "Text", ext: "txt", mime: "text/plain", render: toText },
} as const;

export type ExportFormat = keyof typeof EXPORTERS;
