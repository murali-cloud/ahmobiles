"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import {
  collection,
  doc,
  getFirestore,
  onSnapshot,
  setDoc,
  Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import type { Customer, Payment, Sale, ServiceJob, ShopSettings, WorkspaceData } from "./types";
import { DEFAULT_SETTINGS } from "./types";

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

export function signIn(email: string, password: string): Promise<User> {
  return signInWithEmailAndPassword(getAuth(getFirebaseApp()), email, password).then(({ user }) => user);
}

export function signUp(email: string, password: string): Promise<User> {
  return createUserWithEmailAndPassword(getAuth(getFirebaseApp()), email, password).then(({ user }) => user);
}

export function logOut(): Promise<void> {
  return signOut(getAuth(getFirebaseApp()));
}

export function observeWorkspace(
  uid: string,
  onData: (data: WorkspaceData) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const db = getFirestore(getFirebaseApp());
  const path = (name: string) => collection(db, "shops", uid, name);
  let sales: Sale[] = [];
  let services: ServiceJob[] = [];
  let customers: Customer[] = [];
  let settings: ShopSettings = DEFAULT_SETTINGS;
  let loaded = 0;
  const emit = () => {
    loaded += 1;
    if (loaded >= 4) onData({ sales, services, customers, settings });
  };
  const stops = [
    onSnapshot(path("sales"), (snapshot) => {
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
      emit();
    }, onError),
    onSnapshot(path("services"), (snapshot) => {
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
      emit();
    }, onError),
    onSnapshot(path("customers"), (snapshot) => {
      customers = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Customer);
      emit();
    }, onError),
    onSnapshot(doc(db, "shops", uid, "settings", "profile"), (snapshot) => {
      settings = snapshot.exists() ? { ...DEFAULT_SETTINGS, ...snapshot.data() } as ShopSettings : DEFAULT_SETTINGS;
      emit();
    }, onError),
  ];
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

type NewRecord = Omit<Sale, "id" | "invoiceNumber"> | Omit<ServiceJob, "id" | "serviceNumber">;

export async function createNumberedRecord(
  uid: string,
  kind: "sales" | "services",
  prefix: string,
  record: NewRecord,
): Promise<{ id: string; number: string }> {
  const token = await authenticatedToken(uid);
  const response = await fetch("/api/records", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ kind, prefix, record }),
  });
  const result = await response.json() as { id?: string; number?: string; error?: string };
  if (!response.ok || !result.id || !result.number) throw new Error(result.error || "The invoice could not be saved.");
  return { id: result.id, number: result.number };
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

async function mutateRecord(uid: string, data: Record<string, unknown>): Promise<void> {
  const token = await authenticatedToken(uid);
  const response = await fetch("/api/records", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
  const result = await response.json() as { success?: boolean; error?: string };
  if (!response.ok || !result.success) throw new Error(result.error || "The record could not be updated.");
}

async function authenticatedToken(uid: string): Promise<string> {
  const user = getAuth(getFirebaseApp()).currentUser;
  if (!user || user.uid !== uid) throw new Error("Your session has expired. Sign in again to continue.");
  return user.getIdToken();
}
