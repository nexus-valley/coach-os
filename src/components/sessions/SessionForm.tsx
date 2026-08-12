"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { Button } from "@/src/components/ui/Button";
import type { CohortWithCourse } from "@/src/lib/cohorts";
import type { Course } from "@/src/lib/courses";
import {
  formatSessionDateTimeLocal,
  getDefaultSessionWallClock,
} from "@/src/lib/sessionDateTime";
import type {
  SessionDeliveryMode,
  SessionMeetingProvider,
  TrainingSession,
} from "@/src/lib/sessions";

export type SessionFormState = {
  cohortId: string;
  courseId: string;
  description: string;
  deliveryMode: SessionDeliveryMode;
  joinAvailableFrom: string;
  meetingId: string;
  meetingNotes: string;
  meetingPasscode: string;
  meetingProvider: SessionMeetingProvider | "";
  meetingUrl: string;
  recordingUrl: string;
  scheduledEndAt: string;
  scheduledStartAt: string;
  timezone: string;
  title: string;
};

export const emptySessionForm: SessionFormState = {
  cohortId: "",
  courseId: "",
  description: "",
  deliveryMode: "offline",
  joinAvailableFrom: "",
  meetingId: "",
  meetingNotes: "",
  meetingPasscode: "",
  meetingProvider: "",
  meetingUrl: "",
  recordingUrl: "",
  scheduledEndAt: "",
  scheduledStartAt: "",
  timezone: "Asia/Kolkata",
  title: "",
};

export function createDefaultSessionForm(
  courses: Course[],
  cohorts: CohortWithCourse[],
) {
  const start = getDefaultSessionWallClock(1, emptySessionForm.timezone);
  const end = getDefaultSessionWallClock(2, emptySessionForm.timezone);
  const firstCohort = cohorts[0];

  return {
    ...emptySessionForm,
    cohortId: firstCohort?.id ?? "",
    courseId: firstCohort?.course_id ?? courses[0]?.id ?? "",
    scheduledEndAt: end,
    scheduledStartAt: start,
  };
}

export function createSessionFormFromSession(
  session: TrainingSession,
): SessionFormState {
  return {
    cohortId: session.cohort_id ?? "",
    courseId: session.course_id ?? "",
    description: session.description ?? "",
    deliveryMode: session.delivery_mode,
    joinAvailableFrom: formatSessionDateTimeLocal(
      session.join_available_from,
      session.timezone,
    ),
    meetingId: session.meeting_id ?? "",
    meetingNotes: session.meeting_notes ?? "",
    meetingPasscode: session.meeting_passcode ?? "",
    meetingProvider: session.meeting_provider ?? "",
    meetingUrl: session.meeting_url ?? "",
    recordingUrl: session.recording_url ?? "",
    scheduledEndAt: formatSessionDateTimeLocal(
      session.scheduled_end_at,
      session.timezone,
    ),
    scheduledStartAt: formatSessionDateTimeLocal(
      session.scheduled_start_at,
      session.timezone,
    ),
    timezone: session.timezone || "Asia/Kolkata",
    title: session.title,
  };
}

