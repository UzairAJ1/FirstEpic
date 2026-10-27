import { UpdateMeetupInput, type Meetup } from "@altair/contracts";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { MeetupForm, issuesToErrors, type FormErrors, type MeetupFormValues } from "@/components/MeetupForm";
import { Empty, ErrorState, Loading } from "@/components/ui";
import { ApiRequestError } from "@/lib/api";
import { useMeetup, useUpdateMeetup } from "@/lib/queries";

// Bonus: creator-only edit. The server enforces creator-only and "not
// cancelled"; this screen just doesn't offer the form to anyone else.
export default function EditMeetup() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const meetup = useMeetup(id);

  if (meetup.isPending) return <Loading />;
  if (meetup.isError) return <ErrorState message={meetup.error.message} onRetry={() => meetup.refetch()} />;
  const m = meetup.data;
  // The creator always gets the exact point, so this also covers "not yours".
  if (!m || !m.isCreator || m.meetingPoint.kind !== "exact") return <Empty title="You can't edit this meetup" />;
  if (m.status === "cancelled") return <Empty title="A cancelled meetup can't be edited" />;

  return <EditForm meetup={m} />;
}

function EditForm({ meetup }: { meetup: Meetup }) {
  const update = useUpdateMeetup(meetup.id);
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string>();
  const point = meetup.meetingPoint.kind === "exact" ? meetup.meetingPoint : undefined;

  async function submit(v: MeetupFormValues) {
    setFormError(undefined);

    // Send only what changed. An unchanged start time is left out, so the
    // future-start rule applies only when the time actually moves.
    const startsAt = v.startsAt.toISOString();
    const pointChanged =
      v.placeName !== point?.name || v.point?.latitude !== point?.lat || v.point?.longitude !== point?.lng;
    const parsed = UpdateMeetupInput.safeParse({
      title: v.title !== meetup.title ? v.title : undefined,
      startsAt: Date.parse(startsAt) !== Date.parse(meetup.startsAt) ? startsAt : undefined,
      meetingPoint: pointChanged
        ? { name: v.placeName, lat: v.point?.latitude, lng: v.point?.longitude }
        : undefined,
    });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      if (parsed.error.issues.some((i) => i.path.length === 0)) setFormError("Nothing changed");
      return;
    }
    setErrors({});

    try {
      await update.mutateAsync(parsed.data);
      router.back();
    } catch (e) {
      if (e instanceof ApiRequestError) {
        setErrors(issuesToErrors(e.issues));
        setFormError(e.message);
      } else {
        setFormError("Something went wrong");
      }
    }
  }

  return (
    <MeetupForm
      initial={{
        title: meetup.title,
        startsAt: new Date(meetup.startsAt),
        placeName: point?.name ?? "",
        point: point && { latitude: point.lat, longitude: point.lng },
      }}
      submitLabel="Save changes"
      busy={update.isPending}
      errors={errors}
      formError={formError}
      onSubmit={submit}
    />
  );
}
