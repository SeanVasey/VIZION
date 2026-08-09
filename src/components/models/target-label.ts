import type { TargetModelId } from "@/lib/constants";
import { MODEL_LABELS } from "@/lib/library/model-labels";

/** Display label for a target id — falls back to the raw id so a legacy or
 *  unknown persisted value still renders as *something* rather than blank.
 *  Shared by TargetPicker's trigger and the composer's hold-slider live
 *  label, so the two can never render one model under two names. Reads the
 *  one shared id→label map (`MODEL_LABELS`) rather than building its own. */
export function targetLabel(id: TargetModelId): string {
  return MODEL_LABELS.get(id) ?? id;
}
