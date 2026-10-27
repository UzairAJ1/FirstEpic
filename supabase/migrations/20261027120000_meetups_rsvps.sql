-- =====================================================================
-- Meetups, meeting points, RSVPs: tables and integrity rules.
-- Access (grants, RLS, views) is in the next migration; writes are in
-- the one after. See docs/decisions.md D3/D4.
-- =====================================================================

-- Helpers and trigger functions live here. PostgREST only exposes the
-- public schema, so nothing in private is callable through the API.
create schema private;

-- ---------------------------------------------------------------------
-- meetups: the part of a meetup every group member may see.
-- The exact meeting point is NOT here (see meetup_meeting_points); only
-- an approximate area, computed once at creation and never recomputed,
-- so repeated reads can't be averaged back to the exact point.
-- ---------------------------------------------------------------------
create table public.meetups (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references public.groups (id) on delete cascade,
  created_by     uuid not null references public.users (id) on delete cascade,
  title          text not null
                 check (char_length(title) between 1 and 80 and title = btrim(title)),
  starts_at      timestamptz not null,
  status         text not null default 'scheduled'
                 check (status in ('scheduled', 'cancelled')),
  cancelled_at   timestamptz,

  area_lat       double precision not null check (area_lat between -90 and 90),
  area_lng       double precision not null check (area_lng between -180 and 180),
  area_radius_m  integer not null check (area_radius_m >= 300),

  created_at     timestamptz not null default now(),

  constraint meetups_cancelled_at_matches_status
    check ((status = 'cancelled') = (cancelled_at is not null))
);

create index meetups_group_id_starts_at_idx on public.meetups (group_id, starts_at);

-- ---------------------------------------------------------------------
-- meetup_meeting_points: the exact place. Split out so RLS can hide the
-- whole row from members who haven't RSVP'd (RLS filters rows, not columns).
-- ---------------------------------------------------------------------
create table public.meetup_meeting_points (
  meetup_id  uuid primary key references public.meetups (id) on delete cascade,
  name       text not null
             check (char_length(name) between 1 and 120 and name = btrim(name)),
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180)
);

-- ---------------------------------------------------------------------
-- rsvps: one per member per meetup (the primary key makes RSVP idempotent).
-- ---------------------------------------------------------------------
create table public.rsvps (
  meetup_id   uuid not null references public.meetups (id) on delete cascade,
  user_id     uuid not null references public.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (meetup_id, user_id)
);

create index rsvps_user_id_idx on public.rsvps (user_id);

alter table public.meetups               enable row level security;
alter table public.meetup_meeting_points enable row level security;
alter table public.rsvps                 enable row level security;

-- ---------------------------------------------------------------------
-- Integrity backstops. The write functions check these rules first and
-- return clear errors; the triggers make them hold for any writer,
-- including the service role and future code paths.
-- ---------------------------------------------------------------------

-- A cancelled meetup is final: no reopening, no edits. Ownership and
-- group never change.
create function private.meetups_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'cancelled' then
    raise exception 'meetup is cancelled and cannot be changed'
      using errcode = 'AT409';
  end if;
  if new.group_id <> old.group_id or new.created_by <> old.created_by then
    raise exception 'meetup group and creator cannot change'
      using errcode = 'AT422';
  end if;
  return new;
end;
$$;

create trigger meetups_guard_update
  before update on public.meetups
  for each row execute function private.meetups_guard_update();

-- No RSVP from a non-member, or to a cancelled or started meetup.
create function private.rsvps_guard_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  m public.meetups;
begin
  select * into m from public.meetups where id = new.meetup_id;

  if not exists (
    select 1 from public.group_memberships gm
    where gm.group_id = m.group_id and gm.user_id = new.user_id
  ) then
    raise exception 'only group members can RSVP' using errcode = 'AT403';
  end if;
  if m.status = 'cancelled' then
    raise exception 'meetup is cancelled' using errcode = 'AT409';
  end if;
  if m.starts_at <= now() then
    raise exception 'meetup has already started' using errcode = 'AT409';
  end if;
  return new;
end;
$$;

create trigger rsvps_guard_insert
  before insert on public.rsvps
  for each row execute function private.rsvps_guard_insert();
