import { randomUUID } from "node:crypto";
import { z } from "zod";
import { actorHasAccess, adminDatabase, authenticatedActor } from "@/app/lib/firebase-admin";

const vendorServiceSchema = z.object({
  vendorId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  serviceNumber: z.string().trim().min(1).max(120),
  inDate: z.string().datetime(),
  customerName: z.string().trim().min(2).max(120),
  customerAddress: z.string().trim().max(500).optional().default(""),
  brand: z.string().trim().min(1).max(80),
  mobileModel: z.string().trim().min(1).max(120),
  customerNumber: z.string().trim().min(7).max(20),
  status: z.enum(["Received", "In progress", "Ready", "Returned"]),
  returnOutcome: z.enum(["Not repaired"]).optional(),
  receivedCondition: z.string().trim().min(1, "Enter received condition.").max(200),
  fault: z.string().trim().max(1000).default(""),
  deliveryDate: z.string().datetime().optional(),
  deliveryCustomer: z.string().trim().max(120).optional(),
  serviceCharge: z.number().finite().min(0),
  tax: z.number().finite().min(0).optional(),
}).strict().transform((value) => value.returnOutcome === "Not repaired"
  ? { ...value, status: "Returned" as const, serviceCharge: 0, tax: 0 }
  : value);

const vendorServiceUpdateSchema = z.object({
  serviceId: z.string().uuid(),
  customerName: z.string().trim().min(2).max(120).optional(),
  customerAddress: z.string().trim().max(500).optional(),
  customerNumber: z.string().trim().min(7).max(20).optional(),
  brand: z.string().trim().min(1).max(80).optional(),
  mobileModel: z.string().trim().min(1).max(120).optional(),
  receivedCondition: z.string().trim().min(1).max(200).optional(),
  fault: z.string().trim().max(1000).optional(),
  serviceNumber: z.string().trim().min(1).max(120).optional(),
  inDate: z.string().datetime().optional(),
  status: z.enum(["Received", "In progress", "Ready", "Returned"]).optional(),
  returnOutcome: z.enum(["Not repaired"]).optional(),
  deliveryDate: z.string().datetime().optional(),
  deliveryCustomer: z.string().trim().max(120).optional(),
  serviceCharge: z.number().finite().min(0).optional(),
  tax: z.number().finite().min(0).optional(),
}).strict().refine((value) => Object.keys(value).length > 1, {
  message: "Provide at least one vendor service update.",
});

const vendorServiceDeleteSchema = z.object({
  serviceId: z.string().uuid(),
}).strict();

function responseError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function GET(request: Request) {
  let actor;
  try { actor = await authenticatedActor(request); }
  catch { return responseError("Firebase Admin credentials are not configured.", 503); }
  if (!actor) return responseError("Sign in is required.", 401);
  if (!actorHasAccess(actor, "vendors", "view")) return responseError("You do not have access to vendor services.", 403);
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
  if (!actorHasAccess(actor, "vendors", "edit")) return responseError("You do not have edit access to vendor services.", 403);
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
    const vendorServices = db.collection(`shops/${actor.shopId}/vendorServices`).where("vendorId", "==", parsed.data.vendorId);
    await db.runTransaction(async (transaction) => {
      const vendor = await transaction.get(vendorRef);
      const existingServices = await transaction.get(vendorServices);
      if (!vendor.exists) throw new Error("VENDOR_NOT_FOUND");
      if (vendor.data()?.deleting === true) throw new Error("VENDOR_DELETING");
      if (existingServices.docs.some((item) => item.data().serviceNumber === parsed.data.serviceNumber)) throw new Error("SERVICE_NUMBER_EXISTS");
      transaction.create(serviceRef, vendorService);
    });
    return Response.json({ vendorService }, { status: 201 });
  } catch (reason) {
    if (reason instanceof Error && reason.message === "VENDOR_NOT_FOUND") return responseError("The selected service vendor could not be found.", 404);
    if (reason instanceof Error && reason.message === "VENDOR_DELETING") return responseError("This vendor is being deleted and cannot receive new services.", 409);
    if (reason instanceof Error && reason.message === "SERVICE_NUMBER_EXISTS") return responseError("That service bill number is already in use for this vendor.", 409);
    console.error("Vendor service creation failed.", reason);
    return responseError("The vendor service could not be saved.", 500);
  }
}

export async function PATCH(request: Request) {
  let actor;
  try { actor = await authenticatedActor(request); }
  catch { return responseError("Firebase Admin credentials are not configured.", 503); }
  if (!actor) return responseError("Sign in is required.", 401);
  if (!actorHasAccess(actor, "vendors", "edit")) return responseError("You do not have edit access to vendor services.", 403);
  let raw: unknown;
  try { raw = await request.json(); }
  catch { return responseError("Request body must be valid JSON.", 400); }
  const parsed = vendorServiceUpdateSchema.safeParse(raw);
  if (!parsed.success) return responseError(parsed.error.issues[0]?.message ?? "Vendor service update is invalid.", 400);
  try {
    const ref = adminDatabase().doc(`shops/${actor.shopId}/vendorServices/${parsed.data.serviceId}`);
    const snapshot = await ref.get();
    if (!snapshot.exists) return responseError("Vendor service not found.", 404);
    const isRefund = parsed.data.returnOutcome === "Not repaired";
    const { serviceId, ...rest } = parsed.data;
    const changes: Record<string, unknown> = {
      ...rest,
      ...(isRefund ? { status: "Returned" as const, serviceCharge: 0 } : {}),
    };
    await ref.update({ ...changes, updatedAt: new Date().toISOString() });
    return Response.json({ success: true });
  } catch (reason) {
    console.error("Vendor service update failed.", reason);
    return responseError("The vendor service could not be updated.", 500);
  }
}

export async function DELETE(request: Request) {
  let actor;
  try { actor = await authenticatedActor(request); }
  catch { return responseError("Firebase Admin credentials are not configured.", 503); }
  if (!actor) return responseError("Sign in is required.", 401);
  if (!actorHasAccess(actor, "vendors", "edit")) return responseError("You do not have edit access to vendor services.", 403);
  let raw: unknown;
  try { raw = await request.json(); }
  catch { return responseError("Request body must be valid JSON.", 400); }
  const parsed = vendorServiceDeleteSchema.safeParse(raw);
  if (!parsed.success) return responseError(parsed.error.issues[0]?.message ?? "Invalid delete request.", 400);
  try {
    const ref = adminDatabase().doc(`shops/${actor.shopId}/vendorServices/${parsed.data.serviceId}`);
    const snapshot = await ref.get();
    if (!snapshot.exists) return responseError("Vendor service not found.", 404);
    await ref.delete();
    return Response.json({ success: true });
  } catch (reason) {
    console.error("Vendor service delete failed.", reason);
    return responseError("The vendor service could not be deleted.", 500);
  }
}
