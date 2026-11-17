"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  getAuth,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  type User,
} from "firebase/auth";
import {
  collection,
  doc,
  getFirestore,
  getDoc,
  onSnapshot,
  query,
  setDoc,
  Timestamp,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import type {
  Customer, EmployeeAccount, EmployeeModule, EmployeePermissions,
  Payment, Sale, ServiceJob, ServiceVendor, ShopSettings, VendorService, WorkspaceData, WorkspaceIdentity,
} from "./types";
import { ADMIN_PERMISSIONS, DEFAULT_SETTINGS, NO_EMPLOYEE_PERMISSIONS } from "./types";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseConfigured = Object.values(config).every(Boolean);

let app: FirebaseApp | undefined;
function getFirebaseApp(): FirebaseApp {
  if (!firebaseConfigured) {
    throw new Error("Firebase is not configured. Add the NEXT_PUBLIC_FIREBASE_* values from .env.example.");
  }
  app ??= getApps().length ? getApp() : initializeApp(config);
  return app;
}

export function observeAuth(callback: (user: User | null) => void): Unsubscribe {
  return onAuthStateChanged(getAuth(getFirebaseApp()), callback);
}

function firebaseLoginEmail(identifier: string): string {
  const normalized = identifier.trim().toLowerCase();
  return normalized.includes("@") ? normalized : `${normalized}@login.ahmobiles.invalid`;
}

export function signIn(username: string, password: string): Promise<User> {
  return signInWithEmailAndPassword(getAuth(getFirebaseApp()), firebaseLoginEmail(username), password).then(({ user }) => user);
}

export function signUp(username: string, password: string): Promise<User> {
  return createUserWithEmailAndPassword(getAuth(getFirebaseApp()), firebaseLoginEmail(username), password).then(({ user }) => user);
}

export function logOut(): Promise<void> {
  return signOut(getAuth(getFirebaseApp()));
}

export async function loadWorkspaceIdentity(user: User): Promise<WorkspaceIdentity> {
  const profile = await getDoc(doc(getFirestore(getFirebaseApp()), "users", user.uid));
  if (!profile.exists()) {
    return {
      uid: user.uid,
      shopId: user.uid,
      email: user.email,
      username: user.email?.split("@")[0] || "admin",
      role: "admin",
      permissions: ADMIN_PERMISSIONS,
    };
  }

  const data = profile.data();
  if (data.role !== "employee" || data.active !== true || typeof data.shopId !== "string") {
    throw new Error("This account is inactive. Contact your shop administrator.");
  }
  return {
    uid: user.uid,
    shopId: data.shopId,
    email: user.email,
    username: String(data.username || user.email?.split("@")[0] || "employee"),
    role: "employee",
    permissions: { ...NO_EMPLOYEE_PERMISSIONS, ...data.permissions },
  };
}

export async function changeOwnPassword(currentPassword: string, newPassword: string): Promise<void> {
  const user = getAuth(getFirebaseApp()).currentUser;
  if (!user?.email) throw new Error("Sign in again before changing your password.");
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword);
}

