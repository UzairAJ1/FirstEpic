import { CreateMeetupInput } from "@altair/contracts";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { MeetupForm, issuesToErrors, type FormErrors, type MeetupFormValues } from "@/components/MeetupForm";
import { ApiRequestError } from "@/lib/api";
import { useCreateMeetup } from "@/lib/queries";

function tomorrowAt8() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return d;
}

export default function CreateMeetup() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const create = useCreateMeetup();
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string>();

  async function submit(v: MeetupFormValues) {
    setFormError(undefined);
    // Same schema the server validates with: catch mistakes before the
    // round trip. The server still re-validates (and checks membership).
    const parsed = CreateMeetupInput.safeParse({
      groupId,
      title: v.title,
      startsAt: v.startsAt.toISOString(),
      meetingPoint: { name: v.placeName, lat: v.point?.latitude, lng: v.point?.longitude },
    });
    if (!parsed.success) return setErrors(issuesToErrors(parsed.error.issues));
    setErrors({});

    try {
      const { id } = await create.mutateAsync(parsed.data);
      router.replace({ pathname: "/meetup/[id]", params: { id } });
    } catch (e) {
      // Show the server's answer, field by field where it gives one.
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
      initial={{ title: "", startsAt: tomorrowAt8(), placeName: "" }}
      submitLabel="Create meetup"
      busy={create.isPending}
      errors={errors}
      formError={formError}
      onSubmit={submit}
    />
  );
}
