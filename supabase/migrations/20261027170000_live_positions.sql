-- =====================================================================
-- Bonus (b): live map sample. Realtime Authorization for broadcast.
--
-- Each group has a PRIVATE broadcast channel, topic `live:group:<group id>`.
-- Realtime checks these RLS policies on realtime.messages when a client
-- joins (SELECT = may receive) and sends (INSERT = may send). Only members
-- of that group pass, so outsiders can't listen to, or post into, a
-- group's live positions. Same access model as the rest of the slice.
--
-- Nothing is stored: broadcast messages pass through Realtime and are not
-- written to any table we own. The sample only carries simulated walkers
-- (tools/live-sim.ts); see docs/live-map-note.md.
-- =====================================================================

create function private.can_use_live_topic(p_topic text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  -- CASE guarantees the uuid cast only runs on a well-formed topic.
  select case
    when p_topic ~ '^live:group:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then private.is_group_member(substring(p_topic from 12)::uuid)
    else false
  end;
$$;

revoke all on function private.can_use_live_topic(text) from public, anon;
grant execute on function private.can_use_live_topic(text) to authenticated;

create policy live_positions_receive on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and private.can_use_live_topic((select realtime.topic()))
  );

create policy live_positions_send on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and private.can_use_live_topic((select realtime.topic()))
  );
