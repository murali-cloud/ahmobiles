import "server-only";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import {
  ADMIN_PERMISSIONS, NO_EMPLOYEE_PERMISSIONS,
  type EmployeeModule, type EmployeePermissions, type ModuleAccess,
} from "./types";

export function getAdminApp() {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase Admin credentials are missing. Configure the FIREBASE_ADMIN_* server environment variables.");
  }
  const existing = getApps().find((app) => app.name === "ahmobiles-admin");
  return existing ?? initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    projectId,
  }, "ahmobiles-admin");
}

export async function authenticatedShop(request: Request): Promise<string | null> {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return null;
  const auth = getAuth(getAdminApp());
  try {
    const claims = await auth.verifyIdToken(token);
    return claims.uid;
  } catch {
    return null;
  }
}

export type WorkspaceActor = {
  uid: string;
  shopId: string;
  role: "admin" | "employee";
  permissions: EmployeePermissions;
};

export async function authenticatedActor(request: Request): Promise<WorkspaceActor | null> {
  const uid = await authenticatedShop(request);
  if (!uid) return null;

  const profile = await adminDatabase().doc(`users/${uid}`).get();
  if (!profile.exists) {
    return { uid, shopId: uid, role: "admin", permissions: ADMIN_PERMISSIONS };
  }

  const data = profile.data();
  if (data?.role !== "employee" || data.active !== true || typeof data.shopId !== "string") return null;
  return {
    uid,
    shopId: data.shopId,
    role: "employee",
    permissions: { ...NO_EMPLOYEE_PERMISSIONS, ...data.permissions } as EmployeePermissions,
  };
}

export function actorHasAccess(
  actor: WorkspaceActor,
  module: EmployeeModule,
  access: ModuleAccess,
): boolean {
  if (actor.role === "admin") return true;
  const level = actor.permissions[module];
  if (access === "edit") return level === "edit";
  if (level === "view" || level === "edit") return true;
  return (module === "sales" || module === "services")
    && (actor.permissions.reports === "view" || actor.permissions.reports === "edit");
}

export function adminDatabase() {
  return getFirestore(getAdminApp());
}
