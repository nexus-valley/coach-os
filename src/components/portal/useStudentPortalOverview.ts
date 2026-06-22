"use client";

import { useEffect, useState } from "react";

import {
  getStudentPortalOverview,
  type StudentPortalOverview,
} from "@/src/lib/studentPortal";
import type { StudentPortalContext } from "@/src/lib/studentPortalAuth";

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

export function useStudentPortalOverview(context: StudentPortalContext) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<StudentPortalOverview | null>(null);

  useEffect(() => {
    let active = true;

    async function loadOverview() {
      try {
        const data = await getStudentPortalOverview({
          accessMode: "student",
          studentId: context.student.id,
          tenantId: context.tenant.id,
        });

        if (!active) {
          return;
        }

        setOverview(data);
        setError(data ? "" : "Student portal data was not found.");
      } catch (caught) {
        if (!active) {
          return;
        }

        setError(getErrorMessage(caught, "Unable to load student portal."));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadOverview();

    return () => {
      active = false;
    };
  }, [context.student.id, context.tenant.id]);

  return { error, loading, overview };
}
