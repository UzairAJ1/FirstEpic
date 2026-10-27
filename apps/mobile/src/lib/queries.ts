import {
  ATTENDEE_COLUMNS,
  Attendee,
  Group,
  GROUP_COLUMNS,
  Meetup,
  MEETUP_COLUMNS,
  type CreateMeetupInput,
  type UpdateMeetupInput,
} from "@altair/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { supabase } from "./supabase";

// Reads query the views directly with the member's session; RLS decides
// what comes back. Every row is parsed with the shared contract.

export const keys = {
  groups: ["groups"] as const,
  meetups: (groupId: string) => ["meetups", groupId] as const,
  meetup: (id: string) => ["meetup", id] as const,
  attendees: (id: string) => ["attendees", id] as const,
};

export function useMyGroups() {
  return useQuery({
    queryKey: keys.groups,
    queryFn: async () => {
      const { data, error } = await supabase.from("groups").select(GROUP_COLUMNS).order("name");
      if (error) throw error;
      return data.map((g) => Group.parse(g));
    },
  });
}

export function useGroupMeetups(groupId: string | undefined) {
  return useQuery({
    queryKey: keys.meetups(groupId ?? ""),
    enabled: !!groupId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meetup_details")
        .select(MEETUP_COLUMNS)
        .eq("group_id", groupId!)
        .order("starts_at"); // soonest first
      if (error) throw error;
      return data.map((m) => Meetup.parse(m));
    },
  });
}

export function useMeetup(id: string) {
  return useQuery({
    queryKey: keys.meetup(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meetup_details")
        .select(MEETUP_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      // RLS returns no row both for "doesn't exist" and "not yours".
      return data ? Meetup.parse(data) : null;
    },
  });
}

export function useAttendees(meetupId: string) {
  return useQuery({
    queryKey: keys.attendees(meetupId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meetup_attendees")
        .select(ATTENDEE_COLUMNS)
        .eq("meetup_id", meetupId)
        .order("created_at");
      if (error) throw error;
      return data.map((a) => Attendee.parse(a));
    },
  });
}

// After any write, refetch what it can change. For RSVP that includes the
// meetup itself: the server now returns the exact meeting point (or stops
// returning it after a withdraw), and the map re-renders from that.
function useInvalidateMeetup() {
  const qc = useQueryClient();
  return (id: string) =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.meetup(id) }),
      qc.invalidateQueries({ queryKey: keys.attendees(id) }),
      qc.invalidateQueries({ queryKey: ["meetups"] }),
    ]);
}

export function useCreateMeetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMeetupInput) => api.createMeetup(input),
    onSuccess: (_res, input) => qc.invalidateQueries({ queryKey: keys.meetups(input.groupId) }),
  });
}

export function useSetRsvp(id: string) {
  const invalidate = useInvalidateMeetup();
  return useMutation({
    mutationFn: (attending: boolean) => (attending ? api.rsvp(id) : api.withdrawRsvp(id)),
    onSuccess: () => invalidate(id),
  });
}

export function useUpdateMeetup(id: string) {
  const invalidate = useInvalidateMeetup();
  return useMutation({
    mutationFn: (input: UpdateMeetupInput) => api.updateMeetup(id, input),
    onSuccess: () => invalidate(id),
  });
}

export function useCancelMeetup(id: string) {
  const invalidate = useInvalidateMeetup();
  return useMutation({
    mutationFn: () => api.cancelMeetup(id),
    onSuccess: () => invalidate(id),
  });
}
