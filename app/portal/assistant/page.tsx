"use client";

import { AssistantPage } from "@/src/components/assistant/AssistantPage";
import { StudentPortalGuard } from "@/src/components/portal/StudentPortalGuard";
import { StudentPortalLayout } from "@/src/components/portal/StudentPortalLayout";

export default function PortalAssistantRoute() {
  return (
    <StudentPortalGuard>
      {(context) => (
        <StudentPortalLayout context={context}>
          <AssistantPage
            scope="student"
            studentName={context.student.full_name}
          />
        </StudentPortalLayout>
      )}
    </StudentPortalGuard>
  );
}
