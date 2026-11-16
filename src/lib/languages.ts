/** Display names for the language constants the app offers. Client-safe. */
const NAMES: Record<string, string> = {
  "languageConstants/1000": "English",
  "languageConstants/1005": "Japanese",
  "languageConstants/1003": "German",
  "languageConstants/1002": "French",
  "languageConstants/1010": "Spanish",
};

/** "English", "Any language" for null, or the raw id if it isn't one we name. */
export function languageName(id: string | null): string {
  if (id === null) return "Any language";
  return NAMES[id] ?? id;
}
