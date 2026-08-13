import { z } from "zod";

/**
 * Shared request-body validation helper.
 *
 * Returns a discriminated union so callers either get a fully-typed value or a
 * safe, client-facing validation error (field-level messages, no internals).
 */
export type Parsed<T> =
  | { ok: true; value: T }
  | { ok: false; fields: Record<string, string>; message: string };

function formatFieldErrors(err: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "body";
    if (!result[key]) {
      result[key] = issue.message;
    }
  }
  return result;
}

export function parseBody<T extends z.ZodTypeAny>(schema: T, value: unknown): Parsed<z.infer<T>> {
  const result = schema.safeParse(value);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  const fields = formatFieldErrors(result.error);
  const firstMessage = Object.values(fields)[0] ?? "Invalid request body";
  return { ok: false, fields, message: firstMessage };
}