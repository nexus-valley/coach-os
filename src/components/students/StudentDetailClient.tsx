"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  emptyStudentForm,
  StudentFormFields,
  StudentStatusBadge,
  type StudentFormState,
} from "@/src/components/students/StudentsPageClient";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import {
  deleteStudent,
  getStudentById,
  updateStudent,
  type Student,
} from "@/src/lib/students";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

type StudentDetailClientProps = {
  studentId: string;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function getErrorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

function createFormFromStudent(student: Student): StudentFormState {
  return {
    email: student.email ?? "",
    fullName: student.full_name,
    notes: student.notes ?? "",
    phone: student.phone ?? "",
    source: student.source ?? "",
    status: student.status,
  };
}

export function StudentDetailClient({ studentId }: StudentDetailClientProps) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<StudentFormState>(emptyStudentForm);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [student, setStudent] = useState<Student | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    let active = true;

    async function loadStudent() {
      try {
        const currentTenant = await getCurrentTenant();

        if (!active) {
          return;
        }

        if (!currentTenant) {
          router.replace("/onboarding");
          return;
        }

        const currentStudent = await getStudentById({
          studentId,
          tenantId: currentTenant.id,
        });

        if (!active) {
          return;
        }

        setTenant(currentTenant);
        setStudent(currentStudent);

        if (currentStudent) {
          setForm(createFormFromStudent(currentStudent));
        } else {
          setError("Student not found in this workspace.");
        }
      } catch (caught) {
        if (!active) {
          return;
        }

        setError(getErrorMessage(caught, "Unable to load this student."));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadStudent();

    return () => {
      active = false;
    };
  }, [router, studentId]);

  async function handleUpdateStudent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant) {
      setError("Workspace context is not available.");
      return;
    }

    setMutating(true);
    setError("");

    try {
      const updatedStudent = await updateStudent({
        ...form,
        studentId,
        tenantId: tenant.id,
      });
      setStudent(updatedStudent);
      setForm(createFormFromStudent(updatedStudent));
      setEditOpen(false);
    } catch (caught) {
      setError(getErrorMessage(caught, "Unable to update student."));
    } finally {
      setMutating(false);
    }
  }

  async function handleDeleteStudent() {
    if (!tenant) {
      setError("Workspace context is not available.");
      return;
    }

    setMutating(true);
    setError("");

    try {
      await deleteStudent({
        studentId,
        tenantId: tenant.id,
      });
      router.replace("/app/students");
    } catch (caught) {
      setError(getErrorMessage(caught, "Unable to delete student."));
      setMutating(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="h-72 animate-pulse border-white/10 bg-white/[0.06]">
          <span className="sr-only">Loading student</span>
        </Card>
      </div>
    );
  }

  if (error || !student) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="border-white/10 bg-white p-8 text-zinc-950 shadow-2xl shadow-black/20">
          <p className="text-sm font-semibold text-zinc-500">Student profile</p>
          <h2 className="mt-3 text-2xl font-semibold">
            {error || "Student not found."}
          </h2>
          <Link
            className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-zinc-950 px-5 text-sm font-semibold text-white"
            href="/app/students"
          >
            Back to students
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <Link
        className="text-sm font-semibold text-zinc-400 transition hover:text-white"
        href="/app/students"
      >
        Back to students
      </Link>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_0.42fr]">
        <Card className="border-white/10 bg-white/[0.06] p-6 text-white shadow-2xl shadow-black/10 sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Badge className="border-white/15 bg-white/10 text-white">
                Student profile
              </Badge>
              <h2 className="mt-5 text-4xl font-semibold leading-tight tracking-normal">
                {student.full_name}
              </h2>
            </div>
            <StudentStatusBadge status={student.status} />
          </div>

          <div className="mt-8 grid gap-4 border-t border-white/10 pt-6 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-sm text-zinc-500">Email</p>
              <p className="mt-2 break-words font-semibold">
                {student.email || "Not added"}
              </p>
            </div>
            <div>
              <p className="text-sm text-zinc-500">Phone</p>
              <p className="mt-2 font-semibold">
                {student.phone || "Not added"}
              </p>
            </div>
            <div>
              <p className="text-sm text-zinc-500">Source</p>
              <p className="mt-2 font-semibold">
                {student.source || "Direct"}
              </p>
            </div>
            <div>
              <p className="text-sm text-zinc-500">Created</p>
              <p className="mt-2 font-semibold">
                {formatDate(student.created_at)}
              </p>
            </div>
          </div>

          <div className="mt-8 rounded-3xl border border-white/10 bg-zinc-950/35 p-5">
            <p className="text-sm font-semibold text-zinc-400">Notes</p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-300">
              {student.notes || "No notes added yet."}
            </p>
          </div>
        </Card>

        <Card className="border-white/10 bg-white p-6 text-zinc-950 shadow-2xl shadow-black/20">
          <p className="text-sm font-semibold text-zinc-500">Workspace</p>
          <h3 className="mt-3 text-2xl font-semibold">{tenant?.name}</h3>
          <p className="mt-3 text-sm leading-6 text-zinc-500">
            This CRM record is scoped to the current tenant and cannot be loaded
            without the matching workspace id.
          </p>
          <div className="mt-7 flex flex-col gap-3">
            <Button onClick={() => setEditOpen(true)} type="button">
              Edit Student
            </Button>
            <Button
              className="text-red-700 hover:bg-red-50 hover:text-red-800"
              onClick={() => setDeleteOpen(true)}
              type="button"
              variant="ghost"
            >
              Delete Student
            </Button>
          </div>
        </Card>
      </section>

      {error ? (
        <div className="mt-6 rounded-3xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          "Enrollments",
          "Payments",
          "Activity timeline",
          "Support notes",
        ].map((title, index) => (
          <Card
            className="border-white/10 bg-white/[0.06] p-6 text-white shadow-2xl shadow-black/10"
            key={title}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-sm font-bold text-zinc-950">
              {String(index + 1).padStart(2, "0")}
            </span>
            <h3 className="mt-6 text-xl font-semibold">{title}</h3>
            <p className="mt-3 text-sm leading-6 text-zinc-400">
              Placeholder for a future module. No logic is connected here yet.
            </p>
          </Card>
        ))}
      </section>

      {editOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="w-full max-w-2xl border-zinc-200 bg-white p-6 text-zinc-950 shadow-2xl shadow-black/40 sm:p-8">
            <h3 className="text-2xl font-semibold">Edit student</h3>
            <form className="mt-7 space-y-5" onSubmit={handleUpdateStudent}>
              <StudentFormFields form={form} setForm={setForm} />
              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <Button
                  onClick={() => {
                    setForm(createFormFromStudent(student));
                    setEditOpen(false);
                  }}
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button disabled={mutating} type="submit">
                  {mutating ? "Saving..." : "Save changes"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}

      {deleteOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 py-4 backdrop-blur-sm sm:items-center">
          <Card className="w-full max-w-md border-zinc-200 bg-white p-6 text-zinc-950 shadow-2xl shadow-black/40 sm:p-8">
            <p className="text-sm font-semibold text-red-600">
              Confirm delete
            </p>
            <h3 className="mt-3 text-2xl font-semibold">
              Delete {student.full_name}?
            </h3>
            <p className="mt-3 text-sm leading-6 text-zinc-500">
              This removes the student CRM record. Enrollment and payment
              modules are not connected in this module.
            </p>
            <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                onClick={() => setDeleteOpen(false)}
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                className="bg-red-600 shadow-red-600/20 hover:bg-red-700"
                disabled={mutating}
                onClick={handleDeleteStudent}
                type="button"
              >
                {mutating ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
