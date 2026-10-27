import {
  ApiError,
  CancelMeetupResponse,
  CreateMeetupResponse,
  RsvpResponse,
  UpdateMeetupResponse,
  type ApiErrorCode,
  type CreateMeetupInput,
  type UpdateMeetupInput,
} from "@altair/contracts";
import type { z } from "zod";
import { supabase, SUPABASE_URL } from "./supabase";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | "network",
    message: string,
    readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

async function call<S extends z.ZodType>(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  response: S,
  body?: unknown,
): Promise<z.output<S>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiRequestError(401, "unauthorized", "Please sign in again");

  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/meetups${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError(0, "network", "Can't reach the server. Check your connection.");
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = ApiError.safeParse(json);
    if (parsed.success) {
      const { code, message, issues } = parsed.data.error;
      throw new ApiRequestError(res.status, code, message, issues);
    }
    throw new ApiRequestError(res.status, "internal", "Something went wrong");
  }
  return response.parse(json);
}

export const api = {
  createMeetup: (input: CreateMeetupInput) => call("POST", "", CreateMeetupResponse, input),
  updateMeetup: (id: string, input: UpdateMeetupInput) => call("PATCH", `/${id}`, UpdateMeetupResponse, input),
  cancelMeetup: (id: string) => call("POST", `/${id}/cancel`, CancelMeetupResponse),
  rsvp: (id: string) => call("POST", `/${id}/rsvp`, RsvpResponse),
  withdrawRsvp: (id: string) => call("DELETE", `/${id}/rsvp`, RsvpResponse),
};
