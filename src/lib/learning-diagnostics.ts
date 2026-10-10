/**
 * Keep background-worker diagnostics useful without allowing a provider error
 * (which can include query fragments or private values) into runtime logs.
 */
export function databaseQueryFailureCode(area: string, error: unknown) {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : "";
  switch (code) {
    case "PGRST204": return `${area}_schema_mismatch`;
    case "42P01": return `${area}_table_missing`;
    case "42703": return `${area}_column_missing`;
    case "42501": return `${area}_permission_denied`;
    default: return `${area}_query_failed`;
  }
}

export const learningQueryFailureCode = (error: unknown) => databaseQueryFailureCode("learning", error);
