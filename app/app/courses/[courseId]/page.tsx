import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { CourseDetailClient } from "@/src/components/courses/CourseDetailClient";
import { AppShell } from "@/src/components/layout/AppShell";

type CourseDetailPageProps = {
  params: Promise<{
    courseId: string;
  }>;
};

export default async function CourseDetailPage({
  params,
}: CourseDetailPageProps) {
  const { courseId } = await params;

  return (
    <RouteGuard mode="app">
      <AppShell activeItem="Courses">
        <CourseDetailClient courseId={courseId} />
      </AppShell>
    </RouteGuard>
  );
}
