import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { actorHasAccess, adminDatabase, authenticatedActor } from "@/app/lib/firebase-admin";

const paymentSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  amount: z.number().finite().positive(),
  date: z.string().datetime(),
  notes: z.string().max(500).optional(),
}).strict();

const productSchema = z.object({
  id: z.string().min(1).max(80),
  brand: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(120),
  imei: z.string().trim().max(20),
  quantity: z.number().int().min(1).max(1000),
  rate: z.number().finite().min(0),
  discount: z.number().finite().min(0),
}).strict().refine((product) => product.discount <= product.quantity * product.rate, {
  message: "A product discount cannot exceed its line amount.",
});

const commonSchema = {
  customerId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
  customerName: z.string().trim().min(2).max(120),
  contactNumber: z.string().trim().min(7).max(20),
  createdAt: z.string().datetime(),
  payments: z.array(paymentSchema).max(100),
};

const saleSchema = z.object({
  ...commonSchema,
  invoiceDate: z.string().datetime(),
  products: z.array(productSchema).min(1).max(80),
  subtotal: z.number().finite().min(0),
  discount: z.number().finite().min(0),
  tax: z.number().finite().min(0),
  finalAmount: z.number().finite().min(0),
}).strict();

const serviceSchema = z.object({
  ...commonSchema,
  inDate: z.string().datetime(),
  brand: z.string().trim().min(1).max(80),
  mobileModel: z.string().trim().min(1).max(120),
  imei: z.string().trim().max(20),
  reportedFault: z.string().trim().min(3).max(2000),
  technicianNotes: z.string().max(4000),
  receivedConditions: z.array(z.string().max(80)).max(12),
  remarks: z.string().max(2000),
  status: z.literal("Received"),
  serviceAmount: z.number().finite().min(0),
  discount: z.number().finite().min(0),
  finalAmount: z.number().finite().min(0),
  readyAt: z.string().datetime().optional(),
  deliveryOutDate: z.string().datetime().optional(),
  deliveryOutPerson: z.string().max(120).optional(),
  deliveryRemarks: z.string().max(2000).optional(),
}).strict();

const createSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sales"), prefix: z.string().regex(/^[A-Z0-9]{2,6}$/), record: saleSchema }).strict(),
  z.object({ kind: z.literal("services"), prefix: z.string().regex(/^[A-Z0-9]{2,6}$/), record: serviceSchema }).strict(),
]);

const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("payment"),
    kind: z.enum(["sales", "services"]),
    recordId: z.string().uuid(),
    payment: paymentSchema.omit({ id: true }).extend({ id: z.string().max(80).optional() }),
  }).strict(),
  z.object({
    action: z.literal("service-status"),
    recordId: z.string().uuid(),
    status: z.enum(["Received", "In progress", "Ready", "Returned"]),
    deliveryOutDate: z.string().datetime().optional(),
    deliveryOutPerson: z.string().trim().min(1).max(120).optional(),
    deliveryRemarks: z.string().max(2000).optional(),
    readyAt: z.string().datetime().optional(),
  }).strict(),
]);

