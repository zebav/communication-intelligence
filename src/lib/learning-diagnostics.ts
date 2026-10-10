/**
 * Keep background-worker diagnostics useful without allowing a provider error
 * (which can include query fragments or private values) into runtime logs.
 */
export function learningQueryFailureCode(error: unknown) {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : "";
  switch (code) {
    case "PGRST204": return "learning_schema_mismatch";
    case "42P01": return "learning_table_missing";
    case "42703": return "learning_column_missing";
    case "42501": return "learning_permission_denied";
    default: return "learning_query_failed";
  }
}
