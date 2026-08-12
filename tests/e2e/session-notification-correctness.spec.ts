import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sessions = readFileSync(
  join(process.cwd(), "src/lib/sessions.ts"),
  "utf8",
);

function exportedFunctionBody(name: string, nextName: string) {
  const start = sessions.indexOf(`export async function ${name}(`);
  const end = sessions.indexOf(`export async function ${nextName}(`, start + 1);

  expect(start, `Expected ${name}`).toBeGreaterThanOrEqual(0);
  expect(end, `Expected ${nextName} after ${name}`).toBeGreaterThan(start);
  return sessions.slice(start, end);
}

test.describe("UX-5E session notification correctness", () => {
  test("uses the created notification once in each successful create branch", () => {
    const create = exportedFunctionBody("createSession", "updateSession");

    expect(create.match(/await notifySessionCreated\(session\);/g)).toHaveLength(2);
    expect(create).not.toContain("await notifySessionUpdated(session);");
    expect(create.indexOf("await createDelegatedSessionWithRpc(")).toBeLessThan(
      create.indexOf("await notifySessionCreated(session);"),
    );
    expect(create.lastIndexOf("await createSessionWithRpc(")).toBeLessThan(
      create.lastIndexOf("await notifySessionCreated(session);"),
    );
  });

  test("uses the updated notification once in each successful update branch", () => {
    const update = exportedFunctionBody("updateSession", "cancelSession");

    expect(update.match(/await notifySessionUpdated\(session\);/g)).toHaveLength(2);
    expect(update).not.toContain("await notifySessionCreated(session);");
    expect(update.indexOf("await updateDelegatedSessionWithRpc(")).toBeLessThan(
      update.indexOf("await notifySessionUpdated(session);"),
    );
    expect(update.lastIndexOf("await updateSessionWithRpc(")).toBeLessThan(
      update.lastIndexOf("await notifySessionUpdated(session);"),
    );
  });

  test("keeps notification timing after activity logging", () => {
    const create = exportedFunctionBody("createSession", "updateSession");
    const update = exportedFunctionBody("updateSession", "cancelSession");

    for (const body of [create, update]) {
      const notificationIndexes = Array.from(
        body.matchAll(/await notifySession(?:Created|Updated)\(session\);/g),
        (match) => match.index,
      );
      const activityIndexes = Array.from(
        body.matchAll(/await logActivity\(\{/g),
        (match) => match.index,
      );

      expect(notificationIndexes).toHaveLength(2);
      expect(
        activityIndexes.some(
          (activityIndex) => activityIndex < notificationIndexes[0],
        ),
      ).toBe(true);
      expect(
        activityIndexes.some(
          (activityIndex) =>
            activityIndex > notificationIndexes[0] &&
            activityIndex < notificationIndexes[1],
        ),
      ).toBe(true);
    }
  });

  test("leaves lifecycle, meeting, and passive capability paths separate", () => {
    expect(sessions).toContain("await notifySessionStatusChange(session);");
    expect(sessions).toContain("await notifyMeetingDetailsUpdated(session);");

    const passiveStart = sessions.indexOf("export async function canManageSession(");
    const passiveEnd = sessions.indexOf("export async function createSession(");
    const passive = sessions.slice(passiveStart, passiveEnd);

    expect(passive).not.toMatch(/notifySession|notifyMeeting/);
  });
});