function responseError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function rounded(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sumPayments(payments: Array<{ amount: number }>): number {
  return rounded(payments.reduce((sum, payment) => sum + payment.amount, 0));
}

function paymentStatus(total: number, paid: number): "Paid" | "Partially paid" | "Unpaid" {
  if (paid >= total) return "Paid";
  return paid > 0 ? "Partially paid" : "Unpaid";
}

function paymentDocument(createdBy: string, kind: "sales" | "services", recordId: string, payment: {
  id: string; amount: number; date: string; notes?: string;
}) {
  return {
    paymentId: payment.id,
    relatedType: kind === "sales" ? "SALE" : "SERVICE",
    relatedDocumentId: recordId,
    amount: payment.amount,
    paymentDate: payment.date,
    notes: payment.notes ?? "",
    createdAt: FieldValue.serverTimestamp(),
    createdBy,
  };
}

export async function POST(request: Request) {
  let actor;
  try { actor = await authenticatedActor(request); }
  catch { return responseError("Server-side Firebase Admin credentials are not configured.", 503); }
  if (!actor) return responseError("Sign in is required.", 401);

  let raw: unknown;
  try { raw = await request.json(); }
  catch { return responseError("Request body must be valid JSON.", 400); }
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return responseError(parsed.error.issues[0]?.message ?? "The invoice data is invalid.", 400);
  if (!actorHasAccess(actor, parsed.data.kind, "edit")) return responseError("You do not have edit access to this module.", 403);

  try {
    const uid = actor.shopId;
    const db = adminDatabase();
    const { kind, prefix, record } = parsed.data;
    const year = Number(new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata", year: "numeric",
    }).format(new Date()));
    const total = kind === "sales"
      ? rounded(record.products.reduce((sum, product) => sum + product.quantity * product.rate - product.discount, 0) - record.discount + record.tax)
      : rounded(record.serviceAmount - record.discount);
    if (kind === "sales" && record.discount > record.products.reduce((sum, product) => sum + product.quantity * product.rate - product.discount, 0)) {
      return responseError("Invoice discount cannot exceed the product subtotal.", 400);
    }
    if (kind === "services" && record.discount > record.serviceAmount) {
      return responseError("Service discount cannot exceed the service amount.", 400);
    }
    const initialPayments = record.payments.map((payment) => ({
      ...payment,
      date: new Date().toISOString(),
    }));
    const paid = sumPayments(initialPayments);
    if (paid > total) return responseError("Payments cannot exceed the final amount.", 400);

    const recordId = randomUUID();
    const customerId = record.customerId || randomUUID();
    const counterRef = db.doc(`shops/${uid}/counters/${kind}-${year}`);
    const recordRef = db.doc(`shops/${uid}/${kind}/${recordId}`);
    const customerRef = db.doc(`shops/${uid}/customers/${customerId}`);
    const invoiceNumber = await db.runTransaction(async (transaction) => {
      const [counterSnapshot, customerSnapshot, matchingCustomers] = await Promise.all([
        transaction.get(counterRef),
        transaction.get(customerRef),
        transaction.get(db.collection(`shops/${uid}/customers`).where("phone", "==", record.contactNumber).limit(1)),
      ]);
      const existingCustomer = customerSnapshot.exists ? customerSnapshot : matchingCustomers.docs[0];
      const resolvedCustomerRef = existingCustomer?.ref ?? customerRef;
      const resolvedCustomerId = resolvedCustomerRef.id;
      if (existingCustomer) {
        const existingPhone = String(existingCustomer.data()?.phone ?? "").replace(/\D/g, "");
        const submittedPhone = record.contactNumber.replace(/\D/g, "");
        if (existingPhone && existingPhone !== submittedPhone) {
          throw new Error("CUSTOMER_CONTACT_MISMATCH");
        }
      } else {
        transaction.set(resolvedCustomerRef, {
          id: resolvedCustomerId,
          name: record.customerName,
          phone: record.contactNumber,
          email: "",
          createdAt: record.createdAt,
        });
      }

      const current = counterSnapshot.exists ? Number(counterSnapshot.data()?.value) : 0;
      if (!Number.isSafeInteger(current) || current < 0) throw new Error("COUNTER_INVALID");
      const next = current + 1;
      const number = `${prefix}-${year}-${String(next).padStart(4, "0")}`;
      const common = {
        ...record,
        id: recordId,
        customerId: resolvedCustomerId,
        createdBy: actor.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (kind === "sales") {
        const sale = record;
        const subtotal = rounded(sale.products.reduce((sum, product) => sum + product.quantity * product.rate - product.discount, 0));
        transaction.set(recordRef, {
          ...common,
          invoiceNumber: number,
          subtotal,
          finalAmount: total,
          paymentStatus: paymentStatus(total, paid),
          payments: initialPayments,
        });
      } else {
        transaction.set(recordRef, {
          ...common,
          serviceNumber: number,
          finalAmount: total,
          payments: initialPayments,
        });
      }
      transaction.set(counterRef, { value: next, updatedAt: FieldValue.serverTimestamp() });
      for (const payment of initialPayments) {
        transaction.create(db.doc(`shops/${uid}/payments/${payment.id}`), paymentDocument(actor.uid, kind, recordId, payment));
      }
      transaction.create(db.doc(`shops/${uid}/activityLogs/${randomUUID()}`), {
        type: kind === "sales" ? "SALE_CREATED" : "SERVICE_CREATED",
        relatedType: kind === "sales" ? "SALE" : "SERVICE",
        relatedDocumentId: recordId,
          customerId: resolvedCustomerId,
        customerName: record.customerName,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid,
      });
      return number;
    });
    return Response.json({ id: recordId, number: invoiceNumber }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "CUSTOMER_CONTACT_MISMATCH") {
      return responseError("The selected customer has a different contact number.", 409);
    }
    if (error instanceof Error && error.message === "COUNTER_INVALID") {
      return responseError("The invoice sequence is invalid. Contact your administrator.", 500);
    }
    console.error("Trusted invoice creation failed.", error);
    return responseError("The invoice could not be saved. Check Firebase Admin setup and try again.", 500);
  }
}

