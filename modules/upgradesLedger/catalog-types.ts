/**
 * Template-driven catalog types. Server-safe; no React.
 * Field path is relative to payload: "quantity", "units", "notes", "before.*", "after.*", "inputs.*"
 */

export const UPGRADE_CHANGE_TYPES = ["ADD", "REMOVE", "REPLACE", "MODIFY"] as const;
export type ChangeType = (typeof UPGRADE_CHANGE_TYPES)[number];

export type FieldType =
  | "text"
  | "number"
  | "select"
  | "boolean"
  | "percent"
  | "date"
  | "time"
  | "timeRangeList"
  | "multiselect";

export type FieldDescriptor = {
  path: string;
  label: string;
  type: FieldType;
  options?: string[];
  required?: boolean;
};

export type UpgradeTemplate = {
  key: string;
  label: string;
  group: string;
  defaultUnits?: string;
  requiresQuantity: boolean;
  requiredPaths: string[];
  fields: FieldDescriptor[];
};

/** Schedule window: start/end in HH:mm (24h). Stored at inputs.scheduleWindows. */
export type ScheduleWindow = { start: string; end: string };

/** Time range list field value. */
export type TimeRangeListValue = ScheduleWindow[];
