-- =====================================================================
-- Access: grants, RLS helpers, RLS policies, read views.
--
-- Two layers, both must pass:
--   GRANT  which tables/columns a role may touch at all
--   RLS    which rows it sees
--
-- Supabase's defaults grant anon and authenticated ALL privileges on every
-- table in public (and on future ones). We reset that: users get SELECT
-- only, and on users only (id, display_name). Writes happen only through
-- the service-role write functions called by the Edge Functions.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Reset Supabase's default grants
-- ---------------------------------------------------------------------
revoke all on table
  public.users, public.groups, public.group_memberships,
  public.meetups, public.meetup_meeting_points, public.rsvps
from anon, authenticated;

-- So a table added later starts closed instead of wide open.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Read grants for signed-in users. anon gets nothing.
-- ---------------------------------------------------------------------
grant select on public.groups                to authenticated;
grant select on public.group_memberships     to authenticated;
grant select on public.meetups               to authenticated;
grant select on public.meetup_meeting_points to authenticated;
grant select on public.rsvps                 to authenticated;

-- Column grant: home_lat / home_lng are not readable by any API user,
-- not even on their own row. Selecting them fails with permission denied.
grant select (id, display_name) on public.users to authenticated;

-- ---------------------------------------------------------------------
-- 3. RLS helpers. SECURITY DEFINER so a policy on one table can look at
-- another table without that table's policies recursing back. Each
-- returns only a boolean about the caller, so nothing leaks through them.
-- ---------------------------------------------------------------------
grant usage on schema private to authenticated;

create function private.is_group_member(p_group_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_memberships
    where group_id = p_group_id and user_id = (select auth.uid())
  );
$$;

create function private.is_meetup_member(p_meetup_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.meetups m
    join public.group_memberships gm on gm.group_id = m.group_id
    where m.id = p_meetup_id and gm.user_id = (select auth.uid())
  );
$$;

-- Exact meeting point: the creator or an attendee, and still a group member.
create function private.can_see_meeting_point(p_meetup_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.is_meetup_member(p_meetup_id) and (
    exists (select 1 from public.meetups
            where id = p_meetup_id and created_by = (select auth.uid()))
    or
    exists (select 1 from public.rsvps
            where meetup_id = p_meetup_id and user_id = (select auth.uid()))
  );
$$;

create function private.shares_group_with(p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_memberships mine
    join public.group_memberships theirs on theirs.group_id = mine.group_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = p_user_id
  );
$$;

revoke all on all functions in schema private from public, anon;
grant execute on function
  private.is_group_member(uuid),
  private.is_meetup_member(uuid),
  private.can_see_meeting_point(uuid),
  private.shares_group_with(uuid)
to authenticated;

-- ---------------------------------------------------------------------
-- 4. Policies (SELECT only; there are no write grants to police)
-- ---------------------------------------------------------------------
-- "My groups": a member sees the groups they belong to.
create policy groups_select_member on public.groups
  for select to authenticated
  using (private.is_group_member(id));

-- Only your own membership rows; co-members are visible via users below.
create policy group_memberships_select_own on public.group_memberships
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Display names of yourself and people you share a group with.
create policy users_select_co_member on public.users
  for select to authenticated
  using (id = (select auth.uid()) or private.shares_group_with(id));

create policy meetups_select_member on public.meetups
  for select to authenticated
  using (private.is_group_member(group_id));

create policy meetup_meeting_points_select_attendee on public.meetup_meeting_points
  for select to authenticated
  using (private.can_see_meeting_point(meetup_id));

create policy rsvps_select_member on public.rsvps
  for select to authenticated
  using (private.is_meetup_member(meetup_id));

-- ---------------------------------------------------------------------
-- 5. Read views. security_invoker = true: the view runs as the caller, so
-- every policy above still applies. The meeting point is a LEFT JOIN, so
-- for a member who hasn't RSVP'd those columns are simply null.
-- ---------------------------------------------------------------------
create view public.meetup_details
with (security_invoker = true) as
select
  m.id,
  m.group_id,
  m.title,
  m.starts_at,
  m.status,
  m.cancelled_at,
  m.created_by,
  creator.display_name                          as creator_name,
  m.created_by = (select auth.uid())            as is_creator,
  exists (select 1 from public.rsvps r
          where r.meetup_id = m.id
            and r.user_id = (select auth.uid())) as has_rsvp,
  (select count(*)::int from public.rsvps r
   where r.meetup_id = m.id)                    as attendee_count,
  mp.name                                       as meeting_point_name,
  mp.lat                                        as meeting_point_lat,
  mp.lng                                        as meeting_point_lng,
  m.area_lat,
  m.area_lng,
  m.area_radius_m
from public.meetups m
left join public.users creator on creator.id = m.created_by
left join public.meetup_meeting_points mp on mp.meetup_id = m.id;

create view public.meetup_attendees
with (security_invoker = true) as
select r.meetup_id, r.user_id, u.display_name, r.created_at
from public.rsvps r
join public.users u on u.id = r.user_id;

revoke all on public.meetup_details, public.meetup_attendees from anon, authenticated;
grant select on public.meetup_details, public.meetup_attendees to authenticated;