export async function PATCH(request: Request) {
  let actor;
  try { actor = await authenticatedActor(request); }
  catch { return responseError("Server-side Firebase Admin credentials are not configured.", 503); }
  if (!actor) return responseError("Sign in is required.", 401);

  let raw: unknown;
  try { raw = await request.json(); }
  catch { return responseError("Request body must be valid JSON.", 400); }
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) return responseError(parsed.error.issues[0]?.message ?? "The update data is invalid.", 400);
  const recordModule = parsed.data.action === "payment" ? parsed.data.kind : "services";
  if (!actorHasAccess(actor, recordModule, "edit")) return responseError("You do not have edit access to this module.", 403);

  try {
    const uid = actor.shopId;
    const db = adminDatabase();
    const update = parsed.data;
    if (update.action === "payment") {
      const payment = { ...update.payment, id: update.payment.id || randomUUID(), date: new Date().toISOString() };
      const recordRef = db.doc(`shops/${uid}/${update.kind}/${update.recordId}`);
      const paymentRef = db.doc(`shops/${uid}/payments/${payment.id}`);
      await db.runTransaction(async (transaction) => {
        const recordSnapshot = await transaction.get(recordRef);
        if (!recordSnapshot.exists) throw new Error("RECORD_NOT_FOUND");
        const record = recordSnapshot.data()!;
        const currentPayments = Array.isArray(record.payments) ? record.payments as Array<{ id: string; amount: number }> : [];
        if (currentPayments.some((item) => item.id === payment.id)) throw new Error("PAYMENT_EXISTS");
        const total = update.kind === "sales"
          ? Number(record.finalAmount)
          : Number(record.serviceAmount) - Number(record.discount);
        const paid = sumPayments(currentPayments);
        if (!Number.isFinite(total) || !Number.isFinite(paid) || payment.amount > total - paid) {
          throw new Error("PAYMENT_EXCEEDS_BALANCE");
        }
        transaction.update(recordRef, {
          payments: [...currentPayments, payment],
          ...(update.kind === "sales" ? { paymentStatus: paymentStatus(total, paid + payment.amount) } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.create(paymentRef, paymentDocument(actor.uid, update.kind, update.recordId, payment));
        transaction.create(db.doc(`shops/${uid}/activityLogs/${randomUUID()}`), {
          type: "PAYMENT_RECORDED",
          relatedType: update.kind === "sales" ? "SALE" : "SERVICE",
          relatedDocumentId: update.recordId,
          amount: payment.amount,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: actor.uid,
        });
      });
      return Response.json({ success: true });
    }

    const recordRef = db.doc(`shops/${uid}/services/${update.recordId}`);
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(recordRef);
      if (!snapshot.exists) throw new Error("RECORD_NOT_FOUND");
      const record = snapshot.data()!;
      if (record.status === "Returned") throw new Error("JOB_ALREADY_RETURNED");
      const patch: Record<string, unknown> = {
        status: update.status,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (update.status === "Ready") patch.readyAt = new Date().toISOString();
      if (update.status === "Returned") {
        if (record.status !== "Ready" || !update.deliveryOutDate || !update.deliveryOutPerson) {
          throw new Error("HANDOVER_DETAILS_REQUIRED");
        }
        patch.deliveryOutDate = update.deliveryOutDate;
        patch.deliveryOutPerson = update.deliveryOutPerson;
        patch.deliveryRemarks = update.deliveryRemarks ?? "";
        const history = Array.isArray(record.deliveryHistory) ? record.deliveryHistory : [];
        patch.deliveryHistory = [...history, {
          date: update.deliveryOutDate,
          person: update.deliveryOutPerson,
          remarks: update.deliveryRemarks ?? "",
        }];
      }
      transaction.update(recordRef, patch);
      transaction.create(db.doc(`shops/${uid}/activityLogs/${randomUUID()}`), {
        type: `SERVICE_${update.status.toUpperCase().replaceAll(" ", "_")}`,
        relatedType: "SERVICE",
        relatedDocumentId: update.recordId,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid,
      });
    });
    return Response.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "RECORD_NOT_FOUND") return responseError("That record could not be found.", 404);
    if (message === "PAYMENT_EXISTS") return responseError("This payment has already been recorded.", 409);
    if (message === "PAYMENT_EXCEEDS_BALANCE") return responseError("Payment cannot exceed the remaining balance.", 400);
    if (message === "HANDOVER_DETAILS_REQUIRED") return responseError("A ready job and delivery person are required before handover.", 400);
    if (message === "JOB_ALREADY_RETURNED") return responseError("This service job has already been returned.", 409);
    console.error("Trusted record update failed.", error);
    return responseError("The record could not be updated. Check Firebase Admin setup and try again.", 500);
  }
}
