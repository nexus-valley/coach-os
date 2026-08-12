export type AssignmentDetailLifecycleUi = {
  canCaptureSubmission: boolean;
  canClose: boolean;
  canPublish: boolean;
  canReview: boolean;
};

const failClosed: AssignmentDetailLifecycleUi = {
  canCaptureSubmission: false,
  canClose: false,
  canPublish: false,
  canReview: false,
};

export function getAssignmentDetailLifecycleUi(
  status: unknown,
): AssignmentDetailLifecycleUi {
  if (status === "draft") {
    return {
      ...failClosed,
      canPublish: true,
    };
  }

  if (status === "published") {
    return {
      canCaptureSubmission: true,
      canClose: true,
      canPublish: false,
      canReview: true,
    };
  }

  if (status === "closed") {
    return {
      ...failClosed,
      canReview: true,
    };
  }

  return failClosed;
}
