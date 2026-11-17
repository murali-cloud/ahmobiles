import type { Customer, Sale, ServiceJob, ServiceVendor, ShopSettings, VendorService, WorkspaceData } from "./types";
import { DEFAULT_SETTINGS, EMPTY_WORKSPACE } from "./types";
import { normalizePhoneNumber } from "./phone";

const STORAGE_KEY = "ahmobiles.workspace.v1";

export function readLocalWorkspace(): WorkspaceData {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return EMPTY_WORKSPACE;
    const parsed: Partial<WorkspaceData> = JSON.parse(saved);
    return {
      sales: parsed.sales ?? [],
      services: parsed.services ?? [],
      customers: parsed.customers ?? [],
      vendors: parsed.vendors ?? [],
      vendorServices: parsed.vendorServices ?? [],
      settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
    };
  } catch (error) {
    console.error("Could not load the local workspace.", error);
    throw new Error("Your browser workspace could not be read. Clear its saved data or connect Firebase.");
  }
}

export function writeLocalWorkspace(data: WorkspaceData): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function makeCustomer(name: string, phone: string, customers: Customer[]): Customer {
  const normalizedPhone = normalizePhoneNumber(phone);
  const existing = customers.find((customer) => normalizePhoneNumber(customer.phone) === normalizedPhone);
  return existing ?? { id: crypto.randomUUID(), name, phone, createdAt: new Date().toISOString() };
}

export function nextInvoiceNumber(kind: "sales" | "services", prefix: string, records: Array<Sale | ServiceJob>): string {
  const year = Number(new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", year: "numeric",
  }).format(new Date()));
  const field = kind === "sales" ? "invoiceNumber" : "serviceNumber";
  const current = records.reduce((highest, record) => {
    const value = record[field as keyof typeof record];
    if (typeof value !== "string") return highest;
    const match = value.match(new RegExp(`^${prefix}-${year}-(\\d+)$`));
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `${prefix}-${year}-${String(current + 1).padStart(4, "0")}`;
}

export function nextVendorServiceNumber(vendorId: string, records: VendorService[]): string {
  const year = Number(new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", year: "numeric",
  }).format(new Date()));
  const current = records.reduce((highest, service) => {
    if (service.vendorId !== vendorId) return highest;
    const match = service.serviceNumber.match(new RegExp(`^VSRV-${year}-(\\d+)$`));
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `VSRV-${year}-${String(current + 1).padStart(4, "0")}`;
}

export function updateLocalRecord(
  data: WorkspaceData,
  kind: "sales" | "services" | "customers",
  id: string,
  record: Sale | ServiceJob | Customer,
): WorkspaceData {
  const records = data[kind] as Array<Sale | ServiceJob | Customer>;
  const updated = records.some((item) => item.id === id)
    ? records.map((item) => item.id === id ? record : item)
    : [record, ...records];
  return { ...data, [kind]: updated };
}

export function updateLocalVendor(data: WorkspaceData, vendor: ServiceVendor): WorkspaceData {
  const vendors = data.vendors.some((item) => item.id === vendor.id)
    ? data.vendors.map((item) => item.id === vendor.id ? vendor : item)
    : [vendor, ...data.vendors];
  return { ...data, vendors };
}

export function updateLocalVendorService(data: WorkspaceData, service: VendorService): WorkspaceData {
  const vendorServices = data.vendorServices.some((item) => item.id === service.id)
    ? data.vendorServices.map((item) => item.id === service.id ? service : item)
    : [service, ...data.vendorServices];
  return { ...data, vendorServices };
}

export function patchSettings(data: WorkspaceData, settings: ShopSettings): WorkspaceData {
  return { ...data, settings };
}
