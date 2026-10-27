// Seed cast and reference meetups (supabase/seed.sql).

export const PASSWORD = "altair-fixture-pass";

export const users = {
  avery: { id: "a1000000-0000-4000-8000-000000000001", email: "avery@example.test", name: "Avery Lin" },
  jordan: { id: "a1000000-0000-4000-8000-000000000002", email: "jordan@example.test", name: "Jordan Price" },
  sam: { id: "a1000000-0000-4000-8000-000000000003", email: "sam@example.test", name: "Sam Okafor" },
  riley: { id: "a1000000-0000-4000-8000-000000000004", email: "riley@example.test", name: "Riley Chen" },
  morgan: { id: "a1000000-0000-4000-8000-000000000005", email: "morgan@example.test", name: "Morgan Ellis" },
  casey: { id: "a1000000-0000-4000-8000-000000000006", email: "casey@example.test", name: "Casey Moreno" },
  taylor: { id: "a1000000-0000-4000-8000-000000000007", email: "taylor@example.test", name: "Taylor Brooks" },
  quinn: { id: "a1000000-0000-4000-8000-000000000008", email: "quinn@example.test", name: "Quinn Adler" },
} as const;
export type Persona = keyof typeof users;

export const groups = {
  maple: "b2000000-0000-4000-8000-000000000001",
  riverside: "b2000000-0000-4000-8000-000000000002",
} as const;

export const meetups = {
  saturday: {
    id: "c3000000-0000-4000-8000-000000000001",
    place: "North gate, Linden Park",
    lat: 40.012046,
    lng: -99.984517,
  },
  weeknight: {
    id: "c3000000-0000-4000-8000-000000000002",
    place: "Front steps, Elm Avenue Library",
    lat: 40.003318,
    lng: -99.979762,
  },
  riverside: {
    id: "c3000000-0000-4000-8000-000000000003",
    place: "Boathouse lot, Riverside Path",
    lat: 39.985239,
    lng: -100.009683,
  },
} as const;

// The spare public place, for meetups the tests create.
export const spare = { name: "Fountain plaza, Town Green", lat: 39.999134, lng: -99.999461 } as const;

// PRIVATE seeded home locations. No response may ever contain these.
export const homeCoordinates = [
  40.004812, -99.993127, 40.007395, -99.98864, 39.998263, -99.995418,
  40.002957, -100.006284, 39.993481, -100.011736, 39.989624, -100.004952,
  40.010538, -100.014867, 39.996107, -100.017392,
];
