import type { z, ZodError } from "zod";

/**
 * Tags a ZodError as caused by client input, mapping it to HTTP 400.
 * Untagged ZodErrors (e.g. an upstream response failing schema validation)
 * stay 500s so server-side data bugs are never blamed on the caller.
 */
export class RequestValidationError extends Error {
  constructor(readonly zodError: ZodError) {
    super("invalid request");
    this.name = "RequestValidationError";
  }
}

/** Parse client-supplied input; failures become 400 VALIDATION_ERROR. */
export function parseRequest<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown,
): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new RequestValidationError(result.error);
  return result.data;
}
