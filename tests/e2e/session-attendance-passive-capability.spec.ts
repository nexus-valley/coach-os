import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

function functionBody(source: string, functionName: string) {
  const functionSignature = source.indexOf(`function ${functionName}`);
  const signature =
    functionSignature >= 0
      ? functionSignature
      : source.indexOf(`const ${functionName} =`);
  expect(signature, `Expected function ${functionName}`).toBeGreaterThanOrEqual(0);

  const declaration = source.slice(signature);
  const functionBodyStart = declaration.match(/\)\s*(?::[^\n{]+)?\s*\{/);
  const arrowBodyStart = declaration.match(/=>\s*\{/);
  const bodyMatches = [functionBodyStart, arrowBodyStart].filter(
    (match): match is RegExpMatchArray => Boolean(match?.index !== undefined),
  );
  const bodyStart = bodyMatches.sort(
    (left, right) => (left.index ?? 0) - (right.index ?? 0),
  )[0];
  const openingBrace = bodyStart
    ? signature + (bodyStart.index ?? 0) + bodyStart[0].lastIndexOf("{")
    : -1;
  expect(openingBrace, `Expected body for ${functionName}`).toBeGreaterThan(signature);

  let depth = 0;

  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;

      if (depth === 0) {
        return source.slice(openingBrace + 1, index);
      }
    }
  }

  throw new Error(`Unable to parse body for ${functionName}.`);
}

test.describe("UX-5B2 passive session and attendance capabilities", () => {
  test("keeps attendance capability discovery read-only", () => {
    const source = read("src/lib/attendance.ts");
    const capability = functionBody(source, "canCurrentUserMarkAttendance");
    const evaluation = functionBody(
      source,
      "evaluateAttendanceManagementForSession",
    );

    expect(capability).toContain("evaluateAttendanceManagementForSession(");
    expect(capability).not.toContain("ensureCanManageAttendanceForSession(");
    expect(capability).not.toContain("logActivity(");
    expect(capability).not.toContain(".rpc(");
    expect(evaluation).toContain("canManageAttendance(role)");
    expect(evaluation).toContain("getDelegatedAttendanceDecision({");
    expect(evaluation).not.toContain("logActivity(");
    expect(evaluation).not.toContain(".rpc(");
  });

  test("keeps session management capability discovery read-only", () => {
    const source = read("src/lib/sessions.ts");
    const capability = functionBody(source, "canCurrentUserManageSession");
    const evaluation = functionBody(source, "evaluateSessionManagement");

    expect(capability).toContain("evaluateSessionManagement(params)");
    expect(capability).not.toContain("ensureCanManageSession(params)");
    expect(capability).not.toContain("logActivity(");
    expect(capability).not.toContain(".rpc(");
    expect(evaluation).toContain("canManageAttendance(role)");
    expect(evaluation).toContain("getDelegatedSessionDecision({");
    expect(evaluation).toContain("isTrainerAssignedToCourse(");
    expect(evaluation).toContain("isTrainerAssignedToCohort(");
    expect(evaluation).not.toContain("logActivity(");
    expect(evaluation).not.toContain(".rpc(");
  });

  test("retains denied-action auditing in mutation enforcement", () => {
    const attendance = read("src/lib/attendance.ts");
    const sessions = read("src/lib/sessions.ts");
    const sessionsPage = read(
      "src/components/sessions/SessionsPageClient.tsx",
    );
    const attendanceEnforcement = functionBody(
      attendance,
      "ensureCanManageAttendanceForSession",
    );
    const sessionEnforcement = functionBody(sessions, "ensureCanManageSession");

    expect(attendanceEnforcement).toContain(
      "evaluateAttendanceManagementForSession(",
    );
    expect(attendanceEnforcement).toContain("logActivity({");
    expect(attendanceEnforcement).toContain('action: "access_denied"');
    expect(sessionEnforcement).toContain("evaluateSessionManagement(params)");
    expect(sessionEnforcement).toContain("logActivity({");
    expect(sessionEnforcement).toContain('denial === "trainer_scope"');
    expect(attendance).toContain(
      "const { decision, user } = await ensureCanManageAttendanceForSession(",
    );
    expect(sessions).toContain(
      "const { decision, role, user } = await ensureCanManageSession({",
    );
    expect(sessionsPage).toContain("await createSession({");
    expect(sessionsPage).not.toContain("canCurrentUserManageSession");
  });

  test("uses passive checks when Session Detail decides which controls render", () => {
    const component = read(
      "src/components/sessions/SessionDetailClient.tsx",
    );
    const loadDetail = functionBody(component, "loadDetail");

    expect(loadDetail).toContain("getSessionAttendanceRoster({");
    expect(loadDetail).toContain("canCurrentUserMarkAttendance({");
    expect(loadDetail).toContain("canCurrentUserManageSession({");
    expect(loadDetail).not.toContain("bulkMarkAttendance(");
    expect(loadDetail).not.toContain("completeSession(");
    expect(loadDetail).not.toContain("cancelSession(");
    expect(loadDetail).not.toContain("record_audit_event_secure");
  });

  test("does not introduce direct session or attendance writes", () => {
    const attendance = read("src/lib/attendance.ts");
    const sessions = read("src/lib/sessions.ts");

    expect(attendance).not.toMatch(
      /\.from\("attendance_records"\)[\s\S]{0,240}\.(insert|update|delete)\(/,
    );
    expect(sessions).not.toMatch(
      /\.from\("sessions"\)[\s\S]{0,240}\.(insert|update|delete)\(/,
    );
    expect(attendance).toContain('.rpc("mark_attendance_secure"');
    expect(attendance).toContain('.rpc("bulk_mark_attendance_secure"');
    expect(sessions).toContain('.rpc("update_session_status_secure"');
  });
});
