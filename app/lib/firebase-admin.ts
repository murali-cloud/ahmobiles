import "server-only";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

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

export function adminDatabase() {
  return getFirestore(getAdminApp());
}
