import { randomUUID } from "node:crypto";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { actorHasAccess, adminDatabase, authenticatedActor } from "@/app/lib/firebase-admin";
import { normalizePhoneNumber } from "@/app/lib/phone";

const vendorSchema = z.object({
  name: z.string().trim().min(2, "Enter the vendor name.").max(120),
  phone: z.string().trim().min(7, "Enter the vendor's mobile number.").max(20),
}).strict();
const deleteVendorSchema = z.object({
  vendorId: z.string().uuid(),
}).strict();

function responseError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  let actor;
  try { actor = await authenticatedActor(request); }
  catch { return responseError("Firebase Admin credentials are not configured.", 503); }
  if (!actor) return responseError("Sign in is required.", 401);
  if (!actorHasAccess(actor, "vendors", "edit")) {
    return responseError("You do not have edit access to service vendors.", 403);
  }

  let raw: unknown;
  try { raw = await request.json(); }
  catch { return responseError("Request body must be valid JSON.", 400); }
  const parsed = vendorSchema.safeParse(raw);
  if (!parsed.success) return responseError(parsed.error.issues[0]?.message ?? "Vendor details are invalid.", 400);

  const { name, phone } = parsed.data;
  const normalizedPhone = normalizePhoneNumber(phone);
  if (normalizedPhone.length < 7) return responseError("Enter a valid vendor mobile number.", 400);

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const vendor = { id, name, phone, createdAt };
  try {
    const db = adminDatabase();
    const vendors = db.collection(`shops/${actor.shopId}/vendors`);
    await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(vendors.where("normalizedPhone", "==", normalizedPhone).limit(1));
      if (!existing.empty) throw new Error("VENDOR_PHONE_EXISTS");
      transaction.create(vendors.doc(id), { ...vendor, normalizedPhone });
    });
    return Response.json({ vendor }, { status: 201 });
  } catch (reason) {
    if (reason instanceof Error && reason.message === "VENDOR_PHONE_EXISTS") {
      return responseError("A service vendor with this mobile number already exists.", 409);
    }
    console.error("Service vendor creation failed.", reason);
    return responseError("The service vendor could not be saved. Check Firebase Admin setup.", 500);
  }
}

export async function GET(request: Request) {
  let actor;
  try { actor = await authenticatedActor(request); }
  catch { return responseError("Firebase Admin credentials are not configured.", 503); }
  if (!actor) return responseError("Sign in is required.", 401);
  if (!actorHasAccess(actor, "vendors", "view")) {
    return responseError("You do not have access to service vendors.", 403);
  }

  try {
    const snapshot = await adminDatabase().collection(`shops/${actor.shopId}/vendors`).get();
    const vendors = snapshot.docs.filter((item) => item.data().deleting !== true).map((item) => {
      const { id, name, phone, createdAt } = item.data();
      return { id, name, phone, createdAt };
    });
    return Response.json({ vendors });
  } catch (reason) {
    console.error("Service vendors could not be loaded.", reason);
    return responseError("Service vendors could not be loaded.", 500);
  }
}

export async function DELETE(request: Request) {
  let actor;
  try { actor = await authenticatedActor(request); }
  catch { return responseError("Firebase Admin credentials are not configured.", 503); }
  if (!actor) return responseError("Sign in is required.", 401);
  if (!actorHasAccess(actor, "vendors", "edit")) {
    return responseError("You do not have edit access to service vendors.", 403);
  }

  let raw: unknown;
  try { raw = await request.json(); }
  catch { return responseError("Request body must be valid JSON.", 400); }
  const parsed = deleteVendorSchema.safeParse(raw);
  if (!parsed.success) return responseError("A valid service vendor is required.", 400);

  const db = adminDatabase();
  const vendorRef = db.doc(`shops/${actor.shopId}/vendors/${parsed.data.vendorId}`);
  const vendorServices = db.collection(`shops/${actor.shopId}/vendorServices`);
  const services = db.collection(`shops/${actor.shopId}/services`);
  try {
    await db.runTransaction(async (transaction) => {
      const vendor = await transaction.get(vendorRef);
      if (!vendor.exists) throw new Error("VENDOR_NOT_FOUND");
      transaction.set(vendorRef, { deleting: true }, { merge: true });
    });

    let deletedServices = 0;
    while (true) {
      const snapshot = await vendorServices.where("vendorId", "==", parsed.data.vendorId).limit(400).get();
      if (snapshot.empty) break;
      const batch = db.batch();
      snapshot.docs.forEach((service) => batch.delete(service.ref));
      await batch.commit();
      deletedServices += snapshot.size;
    }

    let unlinkedJobs = 0;
    while (true) {
      const snapshot = await services.where("vendorId", "==", parsed.data.vendorId).limit(400).get();
      if (snapshot.empty) break;
      const batch = db.batch();
      snapshot.docs.forEach((service) => batch.update(service.ref, {
        vendorId: FieldValue.delete(),
        updatedAt: new Date().toISOString(),
      }));
      await batch.commit();
      unlinkedJobs += snapshot.size;
    }

    await vendorRef.delete();
    return Response.json({ success: true, deletedServices, unlinkedJobs });
  } catch (reason) {
    if (reason instanceof Error && reason.message === "VENDOR_NOT_FOUND") {
      return responseError("The service vendor could not be found.", 404);
    }
    try {
      const snapshot = await vendorRef.get();
      if (snapshot.exists) await vendorRef.update({ deleting: FieldValue.delete() });
    } catch (restoreError) {
      console.error("Could not restore the vendor after deletion failed.", restoreError);
    }
    console.error("Service vendor deletion failed.", reason);
    return responseError("The vendor could not be completely deleted. Please retry.", 500);
  }
}