async function staffRequest<T>(method: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  const token = await authenticatedToken();
  const response = await fetch("/api/staff", {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "The employee request failed.");
  return result;
}

export async function listEmployees(): Promise<EmployeeAccount[]> {
  const result = await staffRequest<{ employees: EmployeeAccount[] }>("GET");
  return result.employees;
}

export async function createEmployee(input: {
  username: string; password: string; permissions: EmployeePermissions;
}): Promise<EmployeeAccount> {
  const result = await staffRequest<{ employee: EmployeeAccount }>("POST", input);
  return result.employee;
}

export async function updateEmployee(employeeId: string, permissions: EmployeePermissions, active: boolean): Promise<void> {
  await staffRequest<{ success: boolean }>("PATCH", { employeeId, permissions, active });
}

export async function removeEmployee(employeeId: string): Promise<void> {
  await staffRequest<{ success: boolean }>("DELETE", { employeeId });
}

function canReadModule(identity: WorkspaceIdentity, module: EmployeeModule): boolean {
  if (identity.role === "admin") return true;
  if (identity.permissions[module] !== "none") return true;
  if (identity.permissions.overview !== "none" && ["sales", "services", "customers"].includes(module)) return true;
  if (module === "services" && identity.permissions.ready !== "none") return true;
  return (module === "sales" || module === "services") && identity.permissions.reports !== "none";
}

export function observeWorkspace(
  identity: WorkspaceIdentity,
  onData: (data: WorkspaceData) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const db = getFirestore(getFirebaseApp());
  const path = (name: string) => collection(db, "shops", identity.shopId, name);
  let sales: Sale[] = [];
  let services: ServiceJob[] = [];
  let customers: Customer[] = [];
  const vendors: ServiceVendor[] = [];
  const vendorServices: VendorService[] = [];
  let settings: ShopSettings = DEFAULT_SETTINGS;
  const loaded = { sales: false, services: false, customers: false, vendors: true, vendorServices: true, settings: false };
  const emit = () => {
    if (Object.values(loaded).every(Boolean)) onData({ sales, services, customers, vendors, vendorServices, settings });
  };
  const stops: Unsubscribe[] = [];
  const handleError = (reason: Error, section: keyof typeof loaded) => {
    loaded[section] = true;
    onError(reason);
    emit();
  };

  if (canReadModule(identity, "sales")) stops.push(onSnapshot(path("sales"), (snapshot) => {
      sales = snapshot.docs.map((item) => {
        const sale = item.data() as Omit<Sale, "id">;
        return {
          ...sale,
          id: item.id,
          createdAt: isoDate(sale.createdAt),
          invoiceDate: isoDate(sale.invoiceDate),
          payments: (sale.payments ?? []).map((payment) => ({ ...payment, date: isoDate(payment.date) })),
        };
      });
      loaded.sales = true;
      emit();
    }, (reason) => handleError(reason, "sales")));
  else loaded.sales = true;

  const readyOnlyServices = identity.role === "employee"
    && identity.permissions.services === "none"
    && identity.permissions.reports === "none"
    && identity.permissions.overview === "none"
    && identity.permissions.ready !== "none";
  const servicesRef = readyOnlyServices
    ? query(path("services"), where("status", "==", "Ready"))
    : path("services");
  if (canReadModule(identity, "services")) stops.push(onSnapshot(servicesRef, (snapshot) => {
      services = snapshot.docs.map((item) => {
        const service = item.data() as Omit<ServiceJob, "id">;
        return {
          ...service,
          id: item.id,
          createdAt: isoDate(service.createdAt),
          inDate: isoDate(service.inDate),
          readyAt: service.readyAt ? isoDate(service.readyAt) : undefined,
          deliveryOutDate: service.deliveryOutDate ? isoDate(service.deliveryOutDate) : undefined,
          payments: (service.payments ?? []).map((payment) => ({ ...payment, date: isoDate(payment.date) })),
          deliveryHistory: service.deliveryHistory?.map((entry) => ({ ...entry, date: isoDate(entry.date) })),
        };
      });
      loaded.services = true;
      emit();
    }, (reason) => handleError(reason, "services")));
  else loaded.services = true;

  if (canReadModule(identity, "customers")) stops.push(onSnapshot(path("customers"), (snapshot) => {
      customers = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Customer);
      loaded.customers = true;
      emit();
    }, (reason) => handleError(reason, "customers")));
  else loaded.customers = true;

  if (canReadModule(identity, "settings")) stops.push(onSnapshot(doc(db, "shops", identity.shopId, "settings", "profile"), (snapshot) => {
      settings = snapshot.exists() ? { ...DEFAULT_SETTINGS, ...snapshot.data() } as ShopSettings : DEFAULT_SETTINGS;
      loaded.settings = true;
      emit();
    }, (reason) => handleError(reason, "settings")));
  else loaded.settings = true;

  emit();
  return () => stops.forEach((stop) => stop());
}

function isoDate(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Timestamp) return value.toDate().toISOString();
  return "";
}

export async function writeSettings(uid: string, settings: ShopSettings): Promise<void> {
  await setDoc(doc(getFirestore(getFirebaseApp()), "shops", uid, "settings", "profile"), settings);
}

type NewRecord =
  | Omit<Sale, "id">
  | (Omit<ServiceJob, "id" | "serviceNumber"> & { serviceNumber?: string });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function createNumberedRecord(
  uid: string,
  kind: "sales" | "services",
  prefix: string,
  record: NewRecord,
): Promise<{ id: string; number: string }> {
  const token = await authenticatedToken();
  const response = await fetch("/api/records", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ kind, prefix, record }),
  });
  const responseBody = await response.text();
  if (!responseBody.trim()) {
    throw new Error(`The server returned an empty response while saving the invoice (HTTP ${response.status}). Check the sales list before trying again.`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(responseBody);
  } catch {
    throw new Error(`The server returned an invalid response while saving the invoice (HTTP ${response.status}).`);
  }
  if (!isRecord(payload)) {
    throw new Error(`The server returned an invalid response while saving the invoice (HTTP ${response.status}).`);
  }

  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : `The invoice could not be saved (HTTP ${response.status}).`);
  }
  if (typeof payload.id !== "string" || typeof payload.number !== "string") {
    throw new Error(`The server did not confirm the invoice was saved (HTTP ${response.status}). Check the sales list before trying again.`);
  }
  return { id: payload.id, number: payload.number };
}

