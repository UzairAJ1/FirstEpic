-- =====================================================================
-- Bonus: creator-only edit of a meetup (title, start time, meeting point).
--
-- Same pattern as the other writes: called only by the Edge Function as
-- service_role, after the shared Zod schema has validated the input. App
-- users still have no UPDATE grant on any table, so this is the only edit
-- path. A cancelled meetup can't be edited: checked here with a clear
-- error, and the meetups_guard_update trigger enforces it for any writer.
--
-- NULL parameters mean "unchanged".
-- =====================================================================
create function public.update_meetup(
  p_user_id    uuid,
  p_meetup_id  uuid,
  p_title      text,
  p_starts_at  timestamptz,
  p_place_name text,
  p_lat        double precision,
  p_lng        double precision
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  m     public.meetups;
  mp    public.meetup_meeting_points;
  v_area record;
begin
  select * into m from public.meetups where id = p_meetup_id for update;

  if not found or not exists (
    select 1 from public.group_memberships
    where group_id = m.group_id and user_id = p_user_id
  ) then
    raise exception 'meetup not found' using errcode = 'AT404';
  end if;

  if m.created_by <> p_user_id then
    raise exception 'only the creator can edit this meetup' using errcode = 'AT403';
  end if;

  if m.status = 'cancelled' then
    raise exception 'a cancelled meetup cannot be edited' using errcode = 'AT409';
  end if;

  -- The meeting point is all-or-nothing.
  if num_nulls(p_place_name, p_lat, p_lng) not in (0, 3) then
    raise exception 'meeting point needs a name, latitude and longitude'
      using errcode = 'AT422';
  end if;

  -- The future-start rule applies when the start time changes. An
  -- unchanged start time is fine even if the meetup has started (e.g.
  -- fixing a typo in the title).
  if p_starts_at is not null and p_starts_at <> m.starts_at and p_starts_at <= now() then
    raise exception 'start time must be in the future' using errcode = 'AT422';
  end if;

  update public.meetups
  set title     = coalesce(btrim(p_title), title),
      starts_at = coalesce(p_starts_at, starts_at)
  where id = p_meetup_id;

  if p_place_name is not null then
    select * into mp from public.meetup_meeting_points where meetup_id = p_meetup_id for update;

    update public.meetup_meeting_points
    set name = btrim(p_place_name), lat = p_lat, lng = p_lng
    where meetup_id = p_meetup_id;

    -- New approximate area only when the point actually moved. Re-saving the
    -- same point must not produce a fresh random circle, or repeated edits
    -- could be averaged back to the exact spot.
    if p_lat <> mp.lat or p_lng <> mp.lng then
      v_area := private.approximate_area(p_lat, p_lng);
      update public.meetups
      set area_lat = v_area.area_lat,
          area_lng = v_area.area_lng,
          area_radius_m = v_area.area_radius_m
      where id = p_meetup_id;
    end if;
  end if;
end;
$$;

revoke all on function
  public.update_meetup(uuid, uuid, text, timestamptz, text, double precision, double precision)
from public, anon, authenticated;

grant execute on function
  public.update_meetup(uuid, uuid, text, timestamptz, text, double precision, double precision)
to service_role;
