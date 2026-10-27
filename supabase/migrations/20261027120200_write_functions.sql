-- =====================================================================
-- Write functions, called only by the Edge Functions (service_role).
--
-- The Edge Function verifies the JWT, takes the user id from it (never
-- from the request body), validates input with the shared Zod schemas,
-- then calls one of these. They hold the rules that need data
-- (membership, creator, status, start time) and run atomically.
--
-- Errors use custom SQLSTATEs that the Edge Functions map to HTTP:
--   AT404 not found (also used for outsiders, so existence never leaks)
--   AT403 forbidden (a member who isn't the creator)
--   AT409 conflict  (cancelled, started)
--   AT422 invalid   (backstop for rules Zod already checks)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Approximate area (docs/decisions.md D4).
-- A 500 m circle whose center is 100–450 m from the exact point, in a
-- random direction, with the distance drawn uniformly over the ring's
-- area. The exact point is always inside the circle, never at its center,
-- and could be almost anywhere in it. Computed once per meetup and stored.
-- ---------------------------------------------------------------------
create function private.approximate_area(
  p_lat double precision,
  p_lng double precision,
  out area_lat double precision,
  out area_lng double precision,
  out area_radius_m integer
)
language plpgsql volatile
set search_path = ''
as $$
declare
  radius_m   constant integer := 500;
  min_off_m  constant double precision := 100;
  max_off_m  constant double precision := 450;
  m_per_deg  constant double precision := 111320;
  bearing    double precision := random() * 2 * pi();
  offset_m   double precision :=
    sqrt(min_off_m ^ 2 + random() * (max_off_m ^ 2 - min_off_m ^ 2));
begin
  area_lat := least(90, greatest(-90,
    p_lat + offset_m * cos(bearing) / m_per_deg));
  area_lng := p_lng + offset_m * sin(bearing)
    / (m_per_deg * greatest(cos(radians(p_lat)), 0.01));
  -- wrap across the antimeridian into [-180, 180)
  area_lng := ((area_lng + 540)::numeric % 360)::double precision - 180;
  area_radius_m := radius_m;
end;
$$;

revoke all on function private.approximate_area(double precision, double precision)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- create_meetup
-- ---------------------------------------------------------------------
create function public.create_meetup(
  p_user_id    uuid,
  p_group_id   uuid,
  p_title      text,
  p_starts_at  timestamptz,
  p_place_name text,
  p_lat        double precision,
  p_lng        double precision
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_area record;
  v_id   uuid;
begin
  if not exists (
    select 1 from public.group_memberships
    where group_id = p_group_id and user_id = p_user_id
  ) then
    -- Same answer whether the group exists or not.
    raise exception 'group not found' using errcode = 'AT404';
  end if;

  if p_starts_at <= now() then
    raise exception 'start time must be in the future' using errcode = 'AT422';
  end if;

  v_area := private.approximate_area(p_lat, p_lng);

  insert into public.meetups
    (group_id, created_by, title, starts_at, area_lat, area_lng, area_radius_m)
  values
    (p_group_id, p_user_id, btrim(p_title), p_starts_at,
     v_area.area_lat, v_area.area_lng, v_area.area_radius_m)
  returning id into v_id;

  insert into public.meetup_meeting_points (meetup_id, name, lat, lng)
  values (v_id, btrim(p_place_name), p_lat, p_lng);

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- cancel_meetup: creator only, final. Cancelling twice is a no-op.
-- ---------------------------------------------------------------------
create function public.cancel_meetup(p_user_id uuid, p_meetup_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  m public.meetups;
begin
  select * into m from public.meetups where id = p_meetup_id for update;

  if not found or not exists (
    select 1 from public.group_memberships
    where group_id = m.group_id and user_id = p_user_id
  ) then
    raise exception 'meetup not found' using errcode = 'AT404';
  end if;

  if m.created_by <> p_user_id then
    raise exception 'only the creator can cancel this meetup' using errcode = 'AT403';
  end if;

  if m.status = 'cancelled' then
    return;
  end if;

  update public.meetups
  set status = 'cancelled', cancelled_at = now()
  where id = p_meetup_id;
end;
$$;

-- ---------------------------------------------------------------------
-- rsvp: idempotent. FOR SHARE on the meetup serializes against a
-- concurrent cancel (which takes FOR UPDATE).
-- ---------------------------------------------------------------------
create function public.rsvp(p_user_id uuid, p_meetup_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  m public.meetups;
begin
  select * into m from public.meetups where id = p_meetup_id for share;

  if not found or not exists (
    select 1 from public.group_memberships
    where group_id = m.group_id and user_id = p_user_id
  ) then
    raise exception 'meetup not found' using errcode = 'AT404';
  end if;

  -- Already attending: RSVPing again is not an error the user should see.
  if exists (
    select 1 from public.rsvps where meetup_id = p_meetup_id and user_id = p_user_id
  ) then
    return;
  end if;

  if m.status = 'cancelled' then
    raise exception 'meetup is cancelled' using errcode = 'AT409';
  end if;
  if m.starts_at <= now() then
    raise exception 'meetup has already started' using errcode = 'AT409';
  end if;

  insert into public.rsvps (meetup_id, user_id)
  values (p_meetup_id, p_user_id)
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------
-- withdraw_rsvp: allowed on cancelled meetups too. Withdrawing when not
-- attending is a no-op.
-- ---------------------------------------------------------------------
create function public.withdraw_rsvp(p_user_id uuid, p_meetup_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.meetups m
    join public.group_memberships gm on gm.group_id = m.group_id
    where m.id = p_meetup_id and gm.user_id = p_user_id
  ) then
    raise exception 'meetup not found' using errcode = 'AT404';
  end if;

  delete from public.rsvps where meetup_id = p_meetup_id and user_id = p_user_id;
end;
$$;

-- Only the service role (the Edge Functions) may call these. Postgres
-- grants EXECUTE to PUBLIC on new functions by default, so revoke it.
revoke all on function
  public.create_meetup(uuid, uuid, text, timestamptz, text, double precision, double precision),
  public.cancel_meetup(uuid, uuid),
  public.rsvp(uuid, uuid),
  public.withdraw_rsvp(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.create_meetup(uuid, uuid, text, timestamptz, text, double precision, double precision),
  public.cancel_meetup(uuid, uuid),
  public.rsvp(uuid, uuid),
  public.withdraw_rsvp(uuid, uuid)
to service_role;
