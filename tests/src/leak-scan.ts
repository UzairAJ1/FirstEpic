// Runs around every test file: after the file's tests, scan every response
// body they received for any seeded home coordinate. Home location must
// never leave the server (spec section 8), in data or in errors.
import { afterAll, expect } from "vitest";
import { closeOwner, recordedBodies } from "./client.ts";
import { homeCoordinates } from "./fixtures.ts";

afterAll(async () => {
  await closeOwner();

  expect(recordedBodies.length).toBeGreaterThan(0);
  for (const body of recordedBodies) {
    for (const coordinate of homeCoordinates) {
      expect(body, `home coordinate ${coordinate} leaked in a response`).not.toContain(
        String(coordinate),
      );
    }
  }
});
