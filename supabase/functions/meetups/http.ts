import type { z } from "zod";
import type { ApiError, ApiErrorCode } from "../../../packages/contracts/src/index.ts";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

export function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    const body: ApiError = {
      error: { code: err.code, message: err.message, issues: err.issues },
    };
    return json(err.status, body);
  }
  // Never echo unexpected errors: they can carry SQL or row data.
  console.error(err);
  const body: ApiError = { error: { code: "internal", message: "Something went wrong" } };
  return json(500, body);
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "invalid_input", "Request body must be JSON");
  }
}

// Validate with a shared Zod schema; on failure, report every issue.
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new HttpError(
      400,
      "invalid_input",
      "Invalid input",
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return result.data;
}

// Map errors from the write functions (custom SQLSTATEs, see the
// write_functions migration) to HTTP. Their messages are ours and safe to
// forward; anything else is logged and hidden.
export function fromDb(error: { code?: string; message: string }): HttpError {
  switch (error.code) {
    case "AT404":
      return new HttpError(404, "not_found", error.message);
    case "AT403":
      return new HttpError(403, "forbidden", error.message);
    case "AT409":
      return new HttpError(409, "conflict", error.message);
    case "AT422":
      return new HttpError(400, "invalid_input", error.message);
  }
  console.error("unexpected database error", error);
  if (error.code?.startsWith("23")) {
    return new HttpError(400, "invalid_input", "Invalid input");
  }
  return new HttpError(500, "internal", "Something went wrong");
}
