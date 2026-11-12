import { getAuth } from "firebase-admin/auth";
import { z } from "zod";
import { adminDatabase, authenticatedActor, getAdminApp } from "@/app/lib/firebase-admin";
import { NO_EMPLOYEE_PERMISSIONS } from "@/app/lib/types";

const usernameSchema = z.string().trim().min(3).max(30).regex(/^[a-zA-Z0-9._-]+$/).transform((value) => value.toLowerCase());
const passwordSchema = z.string().min(8).max(128);
const accessSchema = z.enum(["none", "view", "edit"]);
const permissionsSchema = z.object({
  overview: accessSchema,
  sales: accessSchema,
  services: accessSchema,
  ready: accessSchema,
  customers: accessSchema,
  reports: accessSchema,
  settings: accessSchema,
}).strict();
const createSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  permissions: permissionsSchema,
}).strict();
const updateSchema = z.object({
  employeeId: z.string().min(1).max(128),
  permissions: permissionsSchema,
  active: z.boolean(),
}).strict();
const deleteSchema = z.object({ employeeId: z.string().min(1).max(128) }).strict();

function loginEmail(username: string): string {
  return `${username}@login.ahmobiles.invalid`;
}

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

async function adminActor(request: Request) {
  try {
    const actor = await authenticatedActor(request);
    if (!actor) return { response: errorResponse("Sign in is required.", 401) };
    if (actor.role !== "admin") return { response: errorResponse("Only the shop admin can manage employee accounts.", 403) };
    return { actor };
  } catch {
    return { response: errorResponse("Firebase Admin credentials are not configured.", 503) };
  }
}

export async function GET(request: Request) {
  const result = await adminActor(request);
  if (result.response) return result.response;
  try {
    const snapshot = await adminDatabase().collection(`shops/${result.actor.shopId}/employees`).get();
    const employees = snapshot.docs.map((employee) => ({
      id: employee.id,
      username: String(employee.get("username") ?? ""),
      permissions: { ...NO_EMPLOYEE_PERMISSIONS, ...employee.get("permissions") },
      active: employee.get("active") === true,
    }));
    return Response.json({ employees });
  } catch {
    return errorResponse("Employee accounts could not be loaded.", 500);
  }
}

export async function POST(request: Request) {
  const result = await adminActor(request);
  if (result.response) return result.response;
  let raw: unknown;
  try { raw = await request.json(); } catch { return errorResponse("Request body must be valid JSON.", 400); }
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? "Employee details are invalid.", 400);
  if (Object.values(parsed.data.permissions).every((access) => access === "none")) {
    return errorResponse("Select at least one module for this employee.", 400);
  }

  const { shopId, uid: createdBy } = result.actor;
  const { username, password, permissions } = parsed.data;
  let createdUid = "";
  try {
    const authUser = getAuth(getAdminApp());
    const created = await authUser.createUser({
      email: loginEmail(username),
      password,
      displayName: username,
      emailVerified: true,
    });
    createdUid = created.uid;
    const timestamp = new Date().toISOString();
    const profile = {
      uid: created.uid,
      shopId,
      role: "employee",
      username,
      permissions,
      active: true,
      createdAt: timestamp,
      createdBy,
    };
    const db = adminDatabase();
    const batch = db.batch();
    batch.set(db.doc(`users/${created.uid}`), profile);
    batch.set(db.doc(`shops/${shopId}/employees/${created.uid}`), profile);
    await batch.commit();
    return Response.json({ employee: { id: created.uid, username, permissions, active: true } }, { status: 201 });
  } catch (reason) {
    if (createdUid) await getAuth(getAdminApp()).deleteUser(createdUid).catch(() => undefined);
    const code = typeof reason === "object" && reason && "code" in reason ? String(reason.code) : "";
    if (code === "auth/email-already-exists") return errorResponse("That username is already in use.", 409);
    console.error("Employee account creation failed.", reason);
    return errorResponse("The employee account could not be created. Check Firebase Admin setup.", 500);
  }
}

export async function PATCH(request: Request) {
  const result = await adminActor(request);
  if (result.response) return result.response;
  let raw: unknown;
  try { raw = await request.json(); } catch { return errorResponse("Request body must be valid JSON.", 400); }
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? "Employee permissions are invalid.", 400);
  const { employeeId, permissions, active } = parsed.data;

  try {
    const db = adminDatabase();
    const profileRef = db.doc(`users/${employeeId}`);
    const employeeRef = db.doc(`shops/${result.actor.shopId}/employees/${employeeId}`);
    const profile = await profileRef.get();
    if (!profile.exists || profile.get("shopId") !== result.actor.shopId || profile.get("role") !== "employee") {
      return errorResponse("Employee account not found.", 404);
    }
    await getAuth(getAdminApp()).updateUser(employeeId, { disabled: !active });
    const batch = db.batch();
    batch.update(profileRef, { permissions, active, updatedAt: new Date().toISOString() });
    batch.update(employeeRef, { permissions, active, updatedAt: new Date().toISOString() });
    await batch.commit();
    return Response.json({ success: true });
  } catch (reason) {
    console.error("Employee account update failed.", reason);
    return errorResponse("Employee permissions could not be updated.", 500);
  }
}

export async function DELETE(request: Request) {
  const result = await adminActor(request);
  if (result.response) return result.response;
  let raw: unknown;
  try { raw = await request.json(); } catch { return errorResponse("Request body must be valid JSON.", 400); }
  const parsed = deleteSchema.safeParse(raw);
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? "Employee account is invalid.", 400);
  const { employeeId } = parsed.data;

  try {
    const db = adminDatabase();
    const profileRef = db.doc(`users/${employeeId}`);
    const profile = await profileRef.get();
    if (!profile.exists || profile.get("shopId") !== result.actor.shopId || profile.get("role") !== "employee") {
      return errorResponse("Employee account not found.", 404);
    }
    await getAuth(getAdminApp()).deleteUser(employeeId).catch((reason: unknown) => {
      if (!(typeof reason === "object" && reason && "code" in reason && reason.code === "auth/user-not-found")) throw reason;
    });
    const batch = db.batch();
    batch.delete(profileRef);
    batch.delete(db.doc(`shops/${result.actor.shopId}/employees/${employeeId}`));
    await batch.commit();
    return Response.json({ success: true });
  } catch (reason) {
    console.error("Employee account deletion failed.", reason);
    return errorResponse("Employee account could not be removed.", 500);
  }
}
