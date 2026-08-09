import { TARGET_MODELS, type TargetModelId } from "@/lib/constants";

const LABEL_BY_ID = new Map(TARGET_MODELS.map((m) => [m.id, m.label]));

/** Display label for a target id — falls back to the raw id so a legacy or
 *  unknown persisted value still renders as *something* rather than blank.
 *  Shared by TargetPicker's trigger and the composer's hold-slider live
 *  label, so the two can never render one model under two names. */
export function targetLabel(id: TargetModelId): string {
  return LABEL_BY_ID.get(id) ?? id;
}