export function SessionDialog({
  children,
  description,
  disabled = false,
  onClose,
  title,
}: {
  children: ReactNode;
  description: string;
  disabled?: boolean;
  onClose: () => void;
  title: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = `session-dialog-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !disabled) onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.requestAnimationFrame(() => dialogRef.current?.focus());

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [disabled, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-[#071521]/75 p-3 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !disabled) onClose();
      }}
    >
      <div
        aria-describedby={`${titleId}-description`}
        aria-labelledby={titleId}
        aria-modal="true"
        className="max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl overflow-y-auto rounded-lg border border-[#CBD5E1] bg-white p-5 text-[#0B1F33] shadow-2xl shadow-slate-950/30 sm:max-h-[calc(100dvh-3rem)] sm:p-7"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold" id={titleId}>{title}</h2>
            <p className="mt-2 text-sm leading-6 text-[#526A80]" id={`${titleId}-description`}>
              {description}
            </p>
          </div>
          <button
            aria-label={`Close ${title}`}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#CBD5E1] text-sm font-semibold text-[#526A80] transition hover:bg-[#F1F5F9]"
            disabled={disabled}
            onClick={onClose}
            type="button"
          >
            X
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputClass = "mt-2 h-12 w-full rounded-lg border border-[#CBD5E1] bg-white px-4 text-sm text-[#0B1F33] outline-none transition focus:border-[#2ECBEA] focus:ring-4 focus:ring-[#2ECBEA]/10";
const textAreaClass = "mt-2 min-h-24 w-full resize-y rounded-lg border border-[#CBD5E1] bg-white px-4 py-3 text-sm leading-6 text-[#0B1F33] outline-none transition focus:border-[#2ECBEA] focus:ring-4 focus:ring-[#2ECBEA]/10";

export function SessionFormFields({
  cohorts,
  courses,
  form,
  onChange,
  showRecording = false,
}: {
  cohorts: CohortWithCourse[];
  courses: Course[];
  form: SessionFormState;
  onChange: (next: SessionFormState) => void;
  showRecording?: boolean;
}) {
  const courseOptions = new Map(courses.map((course) => [course.id, course.title]));
  for (const cohort of cohorts) {
    if (cohort.course) courseOptions.set(cohort.course.id, cohort.course.title);
  }
  const compatibleCohorts = form.courseId
    ? cohorts.filter((cohort) => cohort.course_id === form.courseId)
    : cohorts;
  const showsMeeting = form.deliveryMode !== "offline";
  const patch = (values: Partial<SessionFormState>) => onChange({ ...form, ...values });

  return (
    <div className="space-y-5">
      <label className="block">
        <span className="text-sm font-medium text-[#425B76]">Live class title</span>
        <input className={inputClass} onChange={(event) => patch({ title: event.target.value })} required type="text" value={form.title} />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-[#425B76]">Program</span>
          <select
            className={inputClass}
            onChange={(event) => {
              const courseId = event.target.value;
              const cohort = cohorts.find((item) => item.id === form.cohortId);
              patch({
                cohortId: cohort?.course_id === courseId ? form.cohortId : "",
                courseId,
              });
            }}
            required
            value={form.courseId}
          >
            <option value="">Select program</option>
            {[...courseOptions].map(([id, title]) => <option key={id} value={id}>{title}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-[#425B76]">Cohort</span>
          <select
            className={inputClass}
            onChange={(event) => {
              const cohort = cohorts.find((item) => item.id === event.target.value);
              patch({ cohortId: event.target.value, courseId: cohort?.course_id ?? form.courseId });
            }}
            value={form.cohortId}
          >
            <option value="">No cohort</option>
            {compatibleCohorts.map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.name}</option>)}
          </select>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-[#425B76]">Start in {form.timezone || "selected timezone"}</span>
          <input className={inputClass} onChange={(event) => patch({ scheduledStartAt: event.target.value })} required type="datetime-local" value={form.scheduledStartAt} />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-[#425B76]">End in {form.timezone || "selected timezone"}</span>
          <input className={inputClass} onChange={(event) => patch({ scheduledEndAt: event.target.value })} type="datetime-local" value={form.scheduledEndAt} />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-[#425B76]">Delivery</span>
          <select className={inputClass} onChange={(event) => patch({ deliveryMode: event.target.value as SessionDeliveryMode })} value={form.deliveryMode}>
            <option value="offline">Offline</option>
            <option value="online">Online</option>
            <option value="hybrid">Hybrid</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-[#425B76]">Timezone</span>
          <input className={inputClass} list="session-timezones" onChange={(event) => patch({ timezone: event.target.value })} required type="text" value={form.timezone} />
          <datalist id="session-timezones">
            <option value="Asia/Kolkata" />
            <option value="Asia/Dubai" />
            <option value="Europe/London" />
            <option value="America/New_York" />
            <option value="America/Los_Angeles" />
          </datalist>
          <span className="mt-2 block text-xs leading-5 text-[#64748B]">
            Changing timezone keeps the entered start and end clock times and recalculates their saved instant.
          </span>
        </label>
      </div>

      {showsMeeting ? (
        <div className="space-y-4 rounded-lg border border-[#BFD7E6] bg-[#F6FBFE] p-4">
          <p className="text-sm leading-6 text-[#425B76]">
            {form.deliveryMode === "hybrid" ? "Hybrid delivery includes both an in-person and online path." : "Add the online room students will use for this live class."}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-[#425B76]">Meeting provider</span>
              <select className={inputClass} onChange={(event) => patch({ meetingProvider: event.target.value as SessionMeetingProvider | "" })} value={form.meetingProvider}>
                <option value="">No provider</option><option value="zoom">Zoom</option><option value="google_meet">Google Meet</option><option value="microsoft_teams">Microsoft Teams</option><option value="custom">Custom</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-[#425B76]">Meeting link</span>
              <input className={inputClass} onChange={(event) => patch({ meetingUrl: event.target.value })} type="url" value={form.meetingUrl} />
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block"><span className="text-sm font-medium text-[#425B76]">Meeting ID</span><input className={inputClass} onChange={(event) => patch({ meetingId: event.target.value })} type="text" value={form.meetingId} /></label>
            <label className="block"><span className="text-sm font-medium text-[#425B76]">Passcode</span><input className={inputClass} onChange={(event) => patch({ meetingPasscode: event.target.value })} type="text" value={form.meetingPasscode} /></label>
            <label className="block"><span className="text-sm font-medium text-[#425B76]">Join opens in {form.timezone}</span><input className={inputClass} onChange={(event) => patch({ joinAvailableFrom: event.target.value })} type="datetime-local" value={form.joinAvailableFrom} /></label>
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-[#D8E8F0] bg-[#F8FAFC] p-4 text-sm leading-6 text-[#526A80]">
          Offline classes do not use an online meeting link. Existing online details remain stored if you switch modes; add room or delivery context in the notes below.
        </p>
      )}

      {showRecording ? (
        <label className="block"><span className="text-sm font-medium text-[#425B76]">Recording link</span><input className={inputClass} onChange={(event) => patch({ recordingUrl: event.target.value })} type="url" value={form.recordingUrl} /></label>
      ) : null}
      <label className="block"><span className="text-sm font-medium text-[#425B76]">Description</span><textarea className={textAreaClass} onChange={(event) => patch({ description: event.target.value })} value={form.description} /></label>
      <label className="block"><span className="text-sm font-medium text-[#425B76]">{showsMeeting ? "Meeting and delivery notes" : "Delivery notes"}</span><textarea className={textAreaClass} onChange={(event) => patch({ meetingNotes: event.target.value })} value={form.meetingNotes} /></label>
    </div>
  );
}

export function SessionFormActions({
  onCancel,
  saving,
  submitLabel,
}: {
  onCancel: () => void;
  saving: boolean;
  submitLabel: string;
}) {
  return (
    <div className="flex flex-col-reverse gap-3 pt-6 sm:flex-row sm:justify-end">
      <Button disabled={saving} onClick={onCancel} type="button" variant="secondary">Cancel</Button>
      <Button disabled={saving} isLoading={saving} loadingText="Saving..." type="submit">{submitLabel}</Button>
    </div>
  );
}
