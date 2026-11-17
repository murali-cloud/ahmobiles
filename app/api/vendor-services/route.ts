import { randomUUID } from "node:crypto";
import { z } from "zod";
import { actorHasAccess, adminDatabase, authenticatedActor } from "@/app/lib/firebase-admin";

const vendorServiceSchema = z.object({
  vendorId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  serviceNumber: z.string().trim().min(1).max(120),
  inDate: z.string().datetime(),
  customerName: z.string().trim().min(2).max(120),
  brand: z.string().trim().min(1).max(80),
  mobileModel: z.string().trim().min(1).max(120),
  customerNumber: z.string().trim().min(7).max(20),
  status: z.enum(["Received", "In progress", "Ready", "Returned"]),
  deliveryDate: z.string().datetime().optional(),
  deliveryCustomer: z.string().trim().max(120).optional(),
  serviceCharge: z.number().finite().min(0),
}).strict();

const vendorServiceUpdateSchema = z.object({
  serviceId: z.string().uuid(),
  status: z.enum(["Received", "In progress", "Ready", "Returned"]).optional(),
  deliveryDate: z.string().datetime().optional(),
  deliveryCustomer: z.string().trim().max(120).optional(),
}).strict().refine((value) => value.status !== undefined
  || value.deliveryDate !== undefined
  || value.deliveryCustomer !== undefined, {
  message: "Provide at least one vendor service update.",
});

function responseError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function GET(request: Request) {
  let actor;
  try { actor = await authenticatedActor(request); }
  catch { return responseError("Firebase Admin credentials are not configured.", 503); }
  if (!actor) return responseError("Sign in is required.", 401);
  if (!actorHasAccess(actor, "vendors", "view")) {
    return responseError("You do not have access to vendor services.", 403);
  }

  try {
    const snapshot = await adminDatabase().collection(`shops/${actor.shopId}/vendorServices`).get();
    const vendorServices = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    return Response.json({ vendorServices });
  } catch (reason) {
    console.error("Vendor services could not be loaded.", reason);
    return responseError("Vendor services could not be loaded.", 500);
  }
}

export async function POST(request: Request) {
  let actor;
  try { actor = await authenticatedActor(request); }
  catch { return responseError("Firebase Admin credentials are not configured.", 503); }
  if (!actor) return responseError("Sign in is required.", 401);
  if (!actorHasAccess(actor, "vendors", "edit")) {
    return responseError("You do not have edit access to vendor services.", 403);
  }

  let raw: unknown;
  try { raw = await request.json(); }
  catch { return responseError("Request body must be valid JSON.", 400); }
  const parsed = vendorServiceSchema.safeParse(raw);
  if (!parsed.success) return responseError(parsed.error.issues[0]?.message ?? "Vendor service details are invalid.", 400);

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const vendorService = { id, ...parsed.data, createdAt };
  try {
    const db = adminDatabase();
    const vendorRef = db.doc(`shops/${actor.shopId}/vendors/${parsed.data.vendorId}`);
    const serviceRef = db.doc(`shops/${actor.shopId}/vendorServices/${id}`);
    const vendorServices = db.collection(`shops/${actor.shopId}/vendorServices`)
      .where("vendorId", "==", parsed.data.vendorId);
    await db.runTransaction(async (transaction) => {
      const vendor = await transaction.get(vendorRef);
      const existingServices = await transaction.get(vendorServices);
      if (!vendor.exists) throw new Error("VENDOR_NOT_FOUND");
      if (vendor.data()?.deleting === true) throw new Error("VENDOR_DELETING");
      if (existingServices.docs.some((item) => item.data().serviceNumber === parsed.data.serviceNumber)) {
        throw new Error("SERVICE_NUMBER_EXISTS");
      }
      transaction.create(serviceRef, vendorService);
    });
    return Response.json({ vendorService }, { status: 201 });
  } catch (reason) {
    if (reason instanceof Error && reason.message === "VENDOR_NOT_FOUND") {
      return responseError("The selected service vendor could not be found.", 404);
    }
    if (reason instanceof Error && reason.message === "VENDOR_DELETING") {
      return responseError("This vendor is being deleted and cannot receive new services.", 409);
    }
    if (reason instanceof Error && reason.message === "SERVICE_NUMBER_EXISTS") {
      return responseError("That service bill number is already in use for this vendor.", 409);
    }
    console.error("Vendor service creation failed.", reason);
    return responseError("The vendor service could not be saved.", 500);
  }
}

export async function PATCH(request: Request) {
  let actor;
  try { actor = await authenticatedActor(request); }
  catch { return responseError("Firebase Admin credentials are not configured.", 503); }
  if (!actor) return responseError("Sign in is required.", 401);
  if (!actorHasAccess(actor, "vendors", "edit")) {
    return responseError("You do not have edit access to vendor services.", 403);
  }

  let raw: unknown;
  try { raw = await request.json(); }
  catch { return responseError("Request body must be valid JSON.", 400); }
  const parsed = vendorServiceUpdateSchema.safeParse(raw);
  if (!parsed.success) return responseError(parsed.error.issues[0]?.message ?? "Vendor service update is invalid.", 400);

  try {
    const ref = adminDatabase().doc(`shops/${actor.shopId}/vendorServices/${parsed.data.serviceId}`);
    const snapshot = await ref.get();
    if (!snapshot.exists) return responseError("Vendor service not found.", 404);
    const changes = {
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.deliveryDate !== undefined ? { deliveryDate: parsed.data.deliveryDate } : {}),
      ...(parsed.data.deliveryCustomer !== undefined ? { deliveryCustomer: parsed.data.deliveryCustomer } : {}),
    };
    await ref.update({ ...changes, updatedAt: new Date().toISOString() });
    return Response.json({ success: true });
  } catch (reason) {
    console.error("Vendor service update failed.", reason);
    return responseError("The vendor service could not be updated.", 500);
  }
}