export async function createServiceVendor(name: string, phone: string): Promise<ServiceVendor> {
  const token = await authenticatedToken();
  const response = await fetch("/api/vendors", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, phone }),
  });
  const responseBody = await response.text();
  if (!responseBody.trim()) {
    throw new Error(`The server returned an empty response while saving the vendor (HTTP ${response.status}).`);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(responseBody);
  } catch {
    throw new Error(`The server returned an invalid response while saving the vendor (HTTP ${response.status}).`);
  }
  if (!isRecord(payload)) {
    throw new Error(`The server returned an invalid response while saving the vendor (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : `The vendor could not be saved (HTTP ${response.status}).`);
  }
  if (!isRecord(payload.vendor) || typeof payload.vendor.id !== "string"
    || typeof payload.vendor.name !== "string" || typeof payload.vendor.phone !== "string"
    || typeof payload.vendor.createdAt !== "string") {
    throw new Error(`The server did not confirm the vendor was saved (HTTP ${response.status}).`);
  }
  return {
    id: payload.vendor.id,
    name: payload.vendor.name,
    phone: payload.vendor.phone,
    createdAt: payload.vendor.createdAt,
  };
}

async function vendorApiRequest(path: string, method: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown): Promise<unknown> {
  const token = await authenticatedToken();
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const responseBody = await response.text();
  let payload: unknown;
  try { payload = JSON.parse(responseBody); }
  catch { throw new Error(`The server returned an invalid response (HTTP ${response.status}).`); }
  if (!isRecord(payload)) throw new Error(`The server returned an invalid response (HTTP ${response.status}).`);
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `The request failed (HTTP ${response.status}).`);
  return payload;
}

export async function deleteServiceVendor(vendorId: string): Promise<void> {
  const payload = await vendorApiRequest("/api/vendors", "DELETE", { vendorId });
  if (!isRecord(payload) || payload.success !== true) {
    throw new Error("The server did not confirm the vendor was deleted.");
  }
}

export async function listServiceVendors(): Promise<ServiceVendor[]> {
  const payload = await vendorApiRequest("/api/vendors", "GET");
  if (!isRecord(payload) || !Array.isArray(payload.vendors)) {
    throw new Error("The server returned invalid service vendor data.");
  }
  return payload.vendors as ServiceVendor[];
}

export async function listVendorServices(): Promise<VendorService[]> {
  const payload = await vendorApiRequest("/api/vendor-services", "GET");
  if (!isRecord(payload) || !Array.isArray(payload.vendorServices)) {
    throw new Error("The server returned invalid vendor service data.");
  }
  return payload.vendorServices as VendorService[];
}

export async function createVendorService(
  service: Omit<VendorService, "id" | "createdAt">,
): Promise<VendorService> {
  const payload = await vendorApiRequest("/api/vendor-services", "POST", service);
  if (!isRecord(payload) || !isRecord(payload.vendorService)
    || typeof payload.vendorService.id !== "string"
    || typeof payload.vendorService.createdAt !== "string") {
    throw new Error("The server did not confirm the vendor service was saved.");
  }
  return { ...service, id: payload.vendorService.id, createdAt: payload.vendorService.createdAt };
}

export async function updateVendorService(
  serviceId: string,
  changes: Partial<Pick<VendorService, "status" | "deliveryDate" | "deliveryCustomer">>,
): Promise<void> {
  const payload = await vendorApiRequest("/api/vendor-services", "PATCH", { serviceId, ...changes });
  if (!isRecord(payload) || payload.success !== true) {
    throw new Error("The server did not confirm the vendor service update.");
  }
}

export async function writeRecord(
  uid: string,
  kind: "customers",
  id: string,
  record: Customer,
): Promise<void> {
  await setDoc(doc(getFirestore(getFirebaseApp()), "shops", uid, kind, id), record);
}

export async function addPayment(
  uid: string,
  kind: "sales" | "services",
  recordId: string,
  payment: Omit<Payment, "id">,
): Promise<void> {
  await mutateRecord(uid, {
    action: "payment",
    kind,
    recordId,
    payment: { ...payment, id: crypto.randomUUID() },
  });
}

export async function changeServiceStatus(
  uid: string,
  recordId: string,
  status: ServiceJob["status"],
  delivery?: Pick<ServiceJob, "readyAt" | "deliveryOutDate" | "deliveryOutPerson" | "deliveryRemarks">,
): Promise<void> {
  await mutateRecord(uid, {
    action: "service-status",
    recordId,
    status,
    ...delivery,
  });
}

export async function changeServiceVendor(uid: string, recordId: string, vendorId?: string): Promise<void> {
  await mutateRecord(uid, {
    action: "service-vendor",
    recordId,
    vendorId: vendorId ?? null,
  });
}

async function mutateRecord(uid: string, data: Record<string, unknown>): Promise<void> {
  const token = await authenticatedToken();
  const response = await fetch("/api/records", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
  const result = await response.json() as { success?: boolean; error?: string };
  if (!response.ok || !result.success) throw new Error(result.error || "The record could not be updated.");
}

async function authenticatedToken(): Promise<string> {
  const user = getAuth(getFirebaseApp()).currentUser;
  if (!user) throw new Error("Your session has expired. Sign in again to continue.");
  return user.getIdToken();
}
