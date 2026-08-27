export const transactionalEmailMaxAttempts = 5;
export const transactionalEmailMaxBatchSize = 25;

const retryDelaySeconds = [60, 300, 1_800, 7_200] as const;

export function getTransactionalEmailRetryDelaySeconds(attemptNumber: number) {
  if (
    !Number.isInteger(attemptNumber) ||
    attemptNumber < 1 ||
    attemptNumber >= transactionalEmailMaxAttempts
  ) {
    throw new RangeError("Retry delay requires a retryable attempt number.");
  }

  return retryDelaySeconds[attemptNumber - 1];
}

export function shouldRetryTransactionalEmail(params: {
  attemptNumber: number;
  retryable: boolean;
}) {
  return params.retryable && params.attemptNumber < transactionalEmailMaxAttempts;
}
