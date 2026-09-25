// labels.ts keeps the display names for enum values in one place, so an export,
// a report and the web app cannot disagree about what "in_store" is called.
export const STATUS_LABELS: Record<string, string> = {
  in_use: 'In use',
  in_store: 'In store',
  repair: 'Repair',
  written_off: 'Written off',
  disposed: 'Disposed',
};
