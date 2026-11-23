"use client";

import {
  Activity, ArrowLeft, ArrowRight, ArrowUpRight, BarChart3,
  Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ClipboardList,
  Clock3, CreditCard, Download, Eye, EyeOff, FileText, Filter, LayoutDashboard, LogOut, Menu, MoreHorizontal, Store,
  Pencil, Plus, Printer, ScanLine, Search, Settings, ShieldCheck, Smartphone, Trash2, Users, Wrench, X, Zap, MessageCircle,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { jsPDF } from "jspdf";
import {
  addPayment, changeOwnPassword, changeServiceStatus, changeServiceVendor, createEmployee, createNumberedRecord, createVendorService, deleteServiceVendor as deleteServiceVendorCloud, firebaseConfigured,
  createServiceVendor, listEmployees, listServiceVendors, listVendorServices, loadWorkspaceIdentity, logOut, observeAuth, observeWorkspace, removeEmployee, updateVendorService as updateVendorServiceCloud,
  deleteVendorService as deleteVendorServiceCloud, deleteRecord, editSaleRecord, editServiceRecord,
  signIn, updateEmployee, writeRecord, writeSettings,
} from "./lib/firebase";
import {
  makeCustomer, nextInvoiceNumber, nextVendorServiceNumber, patchSettings, readLocalWorkspace,
  updateLocalRecord, updateLocalVendor, updateLocalVendorService, writeLocalWorkspace,
  deleteLocalRecord, deleteLocalVendorService,
} from "./lib/local-data";
import { normalizePhoneNumber } from "./lib/phone";
import {
  DEFAULT_SETTINGS, EMPLOYEE_MODULES, NO_EMPLOYEE_PERMISSIONS, type Customer, type EmployeeAccount,
  type EmployeeModule, type EmployeePermissions, type ModuleAccess, type Payment, type PaymentStatus,
  type ProductCategory, type ProductLine, type Sale, type ServiceJob, type ServiceStatus, type ServiceVendor, type VendorService, type ShopSettings, type WorkspaceData, type WorkspaceIdentity,
} from "./lib/types";
import { customerSchema, loginSchema, saleSchema, serviceFormSchema, serviceSchema, serviceVendorSchema, vendorServiceFormSchema } from "./lib/validation";

const BRAND_LOGO_PATH = "/ah-mobiles-logo.png";
const AUTH_BRAND_LOGO_PATH = "/ah-mobiles-logo-nav.png";

const NAV = [
  { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { label: "Sales", href: "/sales", icon: CreditCard },
  { label: "Services", href: "/services", icon: Wrench },
  // { label: "Ready for delivery", href: "/services/ready", icon: CheckCircle2 },
  { label: "Service vendors", href: "/vendors", icon: Store },
  { label: "Customers", href: "/customers", icon: Users },
  { label: "Reports", href: "/reports", icon: BarChart3 },
];
const CONDITIONS = ["Good condition", "Display damaged", "Body damaged", "Back panel damaged", "Screen cracked", "Power issue", "Other"];
const EMPTY_DATA: WorkspaceData = {
  sales: [], services: [], customers: [], vendors: [], vendorServices: [], settings: DEFAULT_SETTINGS,
};
type ChartPeriod = "Week" | "Month" | "Year" | "Custom";
type RevenuePeriod = "Today" | "This week" | "This month" | "This year" | "All time";
const REVENUE_PERIODS: RevenuePeriod[] = ["Today", "This week", "This month", "This year", "All time"];

function deviceLabel(item: { category?: ProductCategory; brand: string; mobileModel?: string; model?: string; productName?: string }): string {
  if (item.category === "Accessories" && item.productName) return item.productName;
  const model = item.mobileModel ?? item.model ?? "";
  return `${item.brand}${model ? ` ${model}` : ""}`.trim();
}

function money(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR", maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function pdfMoney(value: number): string {
  return money(value).replace("₹", "INR").replace(/\u00a0/g, " ");
}

function dateInputValue(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dateKey(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : dateInputValue(date);
}

function isInRevenuePeriod(value: string, period: RevenuePeriod): boolean {
  if (period === "All time") return true;
  const key = dateKey(value);
  if (!key) return false;
  const today = dateInputValue();
  if (key > today) return false;
  if (period === "Today") return key === today;
  if (period === "This month") return key.slice(0, 7) === today.slice(0, 7);
  if (period === "This year") return key.slice(0, 4) === today.slice(0, 4);

  const weekStart = new Date(`${today}T00:00:00Z`);
  weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
  return key >= weekStart.toISOString().slice(0, 10);
}

function businessYear(date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", year: "numeric",
  }).format(date));
}

function businessDateTime(value: string): string {
  return new Date(`${value}T12:00:00+05:30`).toISOString();
}

function dateLabel(value: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function whatsappUrl(phone: string, message?: string): string | undefined {
  const digits = phone.replace(/\D/g, "");
  const number = digits.length === 10
    ? `91${digits}`
    : digits.startsWith("0") && digits.length === 11
      ? `91${digits.slice(1)}`
      : digits;
  if (number.length < 7) return undefined;
  return `https://wa.me/${number}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
}

function WhatsAppAction({ phone, customerName }: { phone: string; customerName: string }) {
  const url = whatsappUrl(phone);
  return <button
    className="row-action whatsapp-action"
    type="button"
    disabled={!url}
    aria-label={`Open WhatsApp chat with ${customerName}`}
    title={url ? "WhatsApp customer" : "No valid customer contact number"}
    onClick={() => { if (url) window.open(url, "_blank", "noopener,noreferrer"); }}
  >
    <MessageCircle size={15} />
  </button>;
}

type BarcodeDetectorResult = { rawValue: string };
type BrowserBarcodeDetector = { detect: (source: HTMLVideoElement) => Promise<BarcodeDetectorResult[]> };
type BrowserBarcodeDetectorConstructor = {
  new(options?: { formats?: string[] }): BrowserBarcodeDetector;
  getSupportedFormats: () => Promise<string[]>;
};

function ScanBarcodeButton({ onScan }: { onScan: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return <>
    <button className="scan-barcode-button" type="button" onClick={() => setOpen(true)}>
      <ScanLine size={15} /> Scan
    </button>
    {open && <BarcodeScannerModal onClose={close} onDetected={onScan} />}
  </>;
}

function BarcodeScannerModal({ onClose, onDetected }: {
  onClose: () => void;
  onDetected: (value: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectedRef = useRef(onDetected);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    let active = true;
    let scanTimer: number | undefined;
    let stream: MediaStream | undefined;
    const videoElement = videoRef.current;
    const stopTracks = () => stream?.getTracks().forEach((track) => track.stop());
    const stopCamera = () => {
      stopTracks();
      if (videoRef.current) videoRef.current.srcObject = null;
    };
    const startScanning = async () => {
      const Detector = (window as Window & { BarcodeDetector?: BrowserBarcodeDetectorConstructor }).BarcodeDetector;
      if (!Detector) {
        setError("Camera barcode scanning is not supported in this browser. Use a connected barcode scanner or enter the IMEI manually.");
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Camera access is unavailable. Use a connected barcode scanner or enter the IMEI manually.");
        return;
      }
      try {
        const supportedFormats = await Detector.getSupportedFormats();
        const formats = ["code_128", "code_39", "code_93", "codabar", "ean_13", "ean_8", "itf", "upc_a", "upc_e", "qr_code", "data_matrix", "pdf417", "aztec"]
          .filter((format) => supportedFormats.includes(format));
        if (!formats.length) {
          setError("This browser cannot read supported barcode formats. Use a connected barcode scanner or enter the IMEI manually.");
          return;
        }
        const detector = new Detector({ formats });
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (!active) {
          stopTracks();
          return;
        }
        const video = videoElement;
        if (!video) {
          stopTracks();
          return;
        }
        video.srcObject = stream;
        await video.play();
        if (!active) return;
        setScanning(true);
        const scanFrame = async () => {
          if (!active) return;
          if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            scanTimer = window.setTimeout(() => { void scanFrame(); }, 200);
            return;
          }
          try {
            const results = await detector.detect(video);
            const value = results.find((result) => result.rawValue.trim())?.rawValue.trim();
            if (value) {
              if (value.length > 20) {
                stopCamera();
                setScanning(false);
                setError("The scanned value exceeds 20 characters. Scan the IMEI barcode or enter the value manually.");
                return;
              }
              onDetectedRef.current(value);
              onClose();
              return;
            }
          } catch (reason) {
            if (active) {
              stopCamera();
              setScanning(false);
              setError(reason instanceof Error ? reason.message : "The barcode could not be read.");
            }
            return;
          }
          scanTimer = window.setTimeout(() => { void scanFrame(); }, 200);
        };
        void scanFrame();
      } catch (reason) {
        stopCamera();
        if (reason instanceof DOMException && reason.name === "NotAllowedError") {
          setError("Camera permission was denied. Allow camera access, or use a connected barcode scanner or enter the IMEI manually.");
        } else {
          setError(reason instanceof Error ? reason.message : "Could not start the camera scanner.");
        }
      }
    };
    void startScanning();
    return () => {
      active = false;
      if (scanTimer !== undefined) window.clearTimeout(scanTimer);
      stopTracks();
      if (videoElement) videoElement.srcObject = null;
    };
  }, [onClose]);

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal-box barcode-scanner-modal" role="dialog" aria-modal="true" aria-labelledby="barcode-scanner-title">
      <div className="modal-header">
        <div><span className="eyebrow">IMEI SCANNER</span><h2 id="barcode-scanner-title">Scan barcode</h2></div>
        <button className="icon-btn" type="button" onClick={onClose} aria-label="Close barcode scanner"><X size={18} /></button>
      </div>
      <div className="barcode-scanner-content">
        <video ref={videoRef} className="barcode-scanner-video" autoPlay muted playsInline aria-label="Camera barcode preview" />
        {error
          ? <p className="barcode-scanner-error" role="alert">{error}</p>
          : <p className="field-hint" role="status">{scanning ? "Point the camera at the barcode on the device or box." : "Starting camera…"}</p>}
      </div>
      <div className="modal-footer"><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
    </section>
  </div>;
}

function paymentTotal(payments: Payment[]): number {
  return payments.reduce((sum, payment) => sum + payment.amount, 0);
}

function serviceRefundTotal(service: ServiceJob): number {
  return (service.refunds ?? []).reduce((sum, refund) => sum + refund.amount, 0);
}

function serviceNetRevenue(service: ServiceJob): number {
  // Unrepaired jobs have no earned service revenue. For other jobs, refunds
  // reduce the revenue attributed to that service bill.
  if (service.returnOutcome === "Not repaired") return 0;
  return Math.max(0, service.serviceAmount - service.discount - serviceRefundTotal(service));
}

function servicePaid(service: ServiceJob): number {
  // Unrepaired returns are treated as having no payment collected.
  if (service.returnOutcome === "Not repaired") return 0;
  return Math.max(0, paymentTotal(service.payments) - serviceRefundTotal(service));
}

function serviceDue(service: ServiceJob): number {
  // No service charge is due when the device is returned unrepaired.
  if (service.returnOutcome === "Not repaired") return 0;
  return Math.max(0, service.serviceAmount - service.discount + (service.tax || 0) - servicePaid(service));
}

function statusOf(total: number, paid: number): PaymentStatus {
  if (paid >= total) return "Paid";
  return paid > 0 ? "Partially paid" : "Unpaid";
}

function newId(): string {
  return crypto.randomUUID();
}

type ToastInfo = { text: string; tone: "success" | "error" };

const NAVIGATE_EVENT = "workspace-navigate";

export function clientNavigate(url: string) {
  if (typeof window !== "undefined") {
    if (window.location.pathname !== url) {
      window.history.pushState(null, "", url);
    }
    window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: url }));
  }
}

export default function Workspace() {
  const pathname = usePathname();
  const router = useRouter();
  const [clientPath, setClientPath] = useState<string>(() => (typeof window !== "undefined" ? window.location.pathname : pathname));
  const currentPath = clientPath || pathname;

  const navigate = useCallback((url: string) => {
    clientNavigate(url);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setClientPath(window.location.pathname);
    };
    const handleCustomNav = (event: Event) => {
      const customEvent = event as CustomEvent<string>;
      setClientPath(customEvent.detail || window.location.pathname);
    };
    window.addEventListener("popstate", handlePopState);
    window.addEventListener(NAVIGATE_EVENT, handleCustomNav);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener(NAVIGATE_EVENT, handleCustomNav);
    };
  }, []);

  useEffect(() => {
    setClientPath(pathname);
  }, [pathname]);

  const [data, setData] = useState<WorkspaceData>(EMPTY_DATA);
  const [user, setUser] = useState<WorkspaceIdentity | null>(null);
  const [ready, setReady] = useState(!firebaseConfigured);
  const [loading, setLoading] = useState(firebaseConfigured);
  const [authLoading, setAuthLoading] = useState(firebaseConfigured);
  const [authError, setAuthError] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState<ToastInfo | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [period, setPeriod] = useState<ChartPeriod>("Week");
  const [revenuePeriod, setRevenuePeriod] = useState<RevenuePeriod>("This month");
  const [chartFrom, setChartFrom] = useState("");
  const [chartTo, setChartTo] = useState("");
  const [modal, setModal] = useState<ReactNode>(null);
  const [busy, setBusy] = useState(false);
  const pendingCloudRecords = useRef<{ sales: Map<string, Sale>; services: Map<string, ServiceJob> }>({
    sales: new Map(),
    services: new Map(),
  });
  const pendingOwnerUid = useRef<string | null>(null);

  useEffect(() => {
    if (pathname === "/login" && user) router.replace("/dashboard");
  }, [pathname, router, user]);

  const notify = useCallback((text: string, tone: ToastInfo["tone"] = "success") => {
    setToast({ text, tone });
    window.setTimeout(() => setToast(null), 3600);
  }, []);
  const notifyFromError = useCallback((reason: unknown) =>
    notify(reason instanceof Error ? reason.message : "Something went wrong. Please try again.", "error"), [notify]);
  const handleLogout = useCallback(async () => {
    try {
      await logOut();
    } catch (reason) {
      notifyFromError(reason);
    }
  }, [notifyFromError]);

  useEffect(() => {
    if (!firebaseConfigured) return;
    try {
      let active = true;
      const stop = observeAuth((authUser) => {
        if (pendingOwnerUid.current !== (authUser?.uid ?? null)) {
          pendingCloudRecords.current.sales.clear();
          pendingCloudRecords.current.services.clear();
          pendingOwnerUid.current = authUser?.uid ?? null;
        }
        setUser(null);
        setAuthLoading(Boolean(authUser));
        setLoading(Boolean(authUser));
        if (!authUser) {
          setAuthLoading(false);
          setData(EMPTY_DATA);
          setReady(true);
          return;
        }
        void loadWorkspaceIdentity(authUser).then((identity) => {
          if (!active || pendingOwnerUid.current !== authUser.uid) return;
          setUser(identity);
          setAuthLoading(false);
        }).catch((reason: unknown) => {
          if (!active || pendingOwnerUid.current !== authUser.uid) return;
          setAuthError(reason instanceof Error ? reason.message : "Could not load this account.");
          setAuthLoading(false);
          void logOut();
        });
      });
      return () => { active = false; stop(); };
    } catch (initError) {
      Promise.resolve().then(() => {
        setAuthError(initError instanceof Error ? initError.message : "Firebase could not be initialized.");
        setAuthLoading(false);
      });
    }
  }, []);

  useEffect(() => {
    if (!firebaseConfigured) {
      Promise.resolve().then(() => {
        try {
          setData(readLocalWorkspace());
        } catch (loadError) {
          setError(loadError instanceof Error ? loadError.message : "Could not load browser workspace.");
        } finally {
          setReady(true);
        }
      });
      return;
    }
  }, []);

  useEffect(() => {
    if (!firebaseConfigured || !user) return;
    try {
      return observeWorkspace(user, (workspace) => {
        const mergePending = <T extends { id: string }>(incoming: T[], pending: Map<string, T>) => {
          const incomingIds = new Set(incoming.map((record) => record.id));
          for (const id of incomingIds) pending.delete(id);
          return [...pending.values(), ...incoming.filter((record) => !pending.has(record.id))];
        };
        setData((current) => ({
          ...workspace,
          sales: mergePending(workspace.sales, pendingCloudRecords.current.sales),
          services: mergePending(workspace.services, pendingCloudRecords.current.services),
          vendors: current.vendors,
          vendorServices: current.vendorServices,
        }));
        setLoading(false);
        setReady(true);
      }, (streamError) => {
        setError(streamError.message);
        setLoading(false);
        setReady(true);
      });
    } catch (streamError) {
      Promise.resolve().then(() => {
        setError(streamError instanceof Error ? streamError.message : "Could not connect to Firestore.");
        setLoading(false);
        setReady(true);
      });
    }
  }, [user]);

  useEffect(() => {
    if (!firebaseConfigured || !user) return;
    const canReadVendorData = user.role === "admin"
      || user.permissions.vendors !== "none"
      || user.permissions.services !== "none"
      || user.permissions.ready !== "none"
      || user.permissions.overview !== "none"
      || user.permissions.reports !== "none";
    if (!canReadVendorData) {
      setData((current) => ({ ...current, vendors: [], vendorServices: [] }));
      return;
    }
    let active = true;
    Promise.all([listServiceVendors(), listVendorServices()])
  .then(([vendors, vendorServices]) => {
    if (active) {
      setData((current) => ({
        ...current,
        vendors,
        vendorServices,
      }));
    }
  })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Could not load service vendors.");
      });
    return () => { active = false; };
  }, [user]);

  const persist = useCallback(async (nextData: WorkspaceData) => {
    if (!firebaseConfigured) writeLocalWorkspace(nextData);
    setData(nextData);
  }, []);

  const saveCustomer = useCallback(async (name: string, phone: string, email = "", address = ""): Promise<Customer> => {
    const customer = makeCustomer(name.trim(), phone.trim(), data.customers);
    const complete = { ...customer, email: email || customer.email || "", address: address.trim() || customer.address || "" };
    if (!data.customers.some((item) => item.id === customer.id)
      || (address.trim() && address.trim() !== customer.address)
      || (email && email !== customer.email)) {
      if (firebaseConfigured && user) {
        const transactionEditor = user.role === "employee"
          && (user.permissions.sales === "edit" || user.permissions.services === "edit");
        if (user.role !== "employee" || user.permissions.customers === "edit" || !transactionEditor) {
          await writeRecord(user.shopId, "customers", complete.id, complete);
          setData((current) => ({
            ...current,
            customers: current.customers.some((item) => item.id === complete.id)
              ? current.customers.map((item) => item.id === complete.id ? complete : item)
              : [complete, ...current.customers],
          }));
        }
      }
      else await persist(updateLocalRecord(data, "customers", complete.id, complete));
    }
    return complete;
  }, [data, persist, user]);

  const saveSale = useCallback(async (draft: Omit<Sale, "id">): Promise<Sale> => {
    if (data.sales.some((sale) => sale.invoiceNumber === draft.invoiceNumber.trim())) {
      throw new Error("That invoice number is already in use.");
    }
    const customer = await saveCustomer(draft.customerName, draft.contactNumber, "", draft.customerAddress);
    const savedDraft = { ...draft, customerAddress: draft.customerAddress?.trim() || customer.address || "" };
    if (firebaseConfigured && user) {
      const created = await createNumberedRecord(user.shopId, "sales", data.settings.salesPrefix || "SAL", {
        ...savedDraft, customerId: customer.id,
      });
      const sale = { ...savedDraft, id: created.id, invoiceNumber: created.number, customerId: customer.id };
      pendingCloudRecords.current.sales.set(sale.id, sale);
      setData((current) => ({ ...current, sales: [sale, ...current.sales.filter((item) => item.id !== sale.id)] }));
      return sale;
    }
    const id = newId();
    const invoiceNumber = draft.invoiceNumber.trim();
    const sale: Sale = { ...savedDraft, id, invoiceNumber, customerId: customer.id };
    const customers = [customer, ...data.customers.filter((item) => item.id !== customer.id)];
    await persist({ ...data, customers, sales: [sale, ...data.sales] });
    return sale;
  }, [data, persist, saveCustomer, user]);

  const saveService = useCallback(async (draft: Omit<ServiceJob, "id" | "serviceNumber"> & { serviceNumber?: string }): Promise<ServiceJob> => {
    if (draft.vendorId && !data.vendors.some((vendor) => vendor.id === draft.vendorId)) {
      throw new Error("The selected service vendor could not be found.");
    }
    const customer = await saveCustomer(draft.customerName, draft.contactNumber, "", draft.customerAddress);
    const savedDraft = { ...draft, customerAddress: draft.customerAddress?.trim() || customer.address || "" };
    if (firebaseConfigured && user) {
      const created = await createNumberedRecord(user.shopId, "services", data.settings.servicePrefix || "SRV", {
        ...savedDraft, customerId: customer.id,
      });
      const service = { ...savedDraft, id: created.id, serviceNumber: created.number, customerId: customer.id };
      pendingCloudRecords.current.services.set(service.id, service);
      setData((current) => ({ ...current, services: [service, ...current.services.filter((item) => item.id !== service.id)] }));
      return service;
    }
    const id = newId();
    const serviceNumber = draft.serviceNumber?.trim() || nextInvoiceNumber("services", data.settings.servicePrefix || "SRV", data.services);
    const service: ServiceJob = { ...savedDraft, id, serviceNumber, customerId: customer.id };
    const customers = [customer, ...data.customers.filter((item) => item.id !== customer.id)];
    await persist({ ...data, customers, services: [service, ...data.services] });
    return service;
  }, [data, persist, saveCustomer, user]);

  const updateSale = useCallback(async (sale: Sale) => {
    if (firebaseConfigured && user) {
      const current = data.sales.find((item) => item.id === sale.id);
      const payment = sale.payments.at(-1);
      if (!current || sale.payments.length !== current.payments.length + 1 || !payment) {
        throw new Error("Sales invoices can only be updated by recording a new payment.");
      }
      const newPayment = { amount: payment.amount, date: payment.date, notes: payment.notes };
      await addPayment(user.shopId, "sales", sale.id, newPayment);
    } else await persist(updateLocalRecord(data, "sales", sale.id, sale));
  }, [data, persist, user]);

  const updateService = useCallback(async (service: ServiceJob) => {
    if (firebaseConfigured && user) {
      const current = data.services.find((item) => item.id === service.id);
      if (!current) throw new Error("The service job could not be found.");
      // A handover is saved immediately after its final payment. Check for a
      // status transition first so the already-recorded payment is not sent
      // to the payment endpoint a second time from the handover modal.
      if (service.status !== current.status) {
        await changeServiceStatus(user.shopId, service.id, service.status, {
          readyAt: service.readyAt,
          deliveryOutDate: service.deliveryOutDate,
          deliveryOutPerson: service.deliveryOutPerson,
          deliveryRemarks: service.deliveryRemarks,
          returnOutcome: service.returnOutcome,
          refundAmount: service.refundAmount,
        });
        setData((latest) => ({
          ...latest,
          services: latest.services.map((item) => item.id === service.id
            ? {
              ...item,
              ...service,
              serviceAmount: service.returnOutcome === "Not repaired" ? 0 : service.serviceAmount,
              finalAmount: service.returnOutcome === "Not repaired" ? 0 : service.finalAmount,
              payments: service.returnOutcome === "Not repaired" ? [] : service.payments,
            }
            : item),
        }));
      } else if (service.payments.length === current.payments.length + 1) {
        const payment = service.payments.at(-1);
        if (!payment) throw new Error("The payment details are incomplete.");
        const newPayment = { amount: payment.amount, date: payment.date, notes: payment.notes };
        await addPayment(user.shopId, "services", service.id, newPayment);
        setData((latest) => ({
          ...latest,
          services: latest.services.map((item) => item.id === service.id
            ? { ...item, payments: [...item.payments, payment] }
            : item),
        }));
      } else if (service.vendorId !== current.vendorId) {
        await changeServiceVendor(user.shopId, service.id, service.vendorId);
      } else {
        throw new Error("Service records can only be changed through status or payment actions.");
      }
    } else await persist(updateLocalRecord(data, "services", service.id, service));
  }, [data, persist, user]);

  const assignServiceVendor = useCallback((service: ServiceJob, vendorId?: string) => {
    void updateService({ ...service, vendorId })
      .then(() => notify("Service vendor updated."))
      .catch(notifyFromError);
  }, [notify, notifyFromError, updateService]);

  const saveShopSettings = useCallback(async (settings: ShopSettings) => {
    if (firebaseConfigured && user) await writeSettings(user.shopId, settings);
    else await persist(patchSettings(data, settings));
  }, [data, persist, user]);

  const saveServiceVendor = useCallback(async (name: string, phone: string): Promise<ServiceVendor> => {
    const normalizedPhone = normalizePhoneNumber(phone);
    if (data.vendors.some((vendor) => normalizePhoneNumber(vendor.phone) === normalizedPhone)) {
      throw new Error("A service vendor with this mobile number already exists.");
    }
    const vendor = firebaseConfigured && user
      ? await createServiceVendor(name.trim(), phone.trim())
      : { id: newId(), name: name.trim(), phone: phone.trim(), createdAt: new Date().toISOString() };
    if (firebaseConfigured && user) {
      setData((current) => ({ ...current, vendors: [vendor, ...current.vendors.filter((item) => item.id !== vendor.id)] }));
    } else {
      await persist(updateLocalVendor(data, vendor));
    }
    return vendor;
  }, [data, persist, user]);

  const deleteServiceVendor = useCallback((vendor: ServiceVendor) => {
    const linkedEntries = data.vendorServices.filter((service) => service.vendorId === vendor.id).length;
    const linkedJobs = data.services.filter((service) => service.vendorId === vendor.id).length;
    setModal(<VendorDeleteModal
      vendor={vendor}
      linkedEntries={linkedEntries}
      linkedJobs={linkedJobs}
      onCancel={() => setModal(null)}
      onConfirm={async () => {
        if (firebaseConfigured && user) {
          await deleteServiceVendorCloud(vendor.id);
          setData((current) => ({
            ...current,
            vendors: current.vendors.filter((item) => item.id !== vendor.id),
            vendorServices: current.vendorServices.filter((item) => item.vendorId !== vendor.id),
            services: current.services.map((service) => service.vendorId === vendor.id
              ? { ...service, vendorId: undefined }
              : service),
          }));
        } else {
          await persist({
            ...data,
            vendors: data.vendors.filter((item) => item.id !== vendor.id),
            vendorServices: data.vendorServices.filter((item) => item.vendorId !== vendor.id),
            services: data.services.map((service) => service.vendorId === vendor.id
              ? { ...service, vendorId: undefined }
              : service),
          });
        }
        setModal(null);
        navigate("/vendors");
        notify(`${vendor.name} and its vendor service entries were deleted.`);
      }}
    />);
  }, [data, navigate, notify, persist, user]);

  const saveVendorService = useCallback(async (
    draft: Omit<VendorService, "id" | "createdAt">,
  ): Promise<VendorService> => {
    if (!data.vendors.some((vendor) => vendor.id === draft.vendorId)) {
      throw new Error("The selected service vendor could not be found. Reload the vendor list and try again.");
    }
    if (data.vendorServices.some((service) =>
      service.vendorId === draft.vendorId && service.serviceNumber === draft.serviceNumber.trim())) {
      throw new Error("That service bill number is already in use for this vendor.");
    }
    const service = firebaseConfigured && user
      ? await createVendorService(draft)
      : { ...draft, id: newId(), createdAt: new Date().toISOString() };
    if (firebaseConfigured && user) {
      setData((current) => ({ ...current, vendorServices: [service, ...current.vendorServices] }));
    } else {
      await persist(updateLocalVendorService(data, service));
    }
    return service;
  }, [data, persist, user]);

  const updateVendorServiceRecord = useCallback(async (
    service: VendorService,
    changes: Partial<VendorService>,
  ) => {
    if (firebaseConfigured && user) {
      await updateVendorServiceCloud(service.id, changes);
      setData((current) => ({
        ...current,
        vendorServices: current.vendorServices.map((item) => item.id === service.id ? { ...item, ...changes } : item),
      }));
    } else {
      await persist(updateLocalVendorService(data, { ...service, ...changes }));
    }
  }, [data, persist, user]);

  const confirmDeleteSale = (sale: Sale) => {
    setModal(
      <ConfirmDeleteModal
        title="Delete sales invoice?"
        itemName={sale.invoiceNumber}
        description={`Are you sure you want to delete invoice ${sale.invoiceNumber} for customer "${sale.customerName}"? Any recorded payments for this invoice will also be deleted. This action cannot be undone.`}
        confirmLabel="Delete invoice"
        onCancel={() => setModal(null)}
        onConfirm={async () => {
          if (firebaseConfigured && user) {
            await deleteRecord(user.shopId, "sales", sale.id);
          } else {
            await persist(deleteLocalRecord(data, "sales", sale.id));
          }
          setData((current) => ({
            ...current,
            sales: current.sales.filter((item) => item.id !== sale.id),
          }));
          setModal(null);
          notify(`Sales invoice ${sale.invoiceNumber} deleted.`);
          if (route === "sales" && routeId) {
            navigate("/sales");
          }
        }}
      />
    );
  };

  const openEditSale = (sale: Sale) => {
    setModal(
      <EditSaleModal
        sale={sale}
        onClose={() => setModal(null)}
        onSave={async (updated) => {
          if (firebaseConfigured && user) {
            await editSaleRecord(user.shopId, sale.id, updated);
          } else {
            await persist(updateLocalRecord(data, "sales", sale.id, { ...sale, ...updated }));
          }
          setData((current) => ({
            ...current,
            sales: current.sales.map((item) => item.id === sale.id ? { ...item, ...updated } : item),
          }));
          setModal(null);
          notify(`Sales invoice ${sale.invoiceNumber} updated.`);
        }}
      />
    );
  };

  const confirmDeleteService = (service: ServiceJob) => {
    setModal(
      <ConfirmDeleteModal
        title="Delete service job?"
        itemName={service.serviceNumber}
        description={`Are you sure you want to delete service job ${service.serviceNumber} for customer "${service.customerName}"? Any recorded payments and status records for this device will be deleted. This action cannot be undone.`}
        confirmLabel="Delete service"
        onCancel={() => setModal(null)}
        onConfirm={async () => {
          if (firebaseConfigured && user) {
            await deleteRecord(user.shopId, "services", service.id);
          } else {
            await persist(deleteLocalRecord(data, "services", service.id));
          }
          setData((current) => ({
            ...current,
            services: current.services.filter((item) => item.id !== service.id),
          }));
          setModal(null);
          notify(`Service job ${service.serviceNumber} deleted.`);
          if (route === "services" && routeId) {
            navigate("/services");
          }
        }}
      />
    );
  };

  const openEditService = (service: ServiceJob) => {
    setModal(
      <EditServiceModal
        service={service}
        vendors={data.vendors}
        onClose={() => setModal(null)}
        onSave={async (updated) => {
          if (firebaseConfigured && user) {
            await editServiceRecord(user.shopId, service.id, updated);
          } else {
            await persist(updateLocalRecord(data, "services", service.id, { ...service, ...updated }));
          }
          setData((current) => ({
            ...current,
            services: current.services.map((item) => item.id === service.id ? { ...item, ...updated } : item),
          }));
          setModal(null);
          notify(`Service job ${service.serviceNumber} updated.`);
        }}
      />
    );
  };

  const confirmDeleteVendorService = (service: VendorService) => {
    setModal(
      <ConfirmDeleteModal
        title="Delete vendor service?"
        itemName={service.serviceNumber}
        description={`Are you sure you want to delete vendor service ${service.serviceNumber} for customer "${service.customerName}"? This action cannot be undone.`}
        confirmLabel="Delete vendor service"
        onCancel={() => setModal(null)}
        onConfirm={async () => {
          if (firebaseConfigured && user) {
            await deleteVendorServiceCloud(service.id);
          } else {
            await persist(deleteLocalVendorService(data, service.id));
          }
          setData((current) => ({
            ...current,
            vendorServices: current.vendorServices.filter((item) => item.id !== service.id),
          }));
          setModal(null);
          notify(`Vendor service ${service.serviceNumber} deleted.`);
        }}
      />
    );
  };

  const viewVendorServiceDetail = (service: VendorService) => {
    const vendor = data.vendors.find((item) => item.id === service.vendorId);
    if (!vendor) {
      notify("The service vendor could not be found. Reload and try again.", "error");
      return;
    }
    const normalizedCustomerNumber = normalizePhoneNumber(service.customerNumber);
    const customer = normalizedCustomerNumber.length >= 7
      ? data.customers.find((item) => normalizePhoneNumber(item.phone) === normalizedCustomerNumber)
      : undefined;
    setModal(<VendorServiceDetailModal
      service={{ ...service, customerAddress: service.customerAddress || customer?.address || "" }}
      vendor={vendor}
      canEdit={canEditModule("vendors")}
      onClose={() => setModal(null)}
      onDelete={confirmDeleteVendorService}
      onSave={async (updated) => {
        await updateVendorServiceRecord(service, updated);
        notify("Vendor service details updated.");
      }}
    />);
  };

  const confirmVendorServiceNotRepaired = (service: VendorService) => {
    setModal(<VendorServiceNotRepairedConfirm
      service={service}
      onCancel={() => setModal(null)}
      onConfirm={async () => {
        await updateVendorServiceRecord(service, { status: "Returned", returnOutcome: "Not repaired", serviceCharge: 0 });
        setModal(null);
        notify("Vendor service marked as refunded. Service charge set to ₹0.");
      }}
    />);
  };

  const changeVendorServiceStatus = useCallback(
  (service: VendorService, status: ServiceStatus) => {
    const current =
      data.vendorServices.find((item) => item.id === service.id) ?? service;

    // Prevent changing a service that has already been returned or refunded.
    if (current.status === "Returned" || current.returnOutcome === "Not repaired") {
      notify(
        "This vendor service has already been returned or refunded. Its status can no longer be changed.",
        "error"
      );
      return;
    }

    // If status is Returned, require delivery details through a popup.
    if (status === "Returned") {
      const vendor = data.vendors.find(
        (item) => item.id === current.vendorId
      );

      if (!vendor) {
        notify("Service vendor could not be found.", "error");
        return;
      }

      setModal(
        <VendorServiceDeliveryModal
          service={current}
          vendor={vendor}
          onClose={() => setModal(null)}
          onSave={async (delivery) => {
            await updateVendorServiceRecord(current, {
              ...delivery,
              status: "Returned",
            });

            setModal(null);
            notify("Vendor service returned successfully. Status is now locked.");
          }}
        />
      );

      return;
    }

    // Normal status changes (Received, In progress, Ready).
    void updateVendorServiceRecord(current, { status })
      .then(() => notify("Vendor service status updated."))
      .catch(notifyFromError);
  },
  [
    data.vendorServices,
    data.vendors,
    notify,
    notifyFromError,
    updateVendorServiceRecord,
  ]
);

  const showServiceDeliveryModal = (current: ServiceJob) => {
    setModal(<DeliveryModal
      service={current}
      onCancel={() => setModal(null)}
      onSave={async (delivery) => {
        try {
          await updateService({
            ...current,
            ...delivery,
            status: "Returned",
            deliveryHistory: [...(current.deliveryHistory ?? []), {
              date: delivery.deliveryOutDate ?? new Date().toISOString(),
              person: delivery.deliveryOutPerson ?? "",
              staff: user?.username ?? "Staff",
              staffId: user?.uid ?? "",
              remarks: delivery.deliveryRemarks ?? "",
            }],
            deliveryOutStaff: user?.username ?? "Staff",
            deliveryOutStaffId: user?.uid ?? "",
          });
          setModal(null);
          notify("Device marked as returned.");
        } catch (reason) { notifyFromError(reason); }
      }}
    />);
  };

  const showNotRepairedModal = (current: ServiceJob) => {
    const alreadyRefunded = (current.refunds ?? []).reduce((sum, item) => sum + item.amount, 0);
    const refundable = Math.max(0, paymentTotal(current.payments) - alreadyRefunded);
    setModal(<NotRepairedModal
      service={current}
      refundable={refundable}
      onCancel={() => setModal(null)}
      onSave={async ({ deliveryOutDate, deliveryOutPerson, deliveryRemarks, refundAmount }) => {
        try {
          const refund = refundAmount > 0 ? {
            id: newId(), amount: refundAmount, date: new Date().toISOString(),
            notes: "Advance refunded — product not repaired",
          } : undefined;
          await updateService({
            ...current,
            status: "Returned",
            returnOutcome: "Not repaired",
            payments: [],
            serviceAmount: 0,
            finalAmount: 0,
            refundAmount,
            refunds: refund ? [...(current.refunds ?? []), refund] : (current.refunds ?? []),
            deliveryOutDate, deliveryOutPerson, deliveryRemarks,
            deliveryOutStaff: user?.username ?? "Staff",
            deliveryOutStaffId: user?.uid ?? "",
            deliveryHistory: [...(current.deliveryHistory ?? []), {
              date: deliveryOutDate, person: deliveryOutPerson,
              staff: user?.username ?? "Staff", staffId: user?.uid ?? "",
              remarks: deliveryRemarks ?? "Product not repaired; advance refunded: " + money(refundAmount),
            }],
          });
          setModal(null);
          notify(`Device returned without repair. Refund recorded: ${money(refundAmount)}.`);
        } catch (reason) { notifyFromError(reason); }
      }}
    />);
  };

  const setServiceStatus = (service: ServiceJob, status: ServiceStatus) => {
    const current = data.services.find((item) => item.id === service.id) ?? service;
    if (current.status === "Returned") {
      notify("This service job has already been returned and its status cannot be changed.");
      return;
    }
    if (status === "Returned") {
      const due = Math.max(
        0,
        current.serviceAmount - current.discount - servicePaid(current)
      );

      if (due > 0) {
        setModal(
          <div className="modal-backdrop payment-required-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
            <div className="modal-box payment-required-modal" role="dialog" aria-modal="true" aria-labelledby="payment-required-title">
              <div className="payment-required-icon"><CreditCard size={27} /></div>
              <span className="eyebrow">PAYMENT REQUIRED</span>
              <h2 id="payment-required-title">Balance payment pending</h2>
              <p className="payment-required-copy">This device cannot be marked as returned until the outstanding balance is collected.</p>
              <div className="payment-required-summary">
                <div><span>Service bill</span><strong>{current.serviceNumber}</strong></div>
                <div><span>Customer</span><strong>{current.customerName}</strong></div>
                <div className="payment-required-due"><span>Amount due</span><strong>{money(due)}</strong></div>
              </div>
              <div className="payment-required-note"><CheckCircle2 size={16} /><span>Once the full balance is paid, the handover confirmation will open automatically.</span></div>
              <div className="modal-footer payment-required-actions">
                <Button variant="secondary" onClick={() => setModal(null)}>Not now</Button>
                <Button onClick={() => { setModal(null); openPayment("service", current.id, true); }}><CreditCard size={16} /> Collect payment</Button>
              </div>
            </div>
            <style>{`@keyframes paymentRequiredIn{from{opacity:0;transform:translateY(18px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}@keyframes paymentRequiredPulse{0%,100%{box-shadow:0 0 0 0 rgba(245,158,11,.18)}50%{box-shadow:0 0 0 12px rgba(245,158,11,0)}}.payment-required-backdrop{backdrop-filter:blur(7px);background:rgba(15,23,42,.48)}.payment-required-modal{width:min(460px,calc(100vw - 32px));padding:30px;border:1px solid rgba(255,255,255,.75);border-radius:22px;box-shadow:0 28px 90px rgba(15,23,42,.28);animation:paymentRequiredIn .32s cubic-bezier(.2,.8,.2,1) both}.payment-required-icon{width:58px;height:58px;border-radius:18px;display:grid;place-items:center;margin-bottom:18px;color:#b45309;background:linear-gradient(145deg,#fff7df,#ffedb3);animation:paymentRequiredPulse 2s ease-in-out infinite}.payment-required-modal h2{margin:8px 0;font-size:24px;letter-spacing:-.7px;color:#172033}.payment-required-copy{margin:0 0 20px;color:#667085;line-height:1.6}.payment-required-summary{padding:15px 17px;border:1px solid #edf0f5;border-radius:15px;background:#fafbfc}.payment-required-summary>div{display:flex;justify-content:space-between;gap:16px;padding:7px 0;color:#667085;font-size:13px}.payment-required-summary strong{color:#273449;text-align:right}.payment-required-summary .payment-required-due{margin-top:8px;padding-top:13px;border-top:1px solid #e6eaf0;align-items:center}.payment-required-due span{font-weight:600;color:#344054}.payment-required-due strong{font-size:23px;color:#b45309}.payment-required-note{display:flex;gap:9px;align-items:flex-start;margin:16px 0 4px;color:#667085;font-size:12px;line-height:1.5}.payment-required-note svg{flex:none;color:#16a085;margin-top:1px}.payment-required-actions{padding:18px 0 0;margin-top:8px}.payment-required-actions button:last-child{box-shadow:0 7px 18px rgba(37,99,235,.2)}`}</style>
          </div>
        );
        return;
      }
      if (current.status !== "Ready") {
        notify("Mark this service job as Ready before handing it back.");
        return;
      }
      showServiceDeliveryModal(current);
      return;
    }
    void updateService({ ...current, status, readyAt: status === "Ready" ? new Date().toISOString() : current.readyAt })
      .then(() => notify("Service status updated."))
      .catch(notifyFromError);
  };

  if (authLoading) return <AuthLoading />;
  if (!firebaseConfigured || !user) {
    return <AuthScreen
      error={firebaseConfigured
        ? authError
        : "Firebase Authentication is not configured. Add the NEXT_PUBLIC_FIREBASE_* values to .env.local and restart the app."}
      disabled={!firebaseConfigured}
      onSubmit={async (username, password) => {
        if (!firebaseConfigured) return;
        setAuthError("");
        const parsed = loginSchema.safeParse({ username, password });
        if (!parsed.success) {
          setAuthError(parsed.error.issues[0]?.message ?? "Check your details.");
          return;
        }
        try {
          await signIn(username, password);
        } catch (reason) {
          const code = reason instanceof Error ? reason.message : "Authentication failed.";
          setAuthError(code.replace("Firebase: ", "").replace(/\s*\(auth\/[^)]+\)\.?/g, ""));
        }
      }}
    />;
  }

  const segments = currentPath.split("/").filter(Boolean);
  const route = segments[0] ?? "dashboard";
  const subroute = segments[1] ?? "";
  const routeId = segments[2] ?? (subroute && !["create", "ready"].includes(subroute) ? subroute : "");
  const activeHref = route === "dashboard" ? "/dashboard"
    : route === "sales" ? "/sales"
    : route === "vendors" ? "/vendors"
    : route === "services" && subroute === "ready" ? "/services/ready"
    : route === "services" ? "/services"
    : `/${route}`;
  const title = routeTitle(route, subroute);
  const canViewModule = (module: EmployeeModule) => !firebaseConfigured || user?.role === "admin" || user?.permissions[module] !== "none";
  const canEditModule = (module: EmployeeModule) => !firebaseConfigured || user?.role === "admin" || user?.permissions[module] === "edit";
  const isReadyServiceDetail = route === "services" && Boolean(routeId)
    && data.services.some((service) => (service.id === routeId || service.serviceNumber === routeId) && service.status === "Ready")
    && canViewModule("ready");
  const routeModule: EmployeeModule | null = route === "dashboard" ? "overview"
    : route === "sales" ? "sales"
    : route === "vendors" ? "vendors"
    : route === "services" && (subroute === "ready" || isReadyServiceDetail) ? "ready"
    : route === "services" ? "services"
    : route === "customers" ? "customers"
    : route === "reports" ? "reports"
    : route === "settings" ? "settings"
    : null;
  const requiresEdit = (route === "sales" || route === "services") && subroute === "create";
  const canAccessReady = canViewModule("ready") || canViewModule("services") || canViewModule("reports");
  const accessDenied = user?.role === "employee" && (
    (routeModule === "ready" ? !canAccessReady : routeModule !== null && !canViewModule(routeModule))
    || (route === "dashboard" && !canViewModule("overview"))
    || (requiresEdit && routeModule !== null && !canEditModule(routeModule))
  );
  const visibleNav = NAV.filter(({ href }) => href === "/dashboard"
    ? canViewModule("overview")
    : href === "/sales" ? canViewModule("sales") || canViewModule("reports")
    : href === "/services" ? canViewModule("services") || canViewModule("reports")
    : href === "/services/ready" ? canAccessReady
    : href === "/vendors" ? canViewModule("vendors")
    : href === "/customers" ? canViewModule("customers")
    : canViewModule("reports"));

  if (!ready || loading) return <AuthLoading />;

  const openPayment = (kind: "sale" | "service", id: string, returnAfterPayment = false) => {
    const record = kind === "sale"
      ? data.sales.find((item) => item.id === id)
      : data.services.find((item) => item.id === id);
    if (!record) return;
    const total = kind === "sale"
      ? (record as Sale).finalAmount
      : (record as ServiceJob).serviceAmount - (record as ServiceJob).discount;
    const paid = paymentTotal(record.payments);
    setModal(<PaymentModal
      total={total}
      paid={paid}
      onClose={() => setModal(null)}
      onSave={async (amount, notes) => {
        const payment: Payment = { id: newId(), amount, date: new Date().toISOString(), notes };
        try {
          if (kind === "sale") {
            await updateSale({ ...(record as Sale), payments: [...record.payments, payment] });
            setModal(null);
          } else {
            const service = record as ServiceJob;
            const updatedService = { ...service, payments: [...service.payments, payment] };
            await updateService(updatedService);
            const remaining = Math.max(0, updatedService.serviceAmount - updatedService.discount - servicePaid(updatedService));
            if (returnAfterPayment && remaining <= 0 && updatedService.status === "Ready") {
              notify("Payment completed. Confirm the device handover to finish returning it.");
              showServiceDeliveryModal(updatedService);
            } else {
              setModal(null);
              notify("Payment recorded.");
            }
          }
          if (kind === "sale") notify("Payment recorded.");
        } catch (reason) {
          notifyFromError(reason);
        }
      }}
    />);
  };

  const addCustomerDialog = () => {
    setModal(<CustomerModal
      onClose={() => setModal(null)}
      onSave={async (name, phone, email, address) => {
        try {
          const parsed = customerSchema.safeParse({ name, phone, email, address });
          if (!parsed.success) throw new Error(parsed.error.issues[0]?.message);
          const customer = await saveCustomer(name, phone, email, address);
          setModal(null);
          notify(data.customers.some((item) => item.id === customer.id) ? "Customer already exists." : "Customer added.");
        } catch (reason) {
          notifyFromError(reason);
        }
      }}
    />);
  };

  const editCustomerDialog = (customer: Customer) => {
    setModal(<CustomerModal
      title="Edit customer"
      initial={customer}
      onClose={() => setModal(null)}
      onSave={async (name, phone, email, address) => {
        try {
          const parsed = customerSchema.safeParse({ name, phone, email, address });
          if (!parsed.success) throw new Error(parsed.error.issues[0]?.message);
          const duplicate = data.customers.find((item) =>
            item.id !== customer.id && normalizePhoneNumber(item.phone) === normalizePhoneNumber(phone));
          if (duplicate) throw new Error(`This number already belongs to ${duplicate.name}.`);
          const updated = { ...customer, name: name.trim(), phone: phone.trim(), email: email.trim(), address: address.trim() };
          if (firebaseConfigured && user) await writeRecord(user.shopId, "customers", updated.id, updated);
          else await persist(updateLocalRecord(data, "customers", updated.id, updated));
          setModal(null);
          notify("Customer details updated.");
        } catch (reason) { notifyFromError(reason); }
      }}
    />);
  };

  const addServiceVendorDialog = () => {
    setModal(<ServiceVendorModal
      onClose={() => setModal(null)}
      onSave={async (name, phone) => {
        const vendor = await saveServiceVendor(name, phone);
        setModal(null);
        notify(`${vendor.name} added as a service vendor.`);
      }}
    />);
  };

  const addVendorServiceDialog = (vendor: ServiceVendor) => {
    setModal(<VendorServiceModal
      vendor={vendor}
      initialServiceNumber={nextVendorServiceNumber(vendor.id, data.vendorServices)}
      onClose={() => setModal(null)}
      onSave={async (service) => {
        await saveVendorService({ ...service, vendorId: vendor.id });
        setModal(null);
        notify(`${service.serviceNumber} added for ${vendor.name}.`);
      }}
    />);
  };

  const selectedSale = data.sales.find((item) => item.id === routeId || item.invoiceNumber === routeId);
  const selectedSaleWithAddress = selectedSale
    ? { ...selectedSale, customerAddress: selectedSale.customerAddress || data.customers.find((customer) => customer.id === selectedSale.customerId)?.address || "" }
    : undefined;
  const selectedService = data.services.find((item) => item.id === routeId || item.serviceNumber === routeId);
  const selectedServiceWithAddress = selectedService
    ? { ...selectedService, customerAddress: selectedService.customerAddress || data.customers.find((customer) => customer.id === selectedService.customerId)?.address || "" }
    : undefined;

  const view = route === "sales" && subroute === "create"
    ? <SaleForm
        data={data}
        busy={busy}
        onSubmit={async (draft) => {
          setBusy(true);
          try {
            const sale = await saveSale(draft);
            notify("Sales bill saved.");
            navigate(`/sales/${sale.id}`);
            return sale;
          } catch (reason) { notifyFromError(reason); }
          finally { setBusy(false); }
        }}
        onCancel={() => navigate("/sales")}
      />
    : route === "sales" && routeId
    ? <SaleDetail
        sale={selectedSaleWithAddress}
        settings={data.settings}
        onBack={() => navigate("/sales")}
        onPayment={(id) => openPayment("sale", id)}
        onEdit={openEditSale}
        onDelete={confirmDeleteSale}
        canEdit={canEditModule("sales")}
      />
    : route === "sales"
    ? <SalesPage sales={data.sales} search={globalSearch} onSearch={setGlobalSearch}
        onCreate={() => navigate("/sales/create")} onView={(id) => navigate(`/sales/${id}`)}
        onEdit={openEditSale} onDelete={confirmDeleteSale}
        onPayment={(id) => openPayment("sale", id)} settings={data.settings} canEdit={canEditModule("sales")} />
    : route === "services" && subroute === "create"
    ? <ServiceForm
        customers={data.customers}
        services={data.services}
        vendors={data.vendors}
        settings={data.settings}
        busy={busy}
        onSubmit={async (draft) => {
          setBusy(true);
          try {
            const service = await saveService(draft);
            notify("Service job created.");
            navigate(`/services/${service.id}`);
            return service;
          } catch (reason) { notifyFromError(reason); }
          finally { setBusy(false); }
        }}
        onCancel={() => navigate("/services")}
      />
    : route === "services" && subroute === "ready"
    ? <ReadyPage
        services={data.services}
        vendorServices={data.vendorServices}
        vendors={data.vendors}
        settings={data.settings}
        onView={(id) => navigate(`/services/${id}`)}
        onPayment={(id) => openPayment("service", id)}
        onReturn={(service) => setServiceStatus(service, "Returned")}
        onVendorStatusChange={changeVendorServiceStatus}
        canEditPayment={canEditModule("services")}
        canReturn={canEditModule("services") || canEditModule("ready")}
        canViewAllServices={canViewModule("services") || canViewModule("reports")}
      />
    : route === "services" && routeId
    ? <ServiceDetail service={selectedServiceWithAddress}
        vendor={data.vendors.find((item) => item.id === selectedService?.vendorId)}
        onBack={() => navigate(canViewModule("services") || canViewModule("reports") ? "/services" : "/services/ready")}
        onPayment={(id) => openPayment("service", id)} settings={data.settings}
        onEdit={openEditService} onDelete={confirmDeleteService}
        onUpdate={(service) => setServiceStatus(service, service.status)}
        onNotRepaired={(service) => showNotRepairedModal(service)} canEdit={canEditModule("services")} />
    : route === "services"
    ? <ServicesPage services={data.services} search={globalSearch} onSearch={setGlobalSearch}
        onCreate={() => navigate("/services/create")} onView={(id) => navigate(`/services/${id}`)}
        onEdit={openEditService} onDelete={confirmDeleteService}
        onPayment={(id) => openPayment("service", id)} onUpdate={(service) => setServiceStatus(service, service.status)}
        onVendorChange={assignServiceVendor} canEdit={canEditModule("services")} vendors={data.vendors} settings={data.settings} />
    : route === "vendors"
    ? <ServiceVendorsPage
        vendors={data.vendors}
        vendorServices={data.vendorServices}
        search={globalSearch}
        onSearch={setGlobalSearch}
        selectedId={routeId === "create" ? subroute : routeId}
        onSelect={(id) => navigate(id ? `/vendors/${id}` : "/vendors")}
        onCreateService={addVendorServiceDialog}
        onEditService={viewVendorServiceDetail}
        onDeleteService={confirmDeleteVendorService}
        onMarkNotRepaired={confirmVendorServiceNotRepaired}
        onStatusChange={changeVendorServiceStatus}
        onDeleteVendor={deleteServiceVendor}
        onAdd={addServiceVendorDialog}
        canEdit={canEditModule("vendors")}
      />
    : route === "customers"
    ? <CustomersPage customers={data.customers} sales={data.sales} services={data.services} vendors={data.vendors}
        search={globalSearch} onSearch={setGlobalSearch} onAdd={addCustomerDialog}
        selectedId={routeId} onView={(id) => navigate(id ? `/customers/${id}` : "/customers")}
        onEdit={editCustomerDialog} />
    : route === "reports"
    ? <ReportsPage data={data} revenuePeriod={revenuePeriod} setRevenuePeriod={setRevenuePeriod}
        canViewSales={canViewModule("sales") || canViewModule("reports")}
        canViewServices={canViewModule("services") || canViewModule("reports")} />
    : route === "settings"
    ? <SettingsPage settings={data.settings} identity={user} canEdit={canEditModule("settings")} onSave={async (settings) => {
        try { await saveShopSettings(settings); notify("Settings saved."); }
        catch (reason) { notifyFromError(reason); }
      }} onChangePassword={async (currentPassword, newPassword) => {
        try { await changeOwnPassword(currentPassword, newPassword); notify("Password changed."); }
        catch (reason) { notifyFromError(reason); throw reason; }
      }} />
    : <Dashboard data={data} period={period} setPeriod={setPeriod} revenuePeriod={revenuePeriod} setRevenuePeriod={setRevenuePeriod} chartFrom={chartFrom} setChartFrom={setChartFrom} chartTo={chartTo} setChartTo={setChartTo}
        onCreateSale={() => navigate("/sales/create")}
        onCreateService={() => navigate("/services/create")}
        canCreateSale={canEditModule("sales")}
        canCreateService={canEditModule("services")}
        canViewSales={canViewModule("sales") || canViewModule("reports") || canViewModule("overview")}
        canViewServices={canViewModule("services") || canViewModule("reports") || canViewModule("overview")}
        canViewCustomers={canViewModule("customers") || canViewModule("overview")}
        canOpenSales={canViewModule("sales") || canViewModule("reports")}
        canOpenServices={canViewModule("services") || canViewModule("reports")}
        canOpenReady={canAccessReady}
        canOpenCustomers={canViewModule("customers")}
        onSeeSales={() => navigate("/sales")}
        onSeeServices={() => navigate("/services")}
        onSeeReady={() => navigate("/services/ready")}
        onCustomer={() => navigate("/customers")}
      />;

  return (
    <div className="app-shell">
      {menuOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <div className="brand-mark"><Smartphone size={19} strokeWidth={2.6} /></div>
          <span className="brand-name">{data.settings.shopName || "AH Mobiles"}</span>
          <button className="icon-btn sidebar-close" aria-label="Close menu" onClick={() => setMenuOpen(false)}><X size={18} /></button>
        </div>
        <div className="sidebar-divider" role="separator" />
        <nav className="nav-list" aria-label="Main navigation">
          {visibleNav.map(({ label, href, icon: Icon }) => (
            <Link key={href} href={href} className={`nav-link ${activeHref === href ? "active" : ""}`}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                event.preventDefault();
                setMenuOpen(false);
                navigate(href);
              }}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
              {href === "/services/ready" && (
                data.services.filter((item) => item.status === "Ready").length
                + data.vendorServices.filter((item) => item.status === "Ready").length
              ) > 0 && (
                <span className="nav-count">
                  {data.services.filter((item) => item.status === "Ready").length
                    + data.vendorServices.filter((item) => item.status === "Ready").length}
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <Link href="/settings" className={`nav-link settings-link ${activeHref === "/settings" ? "active" : ""}`}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
            event.preventDefault();
            setMenuOpen(false);
            navigate("/settings");
          }}>
          <Settings size={18} strokeWidth={1.8} /><span>Settings</span>
        </Link>
        <div className="user-profile">
          <span className="profile-avatar">{user?.username[0]?.toUpperCase() ?? "A"}</span>
          <span className="profile-text"><strong>{user?.username ?? data.settings.ownerName ?? "Shop owner"}</strong><span>{user?.role === "employee" ? "Employee access" : user?.email ?? (firebaseConfigured ? "Connected" : "Local workspace")}</span></span>
          <button type="button" className="profile-logout" onClick={() => void handleLogout()}><LogOut size={15} /><span>Log out</span></button>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <button className="icon-btn mobile-menu" aria-label="Open menu" onClick={() => setMenuOpen(true)}><Menu size={20} /></button>
          <div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>{title}</strong></div>
        </header>
        {error && <div className="error-banner" role="alert"><Activity size={15} /><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error"><X size={15} /></button></div>}
        <main className={`page-content ${route === "customers" && !canEditModule("customers") ? "customer-read-only" : ""}`}>
          {accessDenied ? <AccessDenied /> : view}
        </main>
      </div>
      {modal}
      {toast && <div className={`toast toast-${toast.tone}`} role="status">{toast.tone === "success" ? <CheckCircle2 size={17} /> : <Activity size={17} />}{toast.text}</div>}
    </div>
  );
}

function routeTitle(route: string, subroute: string): string {
  if (route === "sales" && subroute === "create") return "New sales bill";
  if (route === "sales" && subroute) return "Sales invoice";
  if (route === "sales") return "Sales";
  if (route === "services" && subroute === "create") return "New service job";
  if (route === "services" && subroute === "ready") return "Ready for delivery";
  if (route === "services" && subroute) return "Service details";
  if (route === "services") return "Services";
  if (route === "vendors" && subroute) return "Vendor services";
  if (route === "vendors") return "Service vendors";
  if (route === "customers") return subroute ? "Customer details" : "Customers";
  if (route === "reports") return "Reports";
  if (route === "settings") return "Settings";
  return "Overview";
}

function AuthLoading() {
  return <div className="loading-screen"><div className="loading-brand"><Image className="brand-logo" src={AUTH_BRAND_LOGO_PATH} alt="AH Mobiles" width={144} height={96} priority /></div><div className="loading-spinner" /><span>Getting your workspace ready…</span></div>;
}

function AuthScreen({ error, disabled = false, onSubmit }: {
  error: string;
  disabled?: boolean;
  onSubmit: (username: string, password: string) => Promise<void>;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<{ username: string; password: string }>({
    resolver: zodResolver(loginSchema), defaultValues: { username: "", password: "" },
  });
  return (
    <div className="auth-page">
      <div className="auth-aside"><div className="auth-brand"><Image className="brand-logo" src={AUTH_BRAND_LOGO_PATH} alt="AH Mobiles" width={180} height={120} priority /></div><div className="auth-pitch"><span className="eyebrow">YOUR SHOP, IN SYNC</span><h1>Everything your shop needs.<br /><span>All in one place.</span></h1><p>Keep sales moving, repairs on track, and every customer feeling looked after.</p><div className="auth-points"><span><Check size={15} /> Sales & service billing</span><span><Check size={15} /> Customer & payment history</span><span><Check size={15} /> Reports that make sense</span></div></div><div className="auth-aside-foot">Simple tools. Better business.</div></div>
      <div className="auth-main"><form className="auth-form" onSubmit={handleSubmit(({ username, password }) => onSubmit(username, password))}>
        <span className="eyebrow">ADMIN & EMPLOYEE ACCESS</span><h2>Welcome back</h2><p>Sign in with your username or admin email.</p>
        <label className="field-label">Username or admin email<input className="input" type="text" autoComplete="username" placeholder="Username or email" disabled={disabled} {...register("username")} /></label>{errors.username && <span className="field-error">{errors.username.message}</span>}
        <label className="field-label" htmlFor="login-password">Password</label>
        <div className="password-input-wrap">
          <input id="login-password" className="input" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Password" disabled={disabled} {...register("password")} />
          <button type="button" className="password-toggle" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} disabled={disabled} onClick={() => setShowPassword((shown) => !shown)}>
            {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
        {errors.password && <span className="field-error">{errors.password.message}</span>}
        {error && <div className="form-alert">{error}</div>}
        <button className="btn btn-primary btn-full" disabled={disabled || isSubmitting}>{isSubmitting ? "Please wait…" : "Sign in"} <ArrowRight size={16} /></button>
        <p className="auth-secure"><ShieldCheck size={14} /> Your workspace is private and protected by Firebase Authentication.</p>
      </form></div>
    </div>
  );
}

function PageHeader({ eyebrow, title, description, children }: { eyebrow?: string; title: string; description?: string; children?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow ?? "YOUR BUSINESS"}</div><h1>{title}</h1>{description && <p>{description}</p>}</div>{children && <div className="heading-actions">{children}</div>}</div>;
}

function Button({ children, variant = "primary", onClick, type = "button", disabled = false, className = "", style }: {
  children: ReactNode; variant?: "primary" | "secondary" | "ghost" | "danger"; onClick?: () => void;
  type?: "button" | "submit"; disabled?: boolean; className?: string; style?: import("react").CSSProperties;
}) {
  return <button type={type} onClick={onClick} disabled={disabled} style={style} className={`btn btn-${variant} ${className}`}>{children}</button>;
}

function EmptyState({ icon: Icon = ClipboardList, title, detail, action }: { icon?: typeof ClipboardList; title: string; detail: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={22} strokeWidth={1.7} /></div><strong>{title}</strong><span>{detail}</span>{action}</div>;
}

function AccessDenied() {
  return <div className="panel"><EmptyState icon={ShieldCheck} title="Access not granted" detail="Ask your shop administrator to enable this module or permission." /></div>;
}

function RevenueAnalytics({ data, period, onPeriodChange, canViewSales = true, canViewServices = true }: {
  data: WorkspaceData;
  period: RevenuePeriod;
  onPeriodChange: (period: RevenuePeriod) => void;
  canViewSales?: boolean;
  canViewServices?: boolean;
}) {
  const periodSales = canViewSales
    ? data.sales.filter((sale) => isInRevenuePeriod(sale.invoiceDate, period))
    : [];
  const periodServices = canViewServices
    ? data.services.filter((service) => isInRevenuePeriod(service.inDate, period))
    : [];
  const periodVendorServices = canViewServices
    ? data.vendorServices.filter((service) => service.returnOutcome !== "Not repaired" && isInRevenuePeriod(service.inDate, period))
    : [];

  const salesRevenue = periodSales.reduce((sum, sale) => sum + sale.finalAmount, 0);
  const serviceRevenue = periodServices.reduce((sum, service) => sum + serviceNetRevenue(service), 0);
  const vendorServiceRevenue = periodVendorServices.reduce((sum, service) => sum + service.serviceCharge, 0);

  // Complete revenue = money actually received for sales and service jobs.
  const completeSalesRevenue = periodSales.reduce((sum, sale) => sum + paymentTotal(sale.payments), 0);
  const completeServiceRevenue = periodServices.reduce((sum, service) => sum + servicePaid(service), 0);
  const completeRevenue = completeSalesRevenue + completeServiceRevenue;

  // Pending revenue = unpaid invoice and service balances for this period.
  const pendingSalesRevenue = periodSales.reduce(
    (sum, sale) => sum + Math.max(0, sale.finalAmount - paymentTotal(sale.payments)), 0,
  );
  const pendingServiceRevenue = periodServices.reduce((sum, service) => sum + serviceDue(service), 0);
  const pendingRevenue = pendingSalesRevenue + pendingServiceRevenue;

  const metrics = [
    { label: "Overall revenue", value: salesRevenue + serviceRevenue + vendorServiceRevenue, icon: ArrowUpRight, accent: "blue" },
    ...(canViewSales ? [{ label: "Sales revenue", value: salesRevenue, icon: CreditCard, accent: "violet" }] : []),
    ...(canViewServices ? [
      { label: "Service revenue", value: serviceRevenue, icon: Wrench, accent: "amber" },
      { label: "Vendor service revenue", value: vendorServiceRevenue, icon: Store, accent: "green" },
    ] : []),
  ];

  return <section className="panel revenue-analytics-panel">
    <div className="panel-heading"><div><h2>Revenue analytics</h2><p>Revenue for the selected period</p></div><label className="select-wrap"><span>Period</span><select aria-label="Revenue analytics period" value={period} onChange={(event) => onPeriodChange(event.target.value as RevenuePeriod)}>{REVENUE_PERIODS.map((option) => <option key={option}>{option}</option>)}</select><ChevronDown size={14} /></label></div>
    {(canViewSales || canViewServices) && <div className="report-metrics revenue-completion-metrics">
      <div className="panel report-metric"><span className="metric-icon green"><CheckCircle2 size={17} /></span><span>Complete Revenue<strong>{money(completeRevenue)}</strong><small>Payments received · {period}</small></span></div>
      <div className="panel report-metric"><span className="metric-icon amber"><Clock3 size={17} /></span><span>Pending Revenue<strong>{money(pendingRevenue)}</strong><small>Outstanding balance · {period}</small></span></div>
    </div>}
    <div className="report-metrics">{metrics.map(({ label, value, icon: Icon, accent }) => <div className="panel report-metric" key={label}><span className={`metric-icon ${accent}`}><Icon size={17} /></span><span>{label}<strong>{money(value)}</strong><small>{period}</small></span></div>)}</div>
  </section>;
}

function VendorAnalytics({ data, period, maxRows }: {
  data: WorkspaceData;
  period: RevenuePeriod;
  maxRows?: number;
}) {
  const periodServices = data.vendorServices.filter((service) => isInRevenuePeriod(service.inDate, period));
  const analytics = data.vendors.map((vendor) => {
    const records = periodServices.filter((service) => service.vendorId === vendor.id);
    return {
      vendor,
      count: records.length,
      revenue: records.reduce((sum, service) => sum + (service.returnOutcome === "Not repaired" ? 0 : service.serviceCharge), 0),
    };
  }).sort((a, b) => b.revenue - a.revenue || b.count - a.count || a.vendor.name.localeCompare(b.vendor.name));
  const shown = maxRows ? analytics.slice(0, maxRows) : analytics;
  return <section className="panel vendor-analytics-panel">
    <div className="panel-heading"><div><h2>Service vendor analytics</h2><p>{periodServices.length} vendor service {periodServices.length === 1 ? "entry" : "entries"} · {period}</p></div></div>
    {shown.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>VENDOR</th><th>SERVICE ENTRIES</th><th>VENDOR SERVICE REVENUE</th></tr></thead><tbody>{shown.map(({ vendor, count, revenue }) => <tr key={vendor.id}><td><strong>{vendor.name}</strong></td><td>{count}</td><td><strong>{money(revenue)}</strong></td></tr>)}</tbody></table></div>
      : <EmptyState icon={Store} title="No service vendors yet" detail="Add a vendor and record vendor services to see vendor analytics." />}
    {maxRows !== undefined && analytics.length > shown.length && <div className="vendor-analytics-foot">Showing top {shown.length} of {analytics.length} vendors by revenue.</div>}
  </section>;
}

function Dashboard({ data, period, setPeriod, revenuePeriod, setRevenuePeriod, chartFrom, setChartFrom, chartTo, setChartTo, onCreateSale, onCreateService, canCreateSale, canCreateService, canViewSales, canViewServices, canViewCustomers, canOpenSales, canOpenServices, canOpenReady, canOpenCustomers, onSeeSales, onSeeServices, onSeeReady, onCustomer }: {
  data: WorkspaceData; period: ChartPeriod; setPeriod: (period: ChartPeriod) => void;
  revenuePeriod: RevenuePeriod; setRevenuePeriod: (period: RevenuePeriod) => void;
  chartFrom: string; setChartFrom: (value: string) => void; chartTo: string; setChartTo: (value: string) => void;
  onCreateSale: () => void; onCreateService: () => void; canCreateSale: boolean; canCreateService: boolean;
  canViewSales: boolean; canViewServices: boolean; canViewCustomers: boolean;
  canOpenSales: boolean; canOpenServices: boolean; canOpenReady: boolean; canOpenCustomers: boolean;
  onSeeSales: () => void; onSeeServices: () => void;
  onSeeReady: () => void; onCustomer: () => void;
}) {
  const pending = data.services.filter((service) => !["Ready", "Returned"].includes(service.status)).length;
  const readyJobs = data.services.filter((service) => service.status === "Ready");
  // Refunds follow the selected Revenue analytics period and use the actual
  // refund date (not the original service intake date).
  const periodRefunds = data.services.flatMap((service) =>
    (service.refunds ?? [])
      .filter((refund) => isInRevenuePeriod(refund.date, revenuePeriod))
      .map((refund) => ({ customerName: service.customerName, amount: refund.amount })),
  );
  const refundAmount = periodRefunds.reduce((sum, refund) => sum + refund.amount, 0);
  const refundCount = new Set(periodRefunds.map((refund) => refund.customerName)).size;
  const outstanding = data.sales.reduce((sum, sale) => sum + Math.max(0, sale.finalAmount - paymentTotal(sale.payments)), 0)
    + data.services.reduce((sum, service) => sum + serviceDue(service), 0);
  const metrics = [
    { label: "Total service jobs", value: String(data.services.length), icon: ClipboardList, accent: "violet", note: "All-time service jobs" },
    { label: "Pending service jobs", value: String(pending), icon: Clock3, accent: "amber", note: "Received or in progress" },
    { label: "Ready for delivery", value: String(readyJobs.length), icon: CheckCircle2, accent: "green", note: "Awaiting customer pickup" },
    { label: "Refunds", value: money(refundAmount), icon: CreditCard, accent: "rose", note: `${refundCount} ${refundCount === 1 ? "customer" : "customers"} refunded · ${revenuePeriod}` },
    { label: "Total customers", value: String(data.customers.length), icon: Users, accent: "blue", note: "In your directory" },
    { label: "Outstanding", value: money(outstanding), icon: ArrowUpRight, accent: "rose", note: "Across sales & services" },
  ];
  const visibleMetrics = metrics.filter(({ label }) => {
    if (label === "Total customers") return canViewCustomers;
    if (["Total service jobs", "Pending service jobs", "Ready for delivery", "Refunds"].includes(label)) return canViewServices;
    return canViewSales || canViewServices;
  });
  const chartData = useMemo(() => period === "Custom"
    ? chartForCustomRange(data, chartFrom, chartTo)
    : chartForPeriod(data, period), [data, period, chartFrom, chartTo]);
  return (
    <>
      <PageHeader eyebrow={new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" }).toUpperCase()} title="Good morning, welcome back" description="Here’s how things are looking at your shop today.">
        {canCreateService && <Button variant="secondary" onClick={onCreateService}><Wrench size={16} /> New service</Button>}{canCreateSale && <Button onClick={onCreateSale}><Plus size={17} /> Create a sale</Button>}
      </PageHeader>
      {(canViewSales || canViewServices) && <RevenueAnalytics data={data} period={revenuePeriod} onPeriodChange={setRevenuePeriod} canViewSales={canViewSales} canViewServices={canViewServices} />}
      <div className="metrics-grid">{visibleMetrics.map(({ label, value, icon: Icon, accent, note }) =>
        <div className="metric-card" key={label}><div className="metric-top"><span>{label}</span><span className={`metric-icon ${accent}`}><Icon size={17} /></span></div><strong>{value}</strong><div className="metric-note"><span>{note}</span></div></div>)}</div>
      <div className="dashboard-grid">
        {(canViewSales || canViewServices) && <section className="panel revenue-panel">
          <div className="panel-heading"><div><h2>Revenue overview</h2><p>{canViewSales && canViewServices ? "Sales, service, and vendor service income over time" : canViewSales ? "Sales revenue over time" : "Service and vendor service income over time"}</p></div><div className="segmented">{(["Week", "Month", "Year", "Custom"] as const).map((item) => <button key={item} className={period === item ? "selected" : ""} onClick={() => setPeriod(item)}>{item}</button>)}</div></div>
          {period === "Custom" && <div className="date-range dashboard-date-range"><label>From<input className="input" type="date" value={chartFrom} onChange={(event) => setChartFrom(event.target.value)} /></label><ArrowRight size={15} /><label>To<input className="input" type="date" value={chartTo} onChange={(event) => setChartTo(event.target.value)} /></label><button className="text-link" onClick={() => { setChartFrom(""); setChartTo(""); }}>Clear</button></div>}
          {data.sales.length + data.services.length + data.vendorServices.length === 0
            ? <div className="chart-empty"><div className="chart-empty-art"><AreaChartIcon /></div><strong>Your revenue story starts here</strong><span>Sales and services will appear as you add your first bill.</span>{canCreateSale && <Button variant="secondary" onClick={onCreateSale}><Plus size={15} /> Add first sale</Button>}</div>
            : period === "Custom" && (!chartFrom || !chartTo || chartFrom > chartTo)
              ? <div className="chart-empty"><strong>Choose a valid date range</strong><span>Select both dates to see revenue for that period.</span></div>
              : <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 12, right: 9, left: -18, bottom: 0 }}>
                <defs><linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4677f5" stopOpacity={0.17} /><stop offset="100%" stopColor="#4677f5" stopOpacity={0} /></linearGradient><linearGradient id="servicesFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#27b69d" stopOpacity={0.16} /><stop offset="100%" stopColor="#27b69d" stopOpacity={0} /></linearGradient><linearGradient id="vendorServicesFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8c71e8" stopOpacity={0.16} /><stop offset="100%" stopColor="#8c71e8" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid stroke="#eef1f6" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 14, fill: "#98a1b3" }} dy={8} /><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 14, fill: "#98a1b3" }} tickFormatter={(value: number) => value === 0 ? "₹0" : `₹${value / 1000}k`} /><Tooltip formatter={(value) => money(Number(value))} contentStyle={{ border: "1px solid #e8ebf1", borderRadius: 10, fontSize: 14 }} />
                {canViewSales && <Area type="monotone" dataKey="sales" name="Sales" stroke="#4777f5" strokeWidth={2.3} fill="url(#salesFill)" activeDot={{ r: 4 }} />}{canViewServices && <Area type="monotone" dataKey="services" name="Services" stroke="#22ad94" strokeWidth={2.3} fill="url(#servicesFill)" activeDot={{ r: 4 }} />}{canViewServices && <Area type="monotone" dataKey="vendorServices" name="Vendor services" stroke="#8c71e8" strokeWidth={2.3} fill="url(#vendorServicesFill)" activeDot={{ r: 4 }} />}
              </AreaChart></ResponsiveContainer></div>}
          <div className="chart-legend">{canViewSales && <span><i className="legend-dot blue-dot" />Sales</span>}{canViewServices && <span><i className="legend-dot green-dot" />Services</span>}{canViewServices && <span><i className="legend-dot violet-dot" />Vendor services</span>}</div>
        </section>}
        {canViewServices && <section className="panel service-overview">
          <div className="panel-heading"><div><h2>Service desk</h2><p>Repair jobs at a glance</p></div>{canOpenServices && <button className="text-link" onClick={onSeeServices}>View all <ArrowRight size={14} /></button>}</div>
          <div className="service-summary">
            {(["Received", "In progress", "Ready", "Returned"] as ServiceStatus[]).map((status) => <div className="service-count" key={status}><span className={`status-dot ${statusClass(status)}`} /> <span>{status}</span><strong>{data.services.filter((job) => job.status === status).length}</strong></div>)}
            <div className="service-count"><span className="status-dot status-returned" /> <span>Refund</span><strong>{refundCount}</strong></div>
          </div>
          <div className="panel-divider" />
          <div className="ready-highlight"><div className="ready-icon"><Zap size={18} /></div><div><strong>{readyJobs.length} ready for pickup</strong><span>Let customers know their device is ready.</span></div>{canOpenReady && <button className="circle-arrow" onClick={onSeeReady} aria-label="Open ready for delivery"><ArrowRight size={16} /></button>}</div>
        </section>}
        {canViewSales && <section className="panel recent-panel">
          <div className="panel-heading"><div><h2>Recent sales</h2><p>Your latest invoices</p></div>{canOpenSales && <button className="text-link" onClick={onSeeSales}>See all <ArrowRight size={14} /></button>}</div>
          <SalesTable sales={data.sales.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5)} compact canOpen={canOpenSales} />
          {data.sales.length === 0 && <EmptyState icon={CreditCard} title="No sales just yet" detail="Your new invoices will show up here." action={canCreateSale ? <Button variant="secondary" onClick={onCreateSale}><Plus size={15} /> Create a sale</Button> : undefined} />}
        </section>}
        {canViewServices && <section className="panel ready-panel">
          <div className="panel-heading"><div><h2>Waiting for pickup</h2><p>Devices ready to go home</p></div>{canOpenReady && <button className="text-link" onClick={onSeeReady}>Open list <ArrowRight size={14} /></button>}</div>
          {readyJobs.length === 0 ? <EmptyState icon={CheckCircle2} title="All caught up" detail="Jobs marked ready will appear here." /> :
            <div className="pickup-list">{readyJobs.slice(0, 4).map((job) => <div className="pickup-item" key={job.id}><span className="device-avatar"><Smartphone size={17} /></span><span className="pickup-info"><strong>{job.customerName}</strong><span>{deviceLabel(job)} · {job.serviceNumber}</span></span><span className="pickup-balance">{money(Math.max(0, job.serviceAmount - job.discount - servicePaid(job)))}</span></div>)}</div>}
        </section>}
        {canViewServices && <section className="panel recent-panel"><div className="panel-heading"><div><h2>Recent service bills</h2><p>Repairs that recently came in</p></div>{canOpenServices && <button className="text-link" onClick={onSeeServices}>See all <ArrowRight size={14} /></button>}</div>{data.services.length ? <div className="pickup-list">{data.services.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4).map((job) => <div className="pickup-item" key={job.id}><span className="device-avatar"><Wrench size={16} /></span><span className="pickup-info"><strong>{job.serviceNumber} · {job.customerName}</strong><span>{deviceLabel(job)} · {dateLabel(job.inDate)}{serviceRefundTotal(job) > 0 ? ` · Refunded ${money(serviceRefundTotal(job))}` : ""}</span></span>{job.returnOutcome === "Not repaired" ? <span className="status-badge status-returned">Refunded</span> : <StatusBadge status={job.status} />}</div>)}</div> : <EmptyState icon={Wrench} title="No service jobs yet" detail="New repair intakes will appear here." action={canCreateService ? <Button variant="secondary" onClick={onCreateService}><Plus size={14} /> Create service job</Button> : undefined} />}</section>}
        {canViewServices && <VendorAnalytics data={data} period={revenuePeriod} maxRows={5} />}
        {canViewCustomers && <section className="panel recent-panel"><div className="panel-heading"><div><h2>Recently added customers</h2><p>Your newest customer records</p></div>{canOpenCustomers && <button className="text-link" onClick={onCustomer}>View directory <ArrowRight size={14} /></button>}</div>{data.customers.length ? <div className="pickup-list">{data.customers.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4).map((customer) => <div className="pickup-item" key={customer.id}><span className="mini-avatar">{customer.name[0]?.toUpperCase() ?? "?"}</span><span className="pickup-info"><strong>{customer.name}</strong><span>{customer.phone} · Added {dateLabel(customer.createdAt)}</span></span><Users size={15} className="customer-row-icon" /></div>)}</div> : <EmptyState icon={Users} title="Your directory is ready" detail="Customers added to a bill will show up here." action={canOpenCustomers ? <Button variant="secondary" onClick={onCustomer}><Users size={14} /> View customers</Button> : undefined} />}</section>}
      </div>
      <div className="dashboard-bottom-note"><span><ShieldCheck size={15} /> Your business data stays private to your workspace.</span>{canOpenCustomers && <button className="text-link" onClick={onCustomer}>Manage customers <ArrowRight size={13} /></button>}</div>
    </>
  );
}

function AreaChartIcon() {
  return <svg viewBox="0 0 64 42" aria-hidden="true"><path d="M4 35 17 23l10 8 12-17 9 8 12-16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /><path d="M4 35 17 23l10 8 12-17 9 8 12-16v27H4Z" fill="currentColor" opacity=".1" /></svg>;
}

function chartForPeriod(data: WorkspaceData, period: "Week" | "Month" | "Year") {
  const now = new Date();
  const buckets = period === "Week" ? 7 : period === "Month" ? 6 : 12;
  return Array.from({ length: buckets }, (_, index) => {
    const date = new Date(now);
    if (period === "Week") date.setDate(now.getDate() - (buckets - index - 1));
    else if (period === "Month") date.setMonth(now.getMonth() - (buckets - index - 1), 1);
    else date.setMonth(index, 1);
    const sales = data.sales.filter((item) => {
      const d = new Date(item.invoiceDate);
      return period === "Week" ? d.toDateString() === date.toDateString()
        : period === "Month" ? d.getMonth() === date.getMonth() && d.getFullYear() === date.getFullYear()
        : d.getFullYear() === date.getFullYear();
    }).reduce((sum, item) => sum + item.finalAmount, 0);
    const services = data.services.filter((item) => {
      const d = new Date(item.inDate);
      return period === "Week" ? d.toDateString() === date.toDateString()
        : period === "Month" ? d.getMonth() === date.getMonth() && d.getFullYear() === date.getFullYear()
        : d.getFullYear() === date.getFullYear();
    }).reduce((sum, item) => sum + serviceNetRevenue(item), 0);
    const vendorServices = data.vendorServices.filter((item) => {
      const d = new Date(item.inDate);
      return period === "Week" ? d.toDateString() === date.toDateString()
        : period === "Month" ? d.getMonth() === date.getMonth() && d.getFullYear() === date.getFullYear()
        : d.getFullYear() === date.getFullYear();
    }).reduce((sum, item) => sum + (item.returnOutcome === "Not repaired" ? 0 : item.serviceCharge), 0);
    return { label: period === "Week" ? date.toLocaleDateString("en-IN", { weekday: "short" })
      : period === "Month" ? date.toLocaleDateString("en-IN", { month: "short" })
      : date.toLocaleDateString("en-IN", { month: "short" }), sales, services, vendorServices };
  });
}

function chartForCustomRange(data: WorkspaceData, from: string, to: string) {
  if (!from || !to || from > to) return [];
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const granularity = days <= 31 ? "day" : days <= 730 ? "month" : "year";
  const keyForDate = (date: Date) => {
    const year = String(date.getFullYear()).padStart(4, "0");
    if (granularity === "year") return year;
    const month = String(date.getMonth() + 1).padStart(2, "0");
    if (granularity === "month") return `${year}-${month}`;
    return `${year}-${month}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const totals = new Map<string, { sales: number; services: number; vendorServices: number }>();
  const cursor = new Date(start);
  if (granularity === "month") cursor.setDate(1);
  if (granularity === "year") { cursor.setMonth(0, 1); }
  while (cursor <= end) {
    totals.set(keyForDate(cursor), { sales: 0, services: 0, vendorServices: 0 });
    if (granularity === "day") cursor.setDate(cursor.getDate() + 1);
    else if (granularity === "month") cursor.setMonth(cursor.getMonth() + 1);
    else cursor.setFullYear(cursor.getFullYear() + 1);
  }
  for (const sale of data.sales) {
    const date = sale.invoiceDate.slice(0, 10);
    if (date < from || date > to) continue;
    const bucket = totals.get(keyForDate(new Date(`${date}T00:00:00`)));
    if (bucket) bucket.sales += sale.finalAmount;
  }
  for (const service of data.services) {
    const date = service.inDate.slice(0, 10);
    if (date < from || date > to) continue;
    const bucket = totals.get(keyForDate(new Date(`${date}T00:00:00`)));
    if (bucket) bucket.services += serviceNetRevenue(service);
  }
  for (const service of data.vendorServices) {
    const date = service.inDate.slice(0, 10);
    if (date < from || date > to) continue;
    const bucket = totals.get(keyForDate(new Date(`${date}T00:00:00`)));
    if (bucket) bucket.vendorServices += service.returnOutcome === "Not repaired" ? 0 : service.serviceCharge;
  }
  return [...totals].map(([key, amounts]) => ({
    label: granularity === "day"
      ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(new Date(`${key}T00:00:00`))
      : granularity === "month"
        ? new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit" }).format(new Date(`${key}-01T00:00:00`))
        : key,
    ...amounts,
  }));
}

function SalesPage({ sales, search, onSearch, onCreate, onView, onEdit, onDelete, onPayment, settings, canEdit }: {
  sales: Sale[]; search: string; onSearch: (value: string) => void; onCreate: () => void;
  onView: (id: string) => void; onEdit?: (sale: Sale) => void; onDelete?: (sale: Sale) => void; onPayment: (id: string) => void; settings: ShopSettings; canEdit: boolean;
}) {
  const [paymentFilter, setPaymentFilter] = useState("All statuses");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortBy, setSortBy] = useState("date-desc");
  const [page, setPage] = useState(1);
  const filtered = sales.filter((sale) => {
    const query = search.toLowerCase();
    const paid = paymentTotal(sale.payments);
    const productNames = sale.products.map((p) => deviceLabel(p)).join(" ");
    return (!query || `${sale.invoiceNumber} ${sale.customerName} ${sale.contactNumber} ${productNames}`.toLowerCase().includes(query))
      && (paymentFilter === "All statuses" || statusOf(sale.finalAmount, paid) === paymentFilter)
      && (!from || sale.invoiceDate.slice(0, 10) >= from)
      && (!to || sale.invoiceDate.slice(0, 10) <= to);
  }).sort((a, b) => sortBy === "amount-desc" ? b.finalAmount - a.finalAmount
    : sortBy === "amount-asc" ? a.finalAmount - b.finalAmount
    : sortBy === "date-asc" ? a.invoiceDate.localeCompare(b.invoiceDate)
    : b.invoiceDate.localeCompare(a.invoiceDate));
  const pageSize = 8;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const exportSalesPdf = () => {
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const columns = [
      { title: "INVOICE", width: 28 },
      { title: "CUSTOMER", width: 34 },
      { title: "CUSTOMER NUMBER", width: 28 },
      { title: "PRODUCTS", width: 23 },
      { title: "DATE", width: 22 },
      { title: "TOTAL", width: 30 },
      { title: "PAID", width: 30 },
      { title: "STATUS", width: 24 },
    ];
    const billed = filtered.reduce((sum, sale) => sum + sale.finalAmount, 0);
    const collected = filtered.reduce((sum, sale) => sum + paymentTotal(sale.payments), 0);
    const balance = filtered.reduce((sum, sale) => sum + Math.max(0, sale.finalAmount - paymentTotal(sale.payments)), 0);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(16);
    pdf.text("Sales Report", margin, 13);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.text(`Period: ${from || "All"} to ${to || "All"}  |  Generated: ${dateLabel(new Date().toISOString())}`, margin, 20);
    pdf.text(`Invoices: ${filtered.length}  |  Billed: ${pdfMoney(billed)}  |  Paid: ${pdfMoney(collected)}  |  Balance: ${pdfMoney(balance)}`, margin, 26);

    const drawTableHeader = (y: number) => {
      pdf.setFillColor(238, 242, 248);
      pdf.rect(margin, y - 4, columns.reduce((sum, column) => sum + column.width, 0), 7, "F");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7);
      let x = margin;
      columns.forEach((column) => {
        pdf.text(column.title, x + 1, y);
        x += column.width;
      });
      pdf.setFont("helvetica", "normal");
      return y + 6;
    };
    let y = drawTableHeader(34);
    filtered.forEach((sale) => {
      const paid = paymentTotal(sale.payments);
      const values = [
        sale.invoiceNumber,
        sale.customerName,
        sale.contactNumber,
        `${sale.products.length} item${sale.products.length === 1 ? "" : "s"}`,
        dateLabel(sale.invoiceDate),
        pdfMoney(sale.finalAmount),
        pdfMoney(paid),
        statusOf(sale.finalAmount, paid),
      ];
      const lines = values.map((value, index) => pdf.splitTextToSize(value || "—", columns[index].width - 2) as string[]);
      const rowHeight = Math.max(6, ...lines.map((cellLines) => cellLines.length * 3.2 + 2));
      if (y + rowHeight > pageHeight - 12) {
        pdf.addPage();
        y = drawTableHeader(14);
      }
      let x = margin;
      lines.forEach((cellLines, index) => {
        pdf.text(cellLines, x + 1, y, { maxWidth: columns[index].width - 2 });
        x += columns[index].width;
      });
      y += rowHeight;
      pdf.setDrawColor(225, 230, 238);
      pdf.line(margin, y - 2, margin + columns.reduce((sum, column) => sum + column.width, 0), y - 2);
    });
    const pageCount = pdf.getNumberOfPages();
    for (let page = 1; page <= pageCount; page += 1) {
      pdf.setPage(page);
      pdf.setFontSize(8);
      pdf.text(`Page ${page} of ${pageCount}`, pageWidth - margin, pageHeight - 5, { align: "right" });
    }
    pdf.save(`sales-report-${dateInputValue()}.pdf`);
  };
  return <>
    <PageHeader eyebrow="RETAIL" title="Sales" description="Create invoices, track payments, and keep every sale in one place."><Button variant="secondary" onClick={exportSalesPdf}><Download size={15} /> Export PDF</Button>{canEdit && <Button onClick={onCreate}><Plus size={16} /> Create sales bill</Button>}</PageHeader>
    <div className="page-stat-row"><span className="stat-pill"><FileText size={15} /><strong>{sales.length}</strong> invoices</span><span className="stat-pill"><ArrowUpRight size={15} /><strong>{money(sales.reduce((sum, sale) => sum + sale.finalAmount, 0))}</strong> billed</span><span className="stat-pill"><Clock3 size={15} /><strong>{money(sales.reduce((sum, sale) => sum + Math.max(0, sale.finalAmount - paymentTotal(sale.payments)), 0))}</strong> due</span></div>
    <div className="panel table-panel"><div className="table-toolbar"><label className="table-search"><Search size={16} /><input value={search} onChange={(event) => { onSearch(event.target.value); setPage(1); }} placeholder="Search invoice, customer or phone…" /></label><div className="table-filters"><label className="select-wrap"><Filter size={15} /><select value={paymentFilter} onChange={(event) => { setPaymentFilter(event.target.value); setPage(1); }}><option>All statuses</option><option>Paid</option><option>Partially paid</option><option>Unpaid</option></select><ChevronDown size={14} /></label><div className="date-range compact-date-range"><label>From<input aria-label="Sales from date" className="input date-filter" type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} /></label><label>To<input aria-label="Sales to date" className="input date-filter" type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} /></label></div><label className="select-wrap"><span>Sort</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value)}><option value="date-desc">Newest</option><option value="date-asc">Oldest</option><option value="amount-desc">Highest total</option><option value="amount-asc">Lowest total</option></select><ChevronDown size={14} /></label></div></div>
      {filtered.length ? <SalesTable sales={filtered.slice((page - 1) * pageSize, page * pageSize)} onView={onView} onEdit={canEdit ? onEdit : undefined} onDelete={canEdit ? onDelete : undefined} onPayment={canEdit ? onPayment : undefined} settings={settings} /> :
        <EmptyState icon={CreditCard} title={search || paymentFilter !== "All statuses" ? "No matching invoices" : "Ready for your first sale?"} detail={sales.length ? "Try a different search or payment status." : "Create a sales bill and your invoices will appear here."} action={!sales.length && canEdit ? <Button onClick={onCreate}><Plus size={15} /> Create sales bill</Button> : undefined} />}
      {filtered.length > 0 && <Pagination page={page} pages={pages} total={filtered.length} pageSize={pageSize} onPage={setPage} />}
    </div>
  </>;
}

function SalesTable({ sales, compact = false, canOpen = true, onView, onEdit, onDelete, onPayment, settings }: {
  sales: Sale[]; compact?: boolean; canOpen?: boolean; onView?: (id: string) => void; onEdit?: (sale: Sale) => void; onDelete?: (sale: Sale) => void; onPayment?: (id: string) => void; settings?: ShopSettings;
}) {
  const router = useRouter();
  const viewSale = (id: string) => onView ? onView(id) : clientNavigate(`/sales/${id}`);
  return <div className={`table-scroll ${compact ? "compact-table" : ""}`}><table className="data-table"><thead><tr><th>INVOICE</th><th>CUSTOMER</th>{!compact && <th>PRODUCTS</th>}<th>DATE</th><th>TOTAL</th>{!compact && <th>PAID</th>}<th>STATUS</th><th /></tr></thead><tbody>
    {sales.map((sale) => {
      const paid = paymentTotal(sale.payments);
      const due = Math.max(0, sale.finalAmount - paid);
      return <tr key={sale.id}><td>{canOpen ? <button className="table-primary-link" onClick={() => viewSale(sale.id)}>{sale.invoiceNumber}</button> : <span>{sale.invoiceNumber}</span>}</td><td><span className="customer-cell"><span className="mini-avatar">{sale.customerName[0]?.toUpperCase() || "?"}</span><span><strong>{sale.customerName}</strong><small>{sale.contactNumber}</small></span></span></td>{!compact && <td><span className="muted-cell">{sale.products.length} item{sale.products.length === 1 ? "" : "s"}</span></td>}<td><span className="muted-cell">{dateLabel(sale.invoiceDate)}</span></td><td><strong className="amount-cell">{money(sale.finalAmount)}</strong></td>{!compact && <td><span className="muted-cell">{money(paid)}{due > 0 && <small className="due-text">{money(due)} due</small>}</span></td>}<td><StatusBadge status={statusOf(sale.finalAmount, paid)} /></td><td>{canOpen && <button className="row-action" aria-label="View invoice" title="View invoice" onClick={() => viewSale(sale.id)}><ArrowRight size={15} /></button>}{onEdit && <button className="row-action" aria-label="Edit invoice" title="Edit invoice" onClick={() => onEdit(sale)}><Pencil size={15} /></button>}{onDelete && <button className="row-action danger-action" aria-label="Delete invoice" title="Delete invoice" onClick={() => onDelete(sale)}><Trash2 size={15} /></button>}{onPayment && due > 0 && <button className="row-action" aria-label="Record payment" title="Record payment" onClick={() => onPayment(sale.id)}><Plus size={15} /></button>}{settings && <button className="row-action" aria-label="Download invoice" title="Download invoice" onClick={() => downloadInvoice(sale, settings)}><Download size={15} /></button>}</td></tr>;
    })}
  </tbody></table></div>;
}

function SaleForm({ data, busy, onSubmit, onCancel }: {
  data: WorkspaceData; busy: boolean; onSubmit: (draft: Omit<Sale, "id">) => Promise<Sale | undefined>; onCancel: () => void;
}) {
  const [products, setProducts] = useState<ProductLine[]>([{ id: newId(), category: "Electronics", brand: "", model: "", productName: "", imei: "", quantity: 1, rate: 0, discount: 0 }]);
  const [enableTax, setEnableTax] = useState(data.settings.enableTax !== false);
  const [tax, setTax] = useState(0);
  const [paid, setPaid] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState(false);
  const generatedInvoiceNumber = nextInvoiceNumber("sales", data.settings.salesPrefix || "SAL", data.sales);
  const { register, handleSubmit, control, setValue, formState: { errors } } = useForm({
    resolver: zodResolver(saleSchema.omit({ products: true })),
    defaultValues: { customerName: "", contactNumber: "", customerAddress: "", invoiceDate: dateInputValue(), invoiceNumber: generatedInvoiceNumber, discount: 0, tax: 0, amountPaid: 0 },
  });
  const name = useWatch({ control, name: "customerName" });
  const phone = useWatch({ control, name: "contactNumber" });
  const customerAddress = useWatch({ control, name: "customerAddress" });
  const invoiceDate = useWatch({ control, name: "invoiceDate" });
  const invoiceNumber = useWatch({ control, name: "invoiceNumber" });
  const total = products.reduce((sum, product) => sum + Math.max(0, product.quantity * product.rate - product.discount), 0);
  const final = Math.max(0, total + (enableTax ? tax : 0));
  const normalizedPhone = normalizePhoneNumber(phone ?? "");
  const matchingCustomer = data.customers.find((customer) =>
    normalizedPhone.length >= 7 && normalizePhoneNumber(customer.phone) === normalizedPhone);
  useEffect(() => {
    if (matchingCustomer) {
      setValue("customerName", matchingCustomer.name);
      setValue("customerAddress", matchingCustomer.address || "");
    }
  }, [matchingCustomer, setValue]);
  const addProduct = () => setProducts((current) => [...current, { id: newId(), category: "Electronics", brand: "", model: "", productName: "", imei: "", quantity: 1, rate: 0, discount: 0 }]);
  const updateProduct = (id: string, key: keyof ProductLine, value: string | number) => setProducts((current) => current.map((item) => item.id === id ? { ...item, [key]: value } : item));
  const saveDraft = async (form: { customerName: string; contactNumber: string; customerAddress: string; invoiceDate: string; invoiceNumber: string }, printAfterSave = false) => {
    setFieldErrors({});
    for (const [index, p] of products.entries()) {
      const cat = p.category ?? "Electronics";
      if (cat === "Electronics") {
        if (!p.brand.trim()) {
          setFieldErrors({ products: `Please enter a brand for product ${index + 1}.` });
          return;
        }
        if (!p.model.trim()) {
          setFieldErrors({ products: `Please enter a model for product ${index + 1}.` });
          return;
        }
      } else {
        if (!p.productName?.trim()) {
          setFieldErrors({ products: `Please enter a product name for product ${index + 1}.` });
          return;
        }
      }
    }
    const parsed = saleSchema.safeParse({ ...form, products, discount: 0, tax: enableTax ? tax : 0, amountPaid: paid });
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) nextErrors[String(issue.path[0])] = issue.message;
      if (parsed.error.issues.some((issue) => issue.path.includes("discount") && issue.path[0] === "products")) {
        nextErrors.products = "Check that each product discount is no more than its line total.";
      }
      if (paid > final) nextErrors.amountPaid = "Amount paid cannot exceed the final amount.";
      setFieldErrors(nextErrors);
      return;
    }
    const trimmedInvoiceNumber = form.invoiceNumber.trim();
    if (data.sales.some((sale) => sale.invoiceNumber === trimmedInvoiceNumber)) {
      setFieldErrors({ invoiceNumber: "That invoice number is already in use." });
      return;
    }
    if (paid > final) {
      setFieldErrors({ amountPaid: "Amount paid cannot exceed the final amount." });
      return;
    }
    const customer = data.customers.find((item) =>
      normalizePhoneNumber(item.phone) === normalizePhoneNumber(form.contactNumber));
    const payments: Payment[] = paid ? [{ id: newId(), amount: paid, date: new Date().toISOString(), notes: "Payment at sale" }] : [];
    const saved = await onSubmit({
      invoiceNumber: trimmedInvoiceNumber,
      customerId: customer?.id ?? "",
      customerName: customer?.name ?? form.customerName.trim(),
      contactNumber: form.contactNumber.trim(),
      customerAddress: form.customerAddress.trim(),
      invoiceDate: businessDateTime(form.invoiceDate),
      products: products.map((item) => ({
        ...item,
        category: item.category ?? "Electronics",
        brand: (item.category ?? "Electronics") === "Electronics" ? item.brand.trim() : "",
        model: (item.category ?? "Electronics") === "Electronics" ? item.model.trim() : "",
        productName: (item.category ?? "Electronics") === "Accessories" ? item.productName?.trim() : undefined,
      })),
      subtotal: total,
      discount: 0,
      tax: enableTax ? tax : 0,
      finalAmount: final,
      payments,
      createdAt: new Date().toISOString(),
    });
    if (saved && printAfterSave) printInvoice(saved, data.settings);
  };
  const submit = handleSubmit((form) => saveDraft(form));
  const submitAndPrint = handleSubmit((form) => saveDraft(form, true));
  const draftSale: Sale = {
    id: "", invoiceNumber: invoiceNumber || generatedInvoiceNumber,
    customerId: "", customerName: name || "Customer name", contactNumber: phone || "", customerAddress: customerAddress || "",
    invoiceDate, products, subtotal: total, discount: 0, tax: enableTax ? tax : 0, finalAmount: final,
    payments: paid ? [{ id: "preview", amount: paid, date: new Date().toISOString() }] : [], createdAt: new Date().toISOString(),
  };
  return <>
    <PageHeader eyebrow="SALES · NEW INVOICE" title="Create sales bill" description="Add a customer and products to put together a new invoice."><Button variant="secondary" onClick={onCancel}><ArrowLeft size={15} /> Back to sales</Button></PageHeader>
    <form className="billing-layout" onSubmit={submit} noValidate>
      <div className="billing-main">
        <section className="panel form-panel"><div className="form-section-head"><span className="step-number">01</span><div><h2>Customer details</h2><p>Who is this invoice for?</p></div></div>
          <div className="form-grid two-col"><FormField label="Customer name" error={errors.customerName?.message}><input className="input" placeholder="e.g. Priya Sharma" {...register("customerName")} /></FormField><FormField label="Contact number" error={errors.contactNumber?.message}><input className="input" inputMode="tel" placeholder="+91 98765 43210" {...register("contactNumber")} />{matchingCustomer && <span className="field-hint"><CheckCircle2 size={13} /> Existing customer: {matchingCustomer.name}</span>}</FormField><FormField label="Customer address" error={errors.customerAddress?.message}><textarea className="input textarea" maxLength={500} placeholder="Street, area, city" {...register("customerAddress")} /></FormField><FormField label="Invoice date"><input className="input" type="date" {...register("invoiceDate")} /></FormField><FormField label="Invoice number" error={errors.invoiceNumber?.message ?? fieldErrors.invoiceNumber}><input className="input" maxLength={120} {...register("invoiceNumber")} /><span className="field-hint">Auto-generated; edit if needed.</span></FormField></div>
        </section>
        <section className="panel form-panel"><div className="form-section-head"><span className="step-number">02</span><div><h2>Products</h2><p>Add one or more devices to this sale.</p></div><Button variant="secondary" onClick={addProduct}><Plus size={15} /> Add product</Button></div>
          <div className="product-list">{products.map((product, index) => <div className="product-row" key={product.id}><div className="product-row-title"><span>Product {String(index + 1).padStart(2, "0")}</span>{products.length > 1 && <button className="remove-link" type="button" onClick={() => setProducts((items) => items.filter((item) => item.id !== product.id))}><X size={14} /> Remove</button>}</div><div className="form-grid product-fields"><FormField label="Category"><div className="select-wrap category1-select-wrap"><select className="input" value={product.category ?? "Electronics"} onChange={(event) => { const cat = event.target.value as ProductCategory; setProducts((items) => items.map((item) => item.id === product.id ? { ...item, category: cat, brand: "", model: "", productName: "" } : item)); }}><option value="Electronics">Electronics</option><option value="Accessories">Accessories</option></select><ChevronDown size={14} /></div></FormField>{(product.category ?? "Electronics") === "Electronics" ? <><FormField label="Brand"><input className="input" placeholder="Apple" value={product.brand} onChange={(event) => updateProduct(product.id, "brand", event.target.value)} /></FormField><FormField label="Model"><input className="input" placeholder="iPhone 15" value={product.model} onChange={(event) => updateProduct(product.id, "model", event.target.value)} /></FormField></> : <div className="product-span-2"><FormField label="Product name"><input className="input" placeholder="e.g. Tempered glass, Charger…" value={product.productName ?? ""} onChange={(event) => updateProduct(product.id, "productName", event.target.value)} /></FormField></div>}<FormField label="IMEI / Serial"><div className="imei-input-wrap"><input className="input" maxLength={20} placeholder="Optional" value={product.imei} onChange={(event) => updateProduct(product.id, "imei", event.target.value)} /><ScanBarcodeButton onScan={(value) => updateProduct(product.id, "imei", value)} /></div></FormField><FormField label="Qty"><input className="input" type="number" min="1" value={product.quantity} onChange={(event) => updateProduct(product.id, "quantity", Number(event.target.value))} /></FormField><FormField label="Rate (₹)"><input className="input" type="number" min="0" value={product.rate || ""} placeholder="0" onChange={(event) => updateProduct(product.id, "rate", Number(event.target.value))} /></FormField><FormField label="Discount (₹)"><input className="input" type="number" min="0" value={product.discount || ""} placeholder="0" onChange={(event) => updateProduct(product.id, "discount", Number(event.target.value))} /></FormField><div className="line-total"><span>Line total</span><strong>{money(Math.max(0, product.quantity * product.rate - product.discount))}</strong></div></div></div>)}</div>
          {fieldErrors.products && <span className="field-error">{fieldErrors.products}</span>}
        </section>
        <section className="panel form-panel">
          <div className="form-section-head">
            <span className="step-number">03</span>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
              <div><h2>Payment details</h2><p>Record the amount received today.</p></div>
              <label className="checkbox-wrap" style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 500, fontSize: 13 }}>
                <input type="checkbox" checked={enableTax} onChange={(event) => {
                  setEnableTax(event.target.checked);
                  if (!event.target.checked) setTax(0);
                }} />
                <span>Enable tax</span>
              </label>
            </div>
          </div>
          <div className="form-grid two-col">
            <FormField label="Amount paid (₹)" error={fieldErrors.amountPaid}><input className="input" type="number" min="0" value={paid || ""} placeholder="0" onChange={(event) => setPaid(Number(event.target.value))} /></FormField>
            {enableTax && <FormField label="Tax (₹)"><input className="input" type="number" min="0" value={tax || ""} placeholder="0" onChange={(event) => setTax(Number(event.target.value))} /></FormField>}
          </div>
        </section>
        <div className="form-footer"><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button variant="secondary" onClick={() => setPreview(true)}><FileText size={15} /> Preview invoice</Button><Button variant="secondary" onClick={() => void submitAndPrint()} disabled={busy}><Printer size={15} /> Save & print</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : <><Check size={16} /> Save sales bill</>}</Button></div>
      </div>
      <aside className="billing-side"><div className="panel total-card"><div className="total-card-title"><span className="total-icon"><CreditCard size={17} /></span><span><strong>Invoice summary</strong><small>Totals update as you go</small></span></div><div className="total-lines"><span>Subtotal <strong>{money(total)}</strong></span><span>Discount <strong>− {money(products.reduce((sum, item) => sum + item.discount, 0))}</strong></span>{enableTax && tax > 0 && <span>Tax <strong>{money(tax)}</strong></span>}<div className="total-final"><span>Amount due</span><strong>{money(final)}</strong></div><span>Paid today <strong>{money(paid)}</strong></span></div><div className={`balance-box ${final - paid > 0 ? "" : "settled"}`}><span>{final - paid > 0 ? "Balance due" : "Fully paid"}</span>{final - paid > 0 && <strong>{money(final - paid)}</strong>}</div></div><div className="billing-tip"><ShieldCheck size={16} /><span>IMEI and product details stay with this invoice for easy reference.</span></div></aside>
    </form>
    {preview && <InvoiceModal sale={draftSale} settings={data.settings} onClose={() => setPreview(false)} />}
  </>;
}

function FormField({ label, children, error }: { label: string; children: ReactNode; error?: string }) {
  return <label className="field-label">{label}{children}{error && <span className="field-error">{error}</span>}</label>;
}

function PasswordInput({ value, onChange, autoComplete, placeholder }: {
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-input-wrap">
      <input className="input" type={visible ? "text" : "password"} autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      <button type="button" className="password-toggle" aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible} onClick={() => setVisible((shown) => !shown)}>
        {visible ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
}

function ServiceForm({ customers, services, vendors, settings, busy, onSubmit, onCancel }: {
  customers: Customer[];
  services: ServiceJob[];
  vendors: ServiceVendor[];
  settings: ShopSettings;
  busy: boolean; onSubmit: (draft: Omit<ServiceJob, "id" | "serviceNumber"> & { serviceNumber?: string }) => Promise<ServiceJob | undefined>; onCancel: () => void;
}) {
  const generatedServiceNumber = nextInvoiceNumber("services", settings.servicePrefix || "SRV", services);
  const [conditions, setConditions] = useState<string[]>([]);
  const [otherCondition, setOtherCondition] = useState("");
  const [serviceNumber, setServiceNumber] = useState(generatedServiceNumber);
  const [amount, setAmount] = useState(0);
  const [advance, setAdvance] = useState(0);
  const [formError, setFormError] = useState("");
  const [serviceCategory, setServiceCategory] = useState<ProductCategory>("Electronics");
  const [serviceBrand, setServiceBrand] = useState("");
  const [serviceModel, setServiceModel] = useState("");
  const [serviceProductName, setServiceProductName] = useState("");
  const { register, handleSubmit, setValue, formState: { errors } } = useForm({
    resolver: zodResolver(serviceFormSchema),
    defaultValues: { customerName: "", contactNumber: "", customerAddress: "", inDate: dateInputValue(), brand: "", mobileModel: "", imei: "", reportedFault: "", technicianNotes: "", remarks: "", serviceAmount: 0, discount: 0 },
  });
  const final = amount;
  const balance = Math.max(0, amount - advance);
  const toggleCondition = (condition: string) => setConditions((current) =>
    current.includes(condition) ? current.filter((item) => item !== condition) : [...current, condition]);
  const saveDraft = async (form: {
    customerName: string; contactNumber: string; customerAddress: string; inDate: string; brand: string; mobileModel: string;
    imei: string; reportedFault: string; technicianNotes: string; remarks: string;
  }, printAfterSave = false) => {
    setFormError("");
    const trimmedServiceNumber = serviceNumber.trim();
    if (!trimmedServiceNumber) { setFormError("Enter a service bill number."); return; }
    if (services.some((service) => service.serviceNumber === trimmedServiceNumber)) {
      setFormError("That service bill number is already in use.");
      return;
    }
    if (advance < 0 || advance > amount) {
      setFormError("Advance cannot be greater than the service charge.");
      return;
    }
    if (serviceCategory === "Electronics") {
      if (!serviceBrand.trim()) { setFormError("Enter a brand."); return; }
      if (!serviceModel.trim()) { setFormError("Enter a model."); return; }
    } else {
      if (!serviceProductName.trim()) { setFormError("Enter a product name."); return; }
    }

    const parsed = serviceSchema.safeParse({
      ...form,
      category: serviceCategory,
      brand: serviceCategory === "Electronics" ? serviceBrand.trim() : "",
      mobileModel: serviceCategory === "Electronics" ? serviceModel.trim() : "",
      productName: serviceCategory === "Accessories" ? serviceProductName.trim() : undefined,
      receivedConditions: conditions.map((condition) =>
        condition === "Other" && otherCondition.trim()
          ? `Other: ${otherCondition.trim()}`
          : condition
      ),
      serviceAmount: amount,
      discount: 0,
    });
    if (!parsed.success) { setFormError(parsed.error.issues[0]?.message ?? "Check the form details."); return; }
    const customer = customers.find((item) =>
      normalizePhoneNumber(item.phone) === normalizePhoneNumber(form.contactNumber));
    const saved = await onSubmit({
      customerId: customer?.id ?? "", customerName: form.customerName.trim(), contactNumber: form.contactNumber.trim(),
      customerAddress: form.customerAddress.trim(),
      inDate: businessDateTime(form.inDate),
      category: serviceCategory,
      brand: serviceCategory === "Electronics" ? serviceBrand.trim() : "",
      mobileModel: serviceCategory === "Electronics" ? serviceModel.trim() : "",
      productName: serviceCategory === "Accessories" ? serviceProductName.trim() : undefined,
      imei: form.imei.trim(), reportedFault: form.reportedFault.trim(), technicianNotes: form.technicianNotes.trim(),
      receivedConditions: conditions,
      remarks: form.remarks.trim(),
      status: "Received",
      serviceAmount: amount,
      discount: 0,
      finalAmount: final,
      payments: advance > 0
        ? [{
            id: newId(),
            amount: advance,
            date: new Date().toISOString(),
            notes: "Advance payment",
          }]
        : [],
      createdAt: new Date().toISOString(),
      serviceNumber: trimmedServiceNumber === generatedServiceNumber ? undefined : trimmedServiceNumber,
    });
    if (saved && printAfterSave) printReceipt(saved, settings);
  };
  const submit = handleSubmit((form) => saveDraft(form));
  const submitAndPrint = handleSubmit((form) => saveDraft(form, true));
  return <>
    <PageHeader eyebrow="SERVICE DESK · NEW JOB" title="New service job" description="Record the device condition and repair request at intake."><Button variant="secondary" onClick={onCancel}><ArrowLeft size={15} /> Back to services</Button></PageHeader>
    <form className="billing-layout" onSubmit={submit} noValidate><div className="billing-main">
      <section className="panel form-panel"><div className="form-section-head"><span className="step-number">01</span><div><h2>Customer & intake</h2><p>Contact details and when the device arrived.</p></div></div><div className="form-grid two-col"><FormField label="Customer name" error={errors.customerName?.message}><input className="input" placeholder="e.g. Priya Sharma" {...register("customerName")} /></FormField><FormField label="Contact number" error={errors.contactNumber?.message}><input className="input" inputMode="tel" placeholder="+91 98765 43210" {...register("contactNumber")} /></FormField><FormField label="Customer address" error={errors.customerAddress?.message}><textarea className="input textarea" maxLength={500} placeholder="Street, area, city" {...register("customerAddress")} /></FormField><FormField label="In date"><input className="input" type="date" {...register("inDate")} /></FormField><FormField label="Service bill number"><input className="input" required maxLength={120} value={serviceNumber} onChange={(event) => setServiceNumber(event.target.value)} /><span className="field-hint">Auto-generated; edit if needed.</span></FormField></div></section>
      <section className="panel form-panel"><div className="form-section-head"><span className="step-number">02</span><div><h2>Device details</h2><p>Identify the device and document its condition.</p></div></div><div className="form-grid two-col"><FormField label="Category"><div className="select-wrap category-select-wrap"><select className="input" value={serviceCategory} onChange={(event) => { setServiceCategory(event.target.value as ProductCategory); setServiceBrand(""); setServiceModel(""); setServiceProductName(""); }}><option value="Electronics">Electronics</option><option value="Accessories">Accessories</option></select><ChevronDown size={14} /></div></FormField>{serviceCategory === "Electronics" ? <><FormField label="Brand"><input className="input" placeholder="Samsung" value={serviceBrand} onChange={(event) => setServiceBrand(event.target.value)} /></FormField><FormField label="Model"><input className="input" placeholder="Galaxy S24" value={serviceModel} onChange={(event) => setServiceModel(event.target.value)} /></FormField></> : <FormField label="Product name"><input className="input" placeholder="e.g. Tempered glass, Charger…" value={serviceProductName} onChange={(event) => setServiceProductName(event.target.value)} /></FormField>}<FormField label="IMEI (optional)"><div className="imei-input-wrap"><input className="input" maxLength={20} placeholder="15-digit IMEI" {...register("imei")} /><ScanBarcodeButton onScan={(value) => setValue("imei", value, { shouldValidate: true })} /></div></FormField><FormField label="Reported fault" error={errors.reportedFault?.message}><input className="input" required placeholder="Describe the issue" {...register("reportedFault")} /></FormField></div><div className="condition-label">
  Received condition <span>Select all that apply</span>
</div>

<div className="condition-list">
  {CONDITIONS.map((condition) => (
    <label
      key={condition}
      className={`condition-chip ${conditions.includes(condition) ? "checked" : ""}`}
    >
      <input
        type="checkbox"
        checked={conditions.includes(condition)}
        onChange={() => {
          toggleCondition(condition);

          if (condition === "Other" && conditions.includes("Other")) {
            setOtherCondition("");
          }
        }}
      />
      <span>{conditions.includes(condition) && <Check size={12} />}</span>
      {condition}
    </label>
  ))}
</div>

{conditions.includes("Other") && (
  <div style={{ marginTop: 12 }}>
    <input
      className="input"
      type="text"
      value={otherCondition}
      onChange={(event) => setOtherCondition(event.target.value)}
      placeholder="Please specify other condition..."
      autoFocus
    />
  </div>
)}<div className="form-grid two-col textareas"><FormField label="Technician notes"><textarea className="input textarea" placeholder="Notes for the repair team" {...register("technicianNotes")} /></FormField><FormField label="Additional remarks"><textarea className="input textarea" placeholder="Any other details about intake" {...register("remarks")} /></FormField></div></section>
      <section className="panel form-panel">
    <div className="form-section-head">
      <span className="step-number">03</span>
      <div>
        <h2>Service charge</h2>
        <p>Enter the service charge and advance payment received.</p>
      </div>
    </div>

    <div className="form-grid two-col">
      <FormField label="Service charge (₹)">
        <input
          className="input"
          type="number"
          min="0"
          value={amount || ""}
          placeholder="0"
          onChange={(event) => setAmount(Number(event.target.value))}
        />
      </FormField>
      <FormField label="Advance amount (₹)">
        <input
          className="input"
          type="number"
          min="0"
          max={amount}
          value={advance || ""}
          placeholder="0"
          onChange={(event) => setAdvance(Number(event.target.value))}
        />
      </FormField>
    </div>
  </section>
      {formError && <div className="form-alert">{formError}</div>}<div className="form-footer"><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button variant="secondary" onClick={() => void submitAndPrint()} disabled={busy}><Printer size={15} /> Save & print</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : <><Check size={16} /> Save service job</>}</Button></div>
    </div><aside className="billing-side"><div className="panel total-card"><div className="total-card-title"><span className="total-icon amber-icon"><Wrench size={17} /></span><span><strong>Service estimate</strong><small>Update as work progresses</small></span></div><div className="total-lines">
  <span>
    Service charge <strong>{money(amount)}</strong>
  </span>

  <span>
    Advance received <strong>{money(advance)}</strong>
  </span>

  <div className="total-final">
    <span>Total amount</span>
    <strong>{money(final)}</strong>
  </div>
</div>

<div className="balance-box">
  <span>Balance due</span>
  <strong>{money(balance)}</strong>
</div></div><div className="billing-tip"><Clock3 size={16} /><span>Service status starts as Received. Move it to Ready when repairs are complete.</span></div></aside></form>
  </>;
}

function ServicesPage({ services, vendors, search, onSearch, onCreate, onView, onEdit, onDelete, onPayment, onUpdate, onVendorChange, canEdit, settings }: {
  services: ServiceJob[]; search: string; onSearch: (value: string) => void; onCreate: () => void;
  vendors: ServiceVendor[];
  onView: (id: string) => void; onEdit?: (service: ServiceJob) => void; onDelete?: (service: ServiceJob) => void; onPayment: (id: string) => void; onUpdate: (service: ServiceJob) => void; canEdit: boolean;
  onVendorChange: (service: ServiceJob, vendorId?: string) => void;
  settings?: ShopSettings;
}) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [paymentFilter, setPaymentFilter] = useState("All payments");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortBy, setSortBy] = useState("date-desc");
  const [page, setPage] = useState(1);
  const vendorNames = new Map(vendors.map((vendor) => [vendor.id, vendor.name]));
  const filtered = services.filter((service) => (!search || `${service.serviceNumber} ${service.customerName} ${service.contactNumber} ${deviceLabel(service)} ${service.imei} ${vendorNames.get(service.vendorId ?? "") ?? ""}`.toLowerCase().includes(search.toLowerCase()))
    && (statusFilter === "All statuses"
      || (statusFilter === "Refund" ? service.returnOutcome === "Not repaired" : service.status === statusFilter))
    && (paymentFilter === "All payments"
      || (paymentFilter === "Refund" ? service.returnOutcome === "Not repaired" : statusOf(service.finalAmount, servicePaid(service)) === paymentFilter))
    && (!from || service.inDate.slice(0, 10) >= from)
    && (!to || service.inDate.slice(0, 10) <= to))
    .sort((a, b) => {
      const aCreated = a.createdAt || a.inDate;
      const bCreated = b.createdAt || b.inDate;
      if (sortBy === "amount-desc") return b.finalAmount - a.finalAmount;
      if (sortBy === "amount-asc") return a.finalAmount - b.finalAmount;
      const order = sortBy === "date-asc" ? 1 : -1;
      return order * (aCreated.localeCompare(bCreated) || a.serviceNumber.localeCompare(b.serviceNumber));
    });
  const pageSize = 8;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const exportServicesPdf = () => {
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const columns = [
      { title: "SERVICE BILL NO.", width: 25 },
      { title: "IN DATE", width: 19 },
      { title: "IN CUSTOMER NAME", width: 28 },
      { title: "MOBILE WITH MODEL", width: 32 },
      { title: "CUSTOMER NUMBER", width: 25 },
      { title: "STATUS", width: 20 },
      { title: "DELIVERY DATE", width: 21 },
      { title: "DELIVERY CUSTOMER", width: 31 },
      { title: "SERVICE CHARGE", width: 23 },
    ];
    const orderedServices = filtered;
    const serviceTotal = orderedServices.reduce((sum, service) =>
      sum + (service.returnOutcome === "Not repaired" ? 0 : service.serviceAmount), 0);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(16);
    pdf.text("Service Desk Report", margin, 13);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.text(`Period: ${from || "All"} to ${to || "All"}  |  Generated: ${dateLabel(new Date().toISOString())}`, margin, 20);
    pdf.text(`Jobs: ${orderedServices.length}  |  Service charges: ${pdfMoney(serviceTotal)}`, margin, 26);

    const drawTableHeader = (y: number) => {
      pdf.setFillColor(238, 242, 248);
      pdf.rect(margin, y - 4, columns.reduce((sum, column) => sum + column.width, 0), 7, "F");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7);
      let x = margin;
      columns.forEach((column) => {
        pdf.text(column.title, x + 1, y);
        x += column.width;
      });
      pdf.setFont("helvetica", "normal");
      return y + 6;
    };
    let y = drawTableHeader(34);
    orderedServices.forEach((service) => {
      const values = [
        service.serviceNumber,
        dateLabel(service.inDate),
        service.customerName,
        deviceLabel(service),
        service.contactNumber,
        vendorNames.get(service.vendorId ?? "") || "—",
        service.status,
        service.deliveryOutDate ? dateLabel(service.deliveryOutDate) : "—",
        service.deliveryOutPerson || "—",
        pdfMoney(service.returnOutcome === "Not repaired" ? 0 : service.serviceAmount),
      ];
      const lines = values.map((value, index) => {
  const column = columns[index];
  const width = column?.width ?? 25;
  return pdf.splitTextToSize(String(value || "—"), Math.max(5, width - 2)) as string[];
});
      const rowHeight = Math.max(6, ...lines.map((cellLines) => cellLines.length * 3.2 + 2));
      if (y + rowHeight > pageHeight - 12) {
        pdf.addPage();
        y = drawTableHeader(14);
      }
      let x = margin;
      lines.forEach((cellLines, index) => {
  const column = columns[index];

  if (!column) return;

  pdf.text(cellLines, x + 1, y, {
    maxWidth: Math.max(5, column.width - 2),
  });

  x += column.width;
});
      y += rowHeight;
      pdf.setDrawColor(225, 230, 238);
      pdf.line(margin, y - 2, margin + columns.reduce((sum, column) => sum + column.width, 0), y - 2);
    });
    const pageCount = pdf.getNumberOfPages();
    for (let page = 1; page <= pageCount; page += 1) {
      pdf.setPage(page);
      pdf.setFontSize(8);
      pdf.text(`Page ${page} of ${pageCount}`, pageWidth - margin, pageHeight - 5, { align: "right" });
    }
    pdf.save(`service-report-${dateInputValue()}.pdf`);
  };
  return <>
    <PageHeader eyebrow="REPAIR & CARE" title="Service desk" description="Track every repair from intake to handover."><Button variant="secondary" onClick={exportServicesPdf}><Download size={15} /> Export PDF</Button><Button variant="secondary" onClick={() => clientNavigate("/services/ready")}><CheckCircle2 size={15} /> Ready for pickup</Button>{canEdit && <Button onClick={onCreate}><Plus size={16} /> New service job</Button>}</PageHeader>
    <div className="service-kpis">{(["Received", "In progress", "Ready", "Returned", "Refund"] as const).map((status) => <div className="service-kpi" key={status}><span className={`status-dot ${statusClass(status)}`} /><span>{status}</span><strong>{status === "Refund" ? services.filter((item) => item.returnOutcome === "Not repaired").length : services.filter((item) => item.status === status && item.returnOutcome !== "Not repaired").length}</strong></div>)}</div>
    <div className="panel table-panel"><div className="table-toolbar"><label className="table-search"><Search size={16} /><input value={search} onChange={(event) => { onSearch(event.target.value); setPage(1); }} placeholder="Search bill, customer, model or IMEI…" /></label><div className="table-filters"><label className="select-wrap"><Filter size={15} /><select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}><option>All statuses</option>{(["Received", "In progress", "Ready", "Returned", "Refund"] as const).map((status) => <option key={status}>{status}</option>)}</select><ChevronDown size={14} /></label><label className="select-wrap"><select value={paymentFilter} onChange={(event) => { setPaymentFilter(event.target.value); setPage(1); }}><option>All payments</option><option>Paid</option><option>Partially paid</option><option>Unpaid</option><option>Refund</option></select><ChevronDown size={14} /></label><div className="date-range compact-date-range"><label>From<input aria-label="Services from date" className="input date-filter" type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} /></label><label>To<input aria-label="Services to date" className="input date-filter" type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} /></label></div><label className="select-wrap"><span>Sort</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value)}><option value="date-desc">Newest</option><option value="date-asc">Oldest</option><option value="amount-desc">Highest total</option><option value="amount-asc">Lowest total</option></select><ChevronDown size={14} /></label></div></div>
      {filtered.length ? <ServiceJobsTable services={filtered.slice((page - 1) * pageSize, page * pageSize)} vendors={vendors} onView={onView} onEdit={canEdit ? onEdit : undefined} onDelete={canEdit ? onDelete : undefined} onPayment={onPayment} onUpdate={onUpdate} onVendorChange={onVendorChange} canEdit={canEdit} settings={settings} /> : <EmptyState icon={Wrench} title={services.length ? "No matching service jobs" : "Ready for your first repair?"} detail={services.length ? "Try another search or status." : "Create a service job to track a device from intake to pickup."} action={!services.length && canEdit ? <Button onClick={onCreate}><Plus size={15} /> New service job</Button> : undefined} />}
      {filtered.length > 0 && <Pagination page={page} pages={pages} total={filtered.length} pageSize={pageSize} onPage={setPage} />}
    </div>
  </>;
}

function ServiceJobsTable({ services, vendors, onView, onEdit, onDelete, onPayment, onUpdate, onVendorChange, canEdit, settings }: {
  services: ServiceJob[];
  vendors: ServiceVendor[];
  onView: (id: string) => void;
  onEdit?: (service: ServiceJob) => void;
  onDelete?: (service: ServiceJob) => void;
  onPayment: (id: string) => void;
  onUpdate: (service: ServiceJob) => void;
  onVendorChange: (service: ServiceJob, vendorId?: string) => void;
  canEdit: boolean;
  settings?: ShopSettings;
}) {
  const sortedVendors = vendors.slice().sort((a, b) => a.name.localeCompare(b.name));
  return <div className="table-scroll"><table className="data-table"><thead><tr><th>SERVICE BILL NO.</th><th>IN DATE</th><th>IN CUSTOMER NAME</th><th>MOBILE WITH MODEL</th><th>CUSTOMER NUMBER</th><th>STATUS</th><th>DELIVERY DATE</th><th>DELIVERY CUSTOMER</th><th>SERVICE CHARGE</th><th /></tr></thead><tbody>{services.map((job) => {
    const due = Math.max(0, job.serviceAmount - job.discount - servicePaid(job));
    return <tr key={job.id}><td><button className="table-primary-link" onClick={() => onView(job.id)}>{job.serviceNumber}</button></td><td><span className="muted-cell">{dateLabel(job.inDate)}</span></td><td><strong>{job.customerName}</strong></td><td><strong>{deviceLabel(job)}</strong></td><td>{job.contactNumber}</td><td>{job.returnOutcome === "Not repaired" ? <StatusBadge status="Refund" /> : <select className={`status-select status-${statusClass(job.status)}`} value={job.status} disabled={!canEdit || job.status === "Returned"} aria-label={`Update status for ${job.serviceNumber}`} onChange={(event) => onUpdate({ ...job, status: event.target.value as ServiceStatus, readyAt: event.target.value === "Ready" ? new Date().toISOString() : job.readyAt })}>{(["Received", "In progress", "Ready", "Returned"] as ServiceStatus[]).map((status) => <option key={status}>{status}</option>)}</select>}</td><td><span className="muted-cell">{job.deliveryOutDate ? dateLabel(job.deliveryOutDate) : "—"}</span></td><td>{job.deliveryOutPerson || "—"}</td><td><strong>{money(job.returnOutcome === "Not repaired" ? 0 : job.serviceAmount)}</strong></td><td><WhatsAppAction phone={job.contactNumber} customerName={job.customerName} /><button className="row-action" aria-label="View service details" title="View details" onClick={() => onView(job.id)}><ArrowRight size={15} /></button>{onEdit && <button className="row-action" aria-label="Edit service" title="Edit service" onClick={() => onEdit(job)}><Pencil size={15} /></button>}{onDelete && <button className="row-action danger-action" aria-label="Delete service" title="Delete service" onClick={() => onDelete(job)}><Trash2 size={15} /></button>}{canEdit && due > 0 && <button className="row-action" aria-label="Record service payment" title="Record payment" onClick={() => onPayment(job.id)}><Plus size={15} /></button>}{settings && <button className="row-action" aria-label="Thermal invoice" title="Thermal invoice" onClick={() => printServiceInvoice(job, settings, true)}><Printer size={15} /></button>}</td></tr>;
  })}</tbody></table></div>;
}

function ReadyPage({ services, vendorServices, vendors, onView, onPayment, onReturn, onVendorStatusChange, canEditPayment, canReturn, canViewAllServices, settings }: {
  services: ServiceJob[];
  vendorServices: VendorService[];
  vendors: ServiceVendor[];
  onView: (id: string) => void;
  onPayment: (id: string) => void;
  onReturn: (service: ServiceJob) => void;
  onVendorStatusChange: (service: VendorService, status: ServiceStatus) => void;
  canEditPayment: boolean;
  canReturn: boolean;
  canViewAllServices: boolean;
  settings?: ShopSettings;
}) {
  const router = useRouter();
  const [activeList, setActiveList] = useState<"services" | "vendor">("services");
  const readyJobs = services.filter((service) => service.status === "Ready")
    .sort((a, b) => (b.readyAt ?? "").localeCompare(a.readyAt ?? ""));
  const readyVendorServices = vendorServices.filter((service) => service.status === "Ready")
    .sort((a, b) => (b.inDate ?? "").localeCompare(a.inDate ?? ""));
  const readyCount = readyJobs.length + readyVendorServices.length;
  return <>
    <PageHeader eyebrow="SERVICE DESK · HANDOVER" title="Ready for delivery" description="The finishing touch: get these repaired devices back to their owners.">
      {canViewAllServices && <Button variant="secondary" onClick={() => clientNavigate("/services")}><Wrench size={15} /> All service jobs</Button>}
    </PageHeader>
    <div className="segmented" style={{ width: "fit-content", marginBottom: 18 }}>
      <button type="button" className={activeList === "services" ? "selected" : ""} onClick={() => setActiveList("services")}>
        Services ({readyJobs.length})
      </button>
      <button type="button" className={activeList === "vendor" ? "selected" : ""} onClick={() => setActiveList("vendor")}>
        Vendor Services ({readyVendorServices.length})
      </button>
    </div>
    <div className="delivery-summary">
      <span className="delivery-summary-icon"><CheckCircle2 size={18} /></span>
      <div>
        <strong>{activeList === "services" ? readyJobs.length : readyVendorServices.length} {activeList === "services" ? "shop service" : "vendor service"}{(activeList === "services" ? readyJobs.length : readyVendorServices.length) === 1 ? "" : "s"} ready</strong>
        <span>{activeList === "services" ? "Collect any remaining balance before handover." : "Vendor service entries marked Ready are listed here."}</span>
      </div>
      {activeList === "services" && <strong className="delivery-total">
        {money(readyJobs.reduce((sum, item) => sum + Math.max(0, item.serviceAmount - item.discount - servicePaid(item)), 0))}
        <small>total balance</small>
      </strong>}
      {activeList === "vendor" && <strong className="delivery-total">{readyVendorServices.length}<small>ready entries</small></strong>}
    </div>
    {activeList === "services" ? (
      readyJobs.length ? <div className="ready-grid">{readyJobs.map((job) => {
        const due = Math.max(0, job.serviceAmount - job.discount - servicePaid(job));
        return <article className="ready-card" key={job.id}>
          <div className="ready-card-top"><span className="ready-device-icon"><Smartphone size={20} /></span><StatusBadge status="Ready" /><button className="more-btn" aria-label="More actions" onClick={() => onView(job.id)}><MoreHorizontal size={18} /></button></div>
          <div className="ready-card-id">{job.serviceNumber}</div><h2>{deviceLabel(job)}</h2><p>{job.reportedFault}</p>
          <div className="ready-customer"><span className="mini-avatar amber-avatar">{job.customerName[0]?.toUpperCase() || "?"}</span><span><strong>{job.customerName}</strong><small>{job.contactNumber}</small></span></div>
          <div className="ready-card-meta"><span>Ready since <strong>{dateLabel(job.readyAt ?? job.inDate)}</strong></span><span>Balance <strong className={due ? "balance-due" : "balance-paid"}>{money(due)}</strong></span></div>
          {(canEditPayment || canReturn) && <div className="ready-card-actions">
  <Button
    variant="secondary"
    disabled={!whatsappUrl(job.contactNumber)}
    onClick={() => {
      const message = `Hello ${job.customerName}! Your ${deviceLabel(job)} is ready for delivery at AH Mobiles. Service Bill: ${job.serviceNumber}. Please visit our shop to collect your device. Thank you!`;
      const url = whatsappUrl(job.contactNumber, message);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    }}
  >
    <MessageCircle size={15} /> WhatsApp
  </Button>

  {settings && (
    <Button variant="secondary" onClick={() => printServiceInvoice(job, settings, true)}>
      <Printer size={14} /> Thermal bill
    </Button>
  )}

  {canEditPayment && due > 0 && (
    <Button variant="secondary" onClick={() => onPayment(job.id)}>
      <CreditCard size={14} /> Collect payment
    </Button>
  )}

  {canReturn && (
    <Button onClick={() => onReturn(job)} disabled={due > 0}>
      <Check size={15} />
      {due > 0 ? "Payment pending" : "Mark returned"}
    </Button>
  )}
</div>}
        </article>;
      })}</div> : <div className="panel"><EmptyState icon={CheckCircle2} title="No shop services ready" detail="When a service job is marked Ready, it will appear here." action={canViewAllServices ? <Button variant="secondary" onClick={() => clientNavigate("/services")}><Wrench size={15} /> View service jobs</Button> : undefined} /></div>
    ) : (
      readyVendorServices.length ? <div className="ready-grid">{readyVendorServices.map((service) => {
        const vendor = vendors.find((item) => item.id === service.vendorId);
        return <article className="ready-card" key={service.id}>
          <div className="ready-card-top"><span className="ready-device-icon"><Store size={20} /></span><StatusBadge status="Ready" /></div>
          <div className="ready-card-id">{service.serviceNumber}</div>
          <h2>{service.brand} {service.mobileModel}</h2>
          <p>{vendor?.name ?? "Vendor not found"} · {service.receivedCondition || "Condition not specified"}</p>
          <div className="ready-customer"><span className="mini-avatar amber-avatar">{service.customerName[0]?.toUpperCase() || "?"}</span><span><strong>In person: {service.customerName}</strong><small>{service.customerNumber}</small></span></div>
          <div className="ready-card-meta">
            <span>Received <strong>{dateLabel(service.inDate)}</strong></span>
            <span>Charge <strong>{money(service.serviceCharge)}</strong></span>
          </div>
          <div className="ready-card-meta"><span>Out person <strong>{service.deliveryCustomer || "—"}</strong></span><span>Delivery <strong>{service.deliveryDate ? dateLabel(service.deliveryDate) : "—"}</strong></span></div>
          {canReturn && <div className="ready-card-actions">
            <Button onClick={() => onVendorStatusChange(service, "Returned")}><Check size={15} /> Mark returned</Button>
          </div>}
        </article>;
      })}</div> : <div className="panel"><EmptyState icon={Store} title="No vendor services ready" detail="Vendor service records marked Ready will appear here." /></div>
    )}
  </>;
}

function ServiceDetail({ service, vendor, settings, onBack, onPayment, onEdit, onDelete, onUpdate, onNotRepaired, canEdit }: {
  service?: ServiceJob; vendor?: ServiceVendor; settings: ShopSettings; onBack: () => void; onPayment: (id: string) => void; onEdit?: (service: ServiceJob) => void; onDelete?: (service: ServiceJob) => void; onUpdate: (service: ServiceJob) => void; onNotRepaired: (service: ServiceJob) => void; canEdit: boolean;
}) {
  if (!service) return <NotFound title="Service job not found" backLabel="Back to services" onBack={onBack} />;
  const due = serviceDue(service);
  return <>
    <PageHeader eyebrow="SERVICE JOB" title={service.serviceNumber} description={`${deviceLabel(service)} · Received ${dateLabel(service.inDate)}`}>
      <Button variant="secondary" onClick={onBack}><ArrowLeft size={15} /> All services</Button>
      {canEdit && onEdit && <Button variant="secondary" onClick={() => onEdit(service)}><Pencil size={15} /> Edit service</Button>}
      {canEdit && onDelete && <Button variant="danger" onClick={() => onDelete(service)}><Trash2 size={15} /> Delete service</Button>}
      <Button variant="secondary" onClick={() => downloadServiceReceipt(service, settings)}><Download size={15} /> Download PDF</Button>
      <Button variant="secondary" onClick={() => printReceipt(service, settings)}><FileText size={15} /> Intake receipt</Button>
      <Button onClick={() => printServiceInvoice(service, settings, true)}><Printer size={15} /> Thermal bill</Button>
      <Button variant="secondary" onClick={() => printServiceInvoice(service, settings, false)}><Printer size={15} /> A4 invoice</Button>
      {canEdit && service.status !== "Returned" && <Button variant="danger" onClick={() => onNotRepaired(service)}>Not repaired · Return device</Button>}
    </PageHeader>
    <div className="detail-grid"><div className="detail-main">
      <section className="panel detail-panel"><div className="panel-heading"><div><h2>Repair status</h2><p>Track the job from intake through handover.</p></div><select className={`status-select status-${statusClass(service.status)}`} value={service.status} disabled={!canEdit || service.status === "Returned"} onChange={(event) => onUpdate({ ...service, status: event.target.value as ServiceStatus, readyAt: event.target.value === "Ready" ? new Date().toISOString() : service.readyAt, deliveryOutDate: event.target.value === "Returned" ? new Date().toISOString() : service.deliveryOutDate })}>{(["Received", "In progress", "Ready", "Returned"] as ServiceStatus[]).map((status) => <option key={status}>{status}</option>)}</select></div><div className="status-timeline">{(["Received", "In progress", "Ready", "Returned"] as ServiceStatus[]).map((status, index) => { const completed = (["Received", "In progress", "Ready", "Returned"] as string[]).indexOf(service.status) >= index; return <div className={`timeline-step ${completed ? "done" : ""}`} key={status}><span>{completed ? <Check size={13} /> : index + 1}</span><strong>{status}</strong>{index < 3 && <i />}</div>; })}</div></section>
      <section className="panel detail-panel"><div className="panel-heading"><div><h2>Device & issue</h2><p>What came in, and what needs attention.</p></div></div><div className="detail-fields"><DetailField label="Customer" value={service.customerName} /><DetailField label="Contact number" value={service.contactNumber} /><DetailField label="Customer address" value={service.customerAddress || "Not recorded"} /><DetailField label={service.category === "Accessories" ? "Product" : "Device"} value={deviceLabel(service)} /><DetailField label="Service vendor" value={vendor ? `${vendor.name} · ${vendor.phone}` : "Not assigned"} /><DetailField label="IMEI" value={service.imei || "Not recorded"} /><DetailField label="Reported fault" value={service.reportedFault} /><DetailField label="Received condition" value={service.receivedConditions.join(", ") || "Not specified"} /><DetailField label="Technician notes" value={service.technicianNotes || "—"} /><DetailField label="Additional remarks" value={service.remarks || "—"} /></div></section>
      <section className="panel detail-panel"><div className="panel-heading">
  <div>
    <h2>Payment history</h2>
    <p>Payments are recorded as separate entries.</p>
  </div>
</div>{(service.payments.length || (service.refunds?.length ?? 0)) ? <div className="payment-history">{service.payments.map((payment) => <div className="payment-row" key={payment.id}><span className="payment-method-icon"><CreditCard size={15} /></span><span><strong>Amount received</strong><small>{dateLabel(payment.date)}{payment.notes ? ` · ${payment.notes}` : ""}</small></span><strong className="paid-amount">{money(payment.amount)}</strong></div>)}{(service.refunds ?? []).map((refund) => <div className="payment-row" key={refund.id}><span className="payment-method-icon"><ArrowLeft size={15} /></span><span><strong>Returned to customer</strong><small>{dateLabel(refund.date)}{refund.notes ? ` · ${refund.notes}` : ""}</small></span><strong className="returned-amount" style={{ color: "#dc2626" }}>− {money(refund.amount)}</strong></div>)}</div> : <div className="quiet-empty">No payments recorded yet.</div>}</section>
      {(service.deliveryHistory?.length ?? 0) > 0 && <section className="panel detail-panel"><div className="panel-heading"><div><h2>Delivery history</h2><p>Recorded handovers for this device.</p></div></div><div className="payment-history">{service.deliveryHistory?.slice().reverse().map((entry, index) => <div className="payment-row" key={`${entry.date}-${index}`}><span className="payment-method-icon"><CheckCircle2 size={15} /></span><span><strong>Handed over to customer</strong><small>{dateLabel(entry.date)} · Picked up by {entry.person}{entry.staff ? ` · Returned by ${entry.staff}` : ""}{entry.remarks ? ` · ${entry.remarks}` : ""}</small></span></div>)}</div></section>}
    </div><aside className="detail-aside"><div className="panel total-card"><div className="total-card-title"><span className="total-icon amber-icon"><Wrench size={17} /></span><span><strong>Service balance</strong><small>{service.returnOutcome === "Not repaired" ? "Refund" : service.status}</small></span></div><div className="total-lines"><span>Service amount <strong>{money(service.returnOutcome === "Not repaired" ? 0 : service.serviceAmount)}</strong></span><span>Discount <strong>− {money(service.discount)}</strong></span><span>Net advance received <strong>{money(servicePaid(service))}</strong></span>{(service.refunds?.length ?? 0) > 0 && <span>Advance refunded <strong>− {money((service.refunds ?? []).reduce((sum, refund) => sum + refund.amount, 0))}</strong></span>}<div className="total-final"><span>Balance due</span><strong>{money(due)}</strong></div></div>{canEdit && due > 0 && <Button className="btn-full" onClick={() => onPayment(service.id)}><CreditCard size={15} /> Record payment</Button>}<Button variant="secondary" className="btn-full" style={{ marginTop: 8 }} onClick={() => printServiceInvoice(service, settings, true)}><Printer size={15} /> Print thermal bill</Button></div>{service.deliveryOutDate && <div className="panel delivery-note"><CheckCircle2 size={17} /><strong>{service.returnOutcome === "Not repaired" ? "Returned · Not repaired" : "Device returned"}</strong><span>{dateLabel(service.deliveryOutDate)}{service.deliveryOutPerson ? ` · Picked up by ${service.deliveryOutPerson}` : ""}{service.deliveryOutStaff ? ` · Returned by ${service.deliveryOutStaff}` : ""}</span>{service.deliveryRemarks && <small>{service.deliveryRemarks}</small>}</div>}</aside></div>
  </>;
}

function SaleDetail({ sale, settings, onBack, onPayment, onEdit, onDelete, canEdit }: {
  sale?: Sale; settings: ShopSettings; onBack: () => void; onPayment: (id: string) => void; onEdit?: (sale: Sale) => void; onDelete?: (sale: Sale) => void; canEdit: boolean;
}) {
  if (!sale) return <NotFound title="Invoice not found" backLabel="Back to sales" onBack={onBack} />;
  const paid = paymentTotal(sale.payments);
  const due = Math.max(0, sale.finalAmount - paid);
  return <>
    <PageHeader eyebrow="SALES INVOICE" title={sale.invoiceNumber} description={`${sale.customerName} · ${dateLabel(sale.invoiceDate)}`}>
      <Button variant="secondary" onClick={onBack}><ArrowLeft size={15} /> Sales history</Button>
      {canEdit && onEdit && <Button variant="secondary" onClick={() => onEdit(sale)}><Pencil size={15} /> Edit sale</Button>}
      {canEdit && onDelete && <Button variant="danger" onClick={() => onDelete(sale)}><Trash2 size={15} /> Delete sale</Button>}
      <Button variant="secondary" onClick={() => downloadInvoice(sale, settings)}><Download size={15} /> Download PDF</Button>
      <Button onClick={() => printInvoice(sale, settings)}><Printer size={15} /> Print invoice</Button>
    </PageHeader>
    <div className="detail-grid"><div className="detail-main"><InvoicePreview sale={sale} settings={settings} /><section className="panel detail-panel"><div className="panel-heading"><div><h2>Payment history</h2><p>Every payment is listed separately.</p></div>{canEdit && due > 0 && <Button variant="secondary" onClick={() => onPayment(sale.id)}><Plus size={14} /> Add payment</Button>}</div>{sale.payments.length ? <div className="payment-history">{sale.payments.map((payment) => <div className="payment-row" key={payment.id}><span className="payment-method-icon"><CreditCard size={15} /></span><span><strong>Amount received</strong><small>{dateLabel(payment.date)}{payment.notes ? ` · ${payment.notes}` : ""}</small></span><strong className="paid-amount">{money(payment.amount)}</strong></div>)}</div> : <div className="quiet-empty">No payments recorded yet.</div>}</section></div><aside className="detail-aside"><div className="panel total-card"><div className="total-card-title"><span className="total-icon"><CreditCard size={17} /></span><span><strong>Payment summary</strong><small>{statusOf(sale.finalAmount, paid)}</small></span></div><div className="total-lines"><span>Subtotal <strong>{money(sale.subtotal)}</strong></span><span>Discount <strong>− {money(sale.discount)}</strong></span><span>Tax <strong>{money(sale.tax)}</strong></span><div className="total-final"><span>Invoice total</span><strong>{money(sale.finalAmount)}</strong></div><span>Paid <strong>{money(paid)}</strong></span></div><div className={`balance-box ${due <= 0 ? "settled" : ""}`}><span>Balance due</span><strong>{money(due)}</strong></div>{canEdit && due > 0 && <Button className="btn-full" onClick={() => onPayment(sale.id)}><CreditCard size={15} /> Record payment</Button>}</div></aside></div>
  </>;
}

function InvoicePreview({ sale, settings }: { sale: Sale; settings: ShopSettings }) {
  return <div className="panel invoice-sheet">
    <div className="invoice-brand">
      <div className="invoice-brand-info">
        <div className="invoice-logo" role="img" aria-label="AH Mobiles logo" style={{ backgroundColor: settings.logoDataUrl ? "#fff" : "#000", backgroundImage: `url("${settings.logoDataUrl || BRAND_LOGO_PATH}")` }} />
        <div className="invoice-shop-info"><span>{settings.address || "Shop address not set"}</span><span>{settings.phone || "Contact number not set"}</span>{settings.gstin && <span>GSTIN: {settings.gstin}</span>}</div>
      </div>
      <div className="invoice-label"><strong>INVOICE</strong><span>{sale.invoiceNumber}</span><small>{dateLabel(sale.invoiceDate)}</small></div>
    </div>
    <div className="invoice-customer"><span>BILLED TO</span><strong>{sale.customerName}</strong><small>{sale.contactNumber}</small>{sale.customerAddress && <small>{sale.customerAddress}</small>}</div>
    <div className="table-scroll"><table className="invoice-table">
      <colgroup><col style={{ width: "23%" }} /><col style={{ width: "23%" }} /><col style={{ width: "8%" }} /><col style={{ width: "14%" }} /><col style={{ width: "15%" }} /><col style={{ width: "17%" }} /></colgroup>
      <thead><tr><th scope="col">ITEM</th><th scope="col">IMEI / SERIAL</th><th scope="col">QTY</th><th scope="col">RATE</th><th scope="col">DISCOUNT</th><th scope="col">AMOUNT</th></tr></thead>
      <tbody>{sale.products.map((product) => <tr key={product.id}>
        <td><strong>{deviceLabel(product)}</strong></td><td>{product.imei || "—"}</td><td>{product.quantity}</td>
        <td>{money(product.rate)}</td><td>{money(product.discount)}</td><td><strong>{money(product.quantity * product.rate - product.discount)}</strong></td>
      </tr>)}</tbody>
    </table></div>
    <div className="invoice-totals"><span>Subtotal <strong>{money(sale.subtotal)}</strong></span><span>Discount <strong>− {money(sale.discount)}</strong></span><span>Tax <strong>{money(sale.tax)}</strong></span><span className="invoice-grand">Invoice total <strong>{money(sale.finalAmount)}</strong></span><span>Paid <strong>{money(paymentTotal(sale.payments))}</strong></span><span>Balance due <strong>{money(Math.max(0, sale.finalAmount - paymentTotal(sale.payments)))}</strong></span></div>
    <div className="invoice-footer-note">{settings.invoiceFooter}</div><div className="invoice-signatures"><span>Customer signature</span><span>Authorized signature</span></div>
  </div>;
}

async function loadLogoDataUrl(source: string): Promise<string> {
  if (source.startsWith("data:image/")) return source;
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Could not prepare the AH Mobiles logo for the invoice."));
        return;
      }
      context.drawImage(image, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => reject(new Error("Could not load the AH Mobiles logo for the invoice."));
    image.src = source;
  });
}

async function downloadInvoice(sale: Sale, settings: ShopSettings) {
  let logoData: string;
  try {
    logoData = await loadLogoDataUrl(settings.logoDataUrl || BRAND_LOGO_PATH);
  } catch (reason) {
    window.alert(reason instanceof Error ? reason.message : "Could not load the invoice logo.");
    return;
  }
  const pdf = new jsPDF();
  const shopTextX = 72;
  const logoFormat = logoData.startsWith("data:image/png") ? "PNG" : "JPEG";
  pdf.addImage(logoData, logoFormat, 16, 8, 48, 32);
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(9);
  if (settings.address) pdf.text(settings.address, shopTextX, 20, { maxWidth: 105 });
  if (settings.phone) pdf.text(`Phone: ${settings.phone}`, shopTextX, 27);
  if (settings.gstin) pdf.text(`GSTIN: ${settings.gstin}`, shopTextX, 33);
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(14); pdf.text("SALES INVOICE", 194, 20, { align: "right" });
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(10); pdf.text(sale.invoiceNumber, 194, 27, { align: "right" }); pdf.text(dateLabel(sale.invoiceDate), 194, 33, { align: "right" });
  pdf.setDrawColor(225, 230, 238); pdf.line(16, 43, 194, 43);
  pdf.setFont("helvetica", "bold"); pdf.text("BILLED TO", 16, 53); pdf.setFont("helvetica", "normal"); pdf.text(sale.customerName, 16, 60); pdf.text(sale.contactNumber, 16, 66);
  const customerAddressLines = sale.customerAddress ? pdf.splitTextToSize(sale.customerAddress, 75) as string[] : [];
  if (customerAddressLines.length) pdf.text(customerAddressLines, 16, 72);
  let y = 81 + Math.max(0, customerAddressLines.length - 1) * 5;
  const columnDividers = [70, 116, 132, 153, 176];
  const drawTableHeader = (baseline: number) => {
    pdf.setFillColor(245, 247, 251); pdf.rect(16, baseline - 6, 178, 10, "F");
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(8);
    pdf.text("ITEM", 18, baseline); pdf.text("IMEI / SERIAL", 74, baseline); pdf.text("QTY", 126, baseline, { align: "right" }); pdf.text("RATE", 150, baseline, { align: "right" }); pdf.text("DISCOUNT", 174, baseline, { align: "right" }); pdf.text("AMOUNT", 192, baseline, { align: "right" });
    pdf.setDrawColor(225, 230, 238);
    columnDividers.forEach((x) => pdf.line(x, baseline - 6, x, baseline + 5));
  };
  drawTableHeader(y);
  y += 11; pdf.setFont("helvetica", "normal"); pdf.setFontSize(8.5);
  sale.products.forEach((product) => {
    if (y > 250) { pdf.addPage(); y = 22; drawTableHeader(y); y += 11; pdf.setFont("helvetica", "normal"); pdf.setFontSize(8.5); }
    const rowTop = y - 6;
    pdf.text(deviceLabel(product).slice(0, 27), 18, y);
    pdf.text(product.imei || "—", 74, y);
    pdf.text(String(product.quantity), 126, y, { align: "right" });
    pdf.text(pdfMoney(product.rate), 150, y, { align: "right" });
    pdf.text(pdfMoney(product.discount), 174, y, { align: "right" });
    pdf.text(pdfMoney(product.quantity * product.rate - product.discount), 192, y, { align: "right" });
    y += 9;
    pdf.setDrawColor(225, 230, 238);
    columnDividers.forEach((x) => pdf.line(x, rowTop, x, y - 3));
  });
  y += 8; pdf.setDrawColor(225, 230, 238); pdf.line(117, y - 4, 194, y - 4);
  const totals: [string, string][] = [["Subtotal", pdfMoney(sale.subtotal)], ["Discount", `- ${pdfMoney(sale.discount)}`], ["Tax", pdfMoney(sale.tax)], ["Invoice total", pdfMoney(sale.finalAmount)], ["Paid", pdfMoney(paymentTotal(sale.payments))], ["Balance due", pdfMoney(Math.max(0, sale.finalAmount - paymentTotal(sale.payments)))]];
  pdf.setFontSize(9); totals.forEach(([label, amount], index) => { if (index === 3) pdf.setFont("helvetica", "bold"); else if (index > 3) pdf.setFont("helvetica", "normal"); pdf.text(label, 119, y); pdf.text(amount, 192, y, { align: "right" }); y += 7; });
  y += 14; pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.text((settings.invoiceFooter || "Thank you for your business.").slice(0, 100), 16, y);
  y += 20; pdf.setDrawColor(180, 185, 195); pdf.line(16, y, 80, y); pdf.line(130, y, 194, y); pdf.text("Customer signature", 16, y + 6); pdf.text("Authorized signature", 130, y + 6);
  pdf.save(`${sale.invoiceNumber}.pdf`);
}

function printInvoice(sale: Sale, settings: ShopSettings) {
  const popup = window.open("", "_blank", "width=900,height=720");
  if (!popup) { window.alert("Please allow pop-ups to print this invoice."); return; }
  const thermal = settings.invoicePaperSize === "Thermal";
  const rows = sale.products.map((item) => thermal
    ? `<tr><td>${escapeHtml(deviceLabel(item))}<small>IMEI: ${escapeHtml(item.imei || "—")}</small></td><td>${item.quantity}</td><td>${money(item.quantity * item.rate - item.discount)}</td></tr>`
    : `<tr><td>${escapeHtml(deviceLabel(item))}</td><td>${escapeHtml(item.imei || "—")}</td><td>${item.quantity}</td><td>${money(item.rate)}</td><td>${money(item.discount)}</td><td>${money(item.quantity * item.rate - item.discount)}</td></tr>`).join("");
  const headers = thermal
    ? "<th>PRODUCT</th><th>QTY</th><th>TOTAL</th>"
    : "<th>PRODUCT</th><th>IMEI</th><th>QTY</th><th>RATE</th><th>DISCOUNT</th><th>TOTAL</th>";
  const pageSize = thermal ? "80mm auto;margin:5mm" : "A4;margin:16mm";
  const bodyLayout = thermal ? "body{width:70mm;padding:0}.head{gap:8px}.head h2{font-size:16px}.shop-logo{width:80px;height:53px}table{margin:18px 0}th,td{padding:5px 2px;font-size:10px}aside{width:100%}.sign{margin-top:42px}" : "body{padding:32px}.head{padding-bottom:18px}.shop-logo{width:120px;height:80px}table{margin:28px 0}th,td{padding:10px 6px}aside{margin-left:auto;width:260px}.sign{margin-top:64px}";
  const logoBackground = settings.logoDataUrl ? "#fff" : "#000";
  const logo = `<img class="shop-logo" style="background:${logoBackground}" src="${escapeHtml(settings.logoDataUrl || BRAND_LOGO_PATH)}" alt="AH Mobiles">`;
  const gstin = settings.gstin ? `<div class="muted">GSTIN: ${escapeHtml(settings.gstin)}</div>` : "";
  popup.document.write(`<html><head><title>${escapeHtml(sale.invoiceNumber)}</title><style>body{font:13px Arial;color:#111}.head{display:flex;justify-content:space-between;border-bottom:1px solid #ddd}.shop{display:flex;align-items:flex-start;gap:8px}.shop-logo{width:120px;height:80px;object-fit:contain;background:#000;border-radius:4px}.muted{color:#666;font-size:12px}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid #ddd}th:not(:last-child),td:not(:last-child){border-right:1px solid #ddd}th{font-size:10px;color:#666}aside p{display:flex;justify-content:space-between}.total{font-weight:bold;border-top:1px solid #bbb;padding-top:10px}.sign{display:flex;justify-content:space-between}small{display:block;color:#777;margin-top:7px}@media print{@page{size:${pageSize}}${bodyLayout}}</style></head><body><div class="head"><div class="shop">${logo}<div><div class="muted">${escapeHtml(settings.address)}</div><div class="muted">${escapeHtml(settings.phone)}</div>${gstin}</div></div><div><h2>INVOICE</h2><strong>${escapeHtml(sale.invoiceNumber)}</strong><small>${dateLabel(sale.invoiceDate)}</small></div></div><p><strong>${escapeHtml(sale.customerName)}</strong><br>${escapeHtml(sale.contactNumber)}${sale.customerAddress ? `<br>${escapeHtml(sale.customerAddress)}` : ""}</p><table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table><aside><p>Subtotal <strong>${money(sale.subtotal)}</strong></p><p>Discount <strong>− ${money(sale.discount)}</strong></p><p>Tax <strong>${money(sale.tax)}</strong></p><p class="total">Total <strong>${money(sale.finalAmount)}</strong></p><p>Paid <strong>${money(paymentTotal(sale.payments))}</strong></p><p>Balance <strong>${money(Math.max(0, sale.finalAmount - paymentTotal(sale.payments)))}</strong></p></aside><p>${escapeHtml(settings.invoiceFooter)}</p><div class="sign"><span>Customer signature</span><span>Authorized signature</span></div><script>window.onload=()=>window.print()</script></body></html>`);
  popup.document.close();
}

function printReceipt(service: ServiceJob, settings: ShopSettings) {
  const popup = window.open("", "_blank", "width=500,height=720");
  if (!popup) { window.alert("Please allow pop-ups to print this receipt."); return; }
  const logo = escapeHtml(settings.logoDataUrl || BRAND_LOGO_PATH);
  const logoBackground = settings.logoDataUrl ? "#fff" : "#000";
  popup.document.write(`<html><head><title>${escapeHtml(service.serviceNumber)}</title><style>body{font:13px Arial;padding:24px;color:#111}.brand{text-align:center}.shop-logo{width:48px;height:32px;object-fit:contain;background:#000;border-radius:4px}h2{margin:4px 0}p{line-height:1.55}.line{border-top:1px dashed #888;margin:18px 0}.sign{margin-top:42px}@media print{@page{size:80mm auto;margin:5mm}}</style></head><body><div class="brand"><img class="shop-logo" style="background:${logoBackground}" src="${logo}" alt="AH Mobiles"></div><p>${escapeHtml(settings.address)}<br>${escapeHtml(settings.phone)}<br>Service receipt · ${escapeHtml(service.serviceNumber)}<br>In date: ${dateLabel(service.inDate)}</p><div class="line"></div><p><strong>${escapeHtml(service.customerName)}</strong><br>${escapeHtml(service.contactNumber)}${service.customerAddress ? `<br>${escapeHtml(service.customerAddress)}` : ""}<br>${escapeHtml(deviceLabel(service))}<br>IMEI: ${escapeHtml(service.imei || "—")}</p><p>Reported fault: ${escapeHtml(service.reportedFault)}<br>Condition: ${escapeHtml(service.receivedConditions.join(", "))}</p><div class="line"></div><p>Estimate: ${money(service.serviceAmount - service.discount)}<br>Advance: ${money(servicePaid(service))}<br>Balance: ${money(serviceDue(service))}</p><p>Device passwords and patterns are never printed.</p><p class="sign">Customer acknowledgment __________________</p><script>window.onload=()=>window.print()</script></body></html>`);
  popup.document.close();
}

function printServiceInvoice(service: ServiceJob, settings: ShopSettings, forceThermal?: boolean) {
  const thermal = forceThermal ?? (settings.invoicePaperSize === "Thermal");
  const popup = window.open("", "_blank", thermal ? "width=480,height=720" : "width=900,height=720");
  if (!popup) { window.alert("Please allow pop-ups to print this invoice."); return; }

  const total = service.returnOutcome === "Not repaired" ? 0 : service.serviceAmount - service.discount;
  const paid = servicePaid(service);
  const due = serviceDue(service);
  const logoBackground = settings.logoDataUrl ? "#fff" : "#000";
  const logo = `<img class="shop-logo" style="background:${logoBackground}" src="${escapeHtml(settings.logoDataUrl || BRAND_LOGO_PATH)}" alt="AH Mobiles">`;
  const gstin = settings.gstin ? `<div class="muted">GSTIN: ${escapeHtml(settings.gstin)}</div>` : "";

  const paymentRows = (service.payments && service.payments.length > 0)
    ? `<div class="payments-box"><div class="payments-title">PAYMENTS RECEIVED</div>${service.payments.map((p) => `<div class="pay-line"><span>${dateLabel(p.date)}${p.notes ? ` (${escapeHtml(p.notes)})` : ""}</span><strong>${money(p.amount)}</strong></div>`).join("")}</div>`
    : "";

  const thermalStyles = `
    * { box-sizing: border-box; }
    body { font: 12px/1.35 'Courier New', Courier, monospace, Arial, sans-serif; color: #000; width: 70mm; margin: 0 auto; padding: 4px 0; }
    .text-center { text-align: center; }
    .head { text-align: center; margin-bottom: 6px; }
    .shop-logo { width: 80px; height: 53px; object-fit: contain; background: #000; border-radius: 4px; margin: 0 auto 4px; display: block; }
    h2 { font-size: 16px; margin: 2px 0; font-weight: bold; letter-spacing: -0.3px; }
    .muted { color: #222; font-size: 11px; line-height: 1.3; }
    .divider { border-top: 1px dashed #000; margin: 6px 0; }
    .inv-title { font-size: 14px; font-weight: bold; text-align: center; letter-spacing: 0.5px; margin: 4px 0; text-transform: uppercase; }
    .meta-row { display: flex; justify-content: space-between; font-size: 11px; margin: 2px 0; }
    .meta-row strong { font-weight: bold; }
    .item-block { margin: 6px 0; }
    .item-name { font-size: 13px; font-weight: bold; }
    .item-detail { font-size: 11px; color: #111; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; margin: 6px 0; }
    th { text-align: left; font-size: 10px; border-bottom: 1px solid #000; padding: 3px 0; text-transform: uppercase; }
    td { padding: 4px 0; font-size: 11px; vertical-align: top; }
    .totals { margin: 6px 0; }
    .totals p { display: flex; justify-content: space-between; margin: 3px 0; font-size: 12px; }
    .totals p.total { font-size: 13px; font-weight: bold; border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 4px 0; margin: 5px 0; }
    .balance-tag { font-size: 12px; font-weight: bold; text-align: center; padding: 4px; margin: 6px 0; border: 1px solid #000; }
    .payments-box { margin: 6px 0; font-size: 10.5px; border-top: 1px dashed #888; padding-top: 4px; }
    .payments-title { font-weight: bold; font-size: 10px; margin-bottom: 3px; }
    .pay-line { display: flex; justify-content: space-between; margin: 2px 0; }
    .footer-note { font-size: 10px; text-align: center; margin: 8px 0 4px; color: #333; }
    .sign { display: flex; justify-content: space-between; margin-top: 24px; font-size: 10px; }
    @media print { @page { size: 80mm auto; margin: 4mm; } body { width: 70mm; margin: 0; } }
  `;

  const a4Styles = `
    * { box-sizing: border-box; }
    body { font: 13px/1.5 Arial, sans-serif; color: #111; padding: 32px; max-width: 800px; margin: 0 auto; }
    .head { display: flex; justify-content: space-between; border-bottom: 1px solid #ddd; padding-bottom: 18px; margin-bottom: 18px; }
    .shop { display: flex; align-items: flex-start; gap: 12px; }
    .shop-logo { width: 120px; height: 80px; object-fit: contain; background: #000; border-radius: 4px; }
    h2 { font-size: 20px; margin: 0 0 4px; }
    .muted { color: #666; font-size: 12px; }
    .meta-block { text-align: right; }
    .meta-block h2 { font-size: 18px; color: #222; }
    .bill-to { display: flex; justify-content: space-between; background: #fafbfc; border: 1px solid #edf0f5; border-radius: 8px; padding: 14px 18px; margin-bottom: 18px; }
    table { width: 100%; border-collapse: collapse; margin: 18px 0; }
    th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #e5e9f0; font-size: 13px; }
    th { font-size: 11px; text-transform: uppercase; color: #666; background: #f8fafc; }
    aside { margin-left: auto; width: 280px; margin-top: 12px; }
    aside p { display: flex; justify-content: space-between; margin: 6px 0; }
    aside p.total { font-weight: bold; font-size: 16px; border-top: 2px solid #333; padding-top: 8px; margin-top: 8px; }
    .balance-tag { font-size: 13px; font-weight: bold; text-align: right; margin-top: 6px; color: #0d7a5f; }
    .payments-box { margin-top: 14px; padding: 10px; background: #fafbfc; border-radius: 6px; border: 1px solid #edf0f5; }
    .payments-title { font-weight: bold; font-size: 11px; color: #555; margin-bottom: 6px; }
    .pay-line { display: flex; justify-content: space-between; font-size: 12px; padding: 3px 0; }
    .footer-note { margin-top: 24px; color: #555; font-size: 12px; }
    .sign { display: flex; justify-content: space-between; margin-top: 48px; color: #444; }
    @media print { @page { size: A4; margin: 16mm; } body { padding: 0; } }
  `;

  popup.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Service Invoice - ${escapeHtml(service.serviceNumber)}</title>
  <style>${thermal ? thermalStyles : a4Styles}</style>
</head>
<body>
  ${thermal ? `
    <div class="head">
      ${logo}
      ${settings.address ? `<div class="muted">${escapeHtml(settings.address)}</div>` : ""}
      ${settings.phone ? `<div class="muted">Phone: ${escapeHtml(settings.phone)}</div>` : ""}
      ${gstin}
    </div>
    <div class="divider"></div>
    <div class="inv-title">SERVICE INVOICE</div>
    <div class="meta-row"><span>Bill No:</span><strong>${escapeHtml(service.serviceNumber)}</strong></div>
    <div class="meta-row"><span>Date:</span><span>${dateLabel(service.inDate)}</span></div>
    ${service.deliveryOutDate ? `<div class="meta-row"><span>Delivered:</span><span>${dateLabel(service.deliveryOutDate)}</span></div>` : ""}
    <div class="meta-row"><span>Status:</span><strong>${escapeHtml(service.returnOutcome === "Not repaired" ? "Not repaired" : service.status)}</strong></div>
    <div class="divider"></div>
    <div class="meta-row"><span>Customer:</span><strong>${escapeHtml(service.customerName)}</strong></div>
    <div class="meta-row"><span>Contact:</span><span>${escapeHtml(service.contactNumber)}</span></div>
    ${service.customerAddress ? `<div class="item-detail">Address: ${escapeHtml(service.customerAddress)}</div>` : ""}
    ${service.deliveryOutPerson ? `<div class="meta-row"><span>Picked by:</span><span>${escapeHtml(service.deliveryOutPerson)}</span></div>` : ""}
    <div class="divider"></div>
    <div class="item-block">
      <div class="item-name">${escapeHtml(deviceLabel(service))}</div>
      ${service.imei ? `<div class="item-detail">IMEI: ${escapeHtml(service.imei)}</div>` : ""}
      <div class="item-detail">Fault: ${escapeHtml(service.reportedFault)}</div>
    </div>
    <div class="divider"></div>
    <div class="totals">
      <p><span>Service charge:</span> <strong>${money(service.serviceAmount)}</strong></p>
      ${service.discount > 0 ? `<p><span>Discount:</span> <strong>− ${money(service.discount)}</strong></p>` : ""}
      <p class="total"><span>TOTAL:</span> <strong>${money(total)}</strong></p>
      <p><span>Advance / Paid:</span> <strong>${money(paid)}</strong></p>
      <p><span>Balance due:</span> <strong>${money(due)}</strong></p>
    </div>
    <div class="balance-tag">${due <= 0 ? "PAID IN FULL" : `BALANCE DUE: ${money(due)}`}</div>
    ${paymentRows}
    ${settings.invoiceFooter ? `<div class="footer-note">${escapeHtml(settings.invoiceFooter)}</div>` : ""}
    <div class="sign">
      <span>Customer sign</span>
      <span>Authorized sign</span>
    </div>
  ` : `
    <div class="head">
      <div class="shop">
        ${logo}
        <div>
          ${settings.address ? `<div class="muted">${escapeHtml(settings.address)}</div>` : ""}
          ${settings.phone ? `<div class="muted">Phone: ${escapeHtml(settings.phone)}</div>` : ""}
          ${gstin}
        </div>
      </div>
      <div class="meta-block">
        <h2>SERVICE INVOICE</h2>
        <strong>${escapeHtml(service.serviceNumber)}</strong>
        <div class="muted">Date: ${dateLabel(service.inDate)}</div>
        ${service.deliveryOutDate ? `<div class="muted">Delivered: ${dateLabel(service.deliveryOutDate)}</div>` : ""}
      </div>
    </div>

    <div class="bill-to">
      <div>
        <div class="muted">BILLED TO:</div>
        <strong>${escapeHtml(service.customerName)}</strong>
        <div>${escapeHtml(service.contactNumber)}</div>
        ${service.customerAddress ? `<div>${escapeHtml(service.customerAddress)}</div>` : ""}
      </div>
      <div>
        <div class="muted">JOB DETAILS:</div>
        <div><strong>Status: ${escapeHtml(service.returnOutcome === "Not repaired" ? "Returned · Not repaired" : service.status)}</strong></div>
        ${service.deliveryOutPerson ? `<div class="muted">Handed over to: ${escapeHtml(service.deliveryOutPerson)}</div>` : ""}
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>DEVICE / PRODUCT</th>
          <th>CATEGORY</th>
          <th>REPORTED FAULT</th>
          <th style="text-align:right">SERVICE AMOUNT</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <strong>${escapeHtml(deviceLabel(service))}</strong>
            ${service.imei ? `<div class="muted">IMEI: ${escapeHtml(service.imei)}</div>` : ""}
          </td>
          <td>${escapeHtml(service.category ?? "Electronics")}</td>
          <td>${escapeHtml(service.reportedFault)}</td>
          <td style="text-align:right"><strong>${money(service.serviceAmount)}</strong></td>
        </tr>
      </tbody>
    </table>

    <aside>
      <p><span>Service charge:</span> <strong>${money(service.serviceAmount)}</strong></p>
      ${service.discount > 0 ? `<p><span>Discount:</span> <strong>− ${money(service.discount)}</strong></p>` : ""}
      <p class="total"><span>Total amount:</span> <strong>${money(total)}</strong></p>
      <p><span>Amount paid:</span> <strong>${money(paid)}</strong></p>
      <p><span>Balance due:</span> <strong>${money(due)}</strong></p>
      <div class="balance-tag">${due <= 0 ? "✓ FULLY PAID" : `BALANCE DUE: ${money(due)}`}</div>
    </aside>

    ${paymentRows}

    ${settings.invoiceFooter ? `<p class="footer-note">${escapeHtml(settings.invoiceFooter)}</p>` : ""}

    <div class="sign">
      <span>Customer signature</span>
      <span>Authorized signature</span>
    </div>
  `}
  <script>
    window.onload = function() { window.print(); };
  </script>
</body>
</html>`);
  popup.document.close();
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

function InvoiceModal({ sale, settings, onClose }: { sale: Sale; settings: ShopSettings; onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-box invoice-modal"><div className="modal-header"><div><span className="eyebrow">LIVE PREVIEW</span><h2>{sale.invoiceNumber}</h2></div><button className="icon-btn" onClick={onClose} aria-label="Close preview"><X size={18} /></button></div><InvoicePreview sale={sale} settings={settings} /><div className="modal-footer"><Button variant="secondary" onClick={() => downloadInvoice(sale, settings)}><Download size={15} /> Download PDF</Button><Button onClick={() => printInvoice(sale, settings)}><Printer size={15} /> Print</Button></div></div></div>;
}

async function downloadServiceReceipt(service: ServiceJob, settings: ShopSettings) {
  let logoData: string;
  try {
    logoData = await loadLogoDataUrl(settings.logoDataUrl || BRAND_LOGO_PATH);
  } catch (reason) {
    window.alert(reason instanceof Error ? reason.message : "Could not load the service receipt logo.");
    return;
  }
  const pdf = new jsPDF({ unit: "mm", format: [80, 190] });
  const logoFormat = logoData.startsWith("data:image/png") ? "PNG" : "JPEG";
  pdf.addImage(logoData, logoFormat, 26, 3, 28, 19);
  pdf.setFontSize(12); pdf.setFont("helvetica", "bold"); pdf.text(settings.shopName || "AH Mobiles", 40, 33, { align: "center" });
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.text(`Service receipt · ${service.serviceNumber}`, 40, 39, { align: "center" });
  let y = 45;
  pdf.setFontSize(8);
  if (settings.address) { pdf.text(settings.address.slice(0, 72), 7, y); y += 5; }
  if (settings.phone) { pdf.text(settings.phone, 7, y); y += 5; }
  pdf.text(`In date: ${dateLabel(service.inDate)}`, 7, y); y += 5; pdf.line(7, y, 73, y); y += 8;
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(9); pdf.text(service.customerName.slice(0, 35), 7, y); y += 6;
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.text(service.contactNumber, 7, y); y += 6;
  if (service.customerAddress) {
    const addressLines = pdf.splitTextToSize(service.customerAddress, 66) as string[];
    pdf.text(addressLines, 7, y);
    y += addressLines.length * 4 + 2;
  }
  pdf.text(deviceLabel(service).slice(0, 34), 7, y); y += 6; pdf.text(`IMEI: ${service.imei || "—"}`, 7, y); y += 8;
  pdf.text(`Fault: ${service.reportedFault}`.slice(0, 70), 7, y); y += 7;
  pdf.text(`Condition: ${service.receivedConditions.join(", ")}`.slice(0, 70), 7, y); y += 7; pdf.line(7, y, 73, y); y += 8;
  pdf.text(`Estimate: ${pdfMoney(service.serviceAmount - service.discount)}`, 7, y); y += 6;
  pdf.text(`Advance: ${pdfMoney(servicePaid(service))}`, 7, y); y += 6;
  pdf.text(`Balance: ${pdfMoney(serviceDue(service))}`, 7, y); y += 12;
  pdf.setFontSize(7); pdf.text("Device passwords and patterns are never printed.", 7, y);
  pdf.save(`${service.serviceNumber}.pdf`);
}

function CustomersPage({ customers, sales, services, vendors, search, onSearch, onAdd, selectedId, onView, onEdit }: {
  customers: Customer[]; sales: Sale[]; services: ServiceJob[]; vendors: ServiceVendor[]; search: string; onSearch: (value: string) => void;
  onAdd: () => void; selectedId: string; onView: (id: string) => void; onEdit: (customer: Customer) => void;
}) {
  if (selectedId) {
    const customer = customers.find((item) => item.id === selectedId);
    if (!customer) return <NotFound title="Customer not found" backLabel="Back to customers" onBack={() => onView("")} />;
    const customerSales = sales.filter((sale) => sale.customerId === customer.id);
    const customerServices = services.filter((service) => service.customerId === customer.id)
      .sort((a, b) => (b.createdAt || b.inDate).localeCompare(a.createdAt || a.inDate));
    const outstanding = customerSales.reduce((sum, sale) => sum + Math.max(0, sale.finalAmount - paymentTotal(sale.payments)), 0)
      + customerServices.reduce((sum, service) => sum + serviceDue(service), 0);
    const paymentHistory = [
      ...customerSales.flatMap((sale) => sale.payments.map((payment) => ({ ...payment, reference: sale.invoiceNumber }))),
      ...customerServices.flatMap((service) => service.payments.map((payment) => ({ ...payment, reference: service.serviceNumber }))),
    ].sort((a, b) => b.date.localeCompare(a.date));
    return (
      <>
        <PageHeader eyebrow="CUSTOMER PROFILE" title={customer.name} description={`Customer since ${dateLabel(customer.createdAt)}`}>
          <Button variant="secondary" onClick={() => onEdit(customer)}><Pencil size={14} /> Edit customer</Button>
          <Button variant="secondary" onClick={() => onView("")}><ArrowLeft size={15} /> All customers</Button>
        </PageHeader>
        <div className="customer-profile-head">
          <span className="customer-profile-avatar">{customer.name[0]?.toUpperCase()}</span>
          <div className="customer-profile-contact">
            <h2>{customer.name}</h2>
            <div className="customer-contact-row">
              <span>Contact: <a href={`tel:${customer.phone}`}>{customer.phone}</a></span>
              <WhatsAppAction phone={customer.phone} customerName={customer.name} />
              {customer.email && <span>{customer.email}</span>}
            </div>
            {customer.address && <span className="customer-profile-address">Address: {customer.address}</span>}
          </div>
          <div className="customer-profile-stats">
            <span>Sales<strong>{customerSales.length}</strong></span>
            <span>Service jobs<strong>{customerServices.length}</strong></span>
            <span>Outstanding<strong>{money(outstanding)}</strong></span>
          </div>
        </div>
        <div className="panel table-panel">
          <div className="panel-heading"><div><h2>Sales history</h2><p>Invoices connected to this customer.</p></div></div>
          {customerSales.length ? <SalesTable sales={customerSales} /> : <div className="quiet-empty">No sales recorded for this customer.</div>}
        </div>
        <div className="panel table-panel customer-services">
          <div className="panel-heading"><div><h2>Service history</h2><p>Repair jobs connected to this customer.</p></div></div>
          {customerServices.length ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>SERVICE BILL</th><th>DEVICE</th><th>REPORTED FAULT</th><th>STATUS</th><th>DATE</th></tr></thead>
                <tbody>{customerServices.map((service) => <tr key={service.id}><td>{service.serviceNumber}</td><td>{deviceLabel(service)}</td><td>{service.reportedFault}</td><td><StatusBadge status={service.status} /></td><td>{dateLabel(service.inDate)}</td></tr>)}</tbody>
              </table>
            </div>
          ) : <div className="quiet-empty">No service jobs recorded for this customer.</div>}
        </div>
        <div className="panel table-panel customer-services">
          <div className="panel-heading"><div><h2>Payment history</h2><p>All recorded payments across this customer&apos;s invoices.</p></div></div>
          {paymentHistory.length ? (
            <div className="payment-history">{paymentHistory.map((payment) => (
              <div className="payment-row" key={payment.id}>
                <span className="payment-method-icon"><CreditCard size={15} /></span>
                <span><strong>{payment.reference}</strong><small>{dateLabel(payment.date)}{payment.notes ? ` · ${payment.notes}` : ""}</small></span>
                <strong className="paid-amount">{money(payment.amount)}</strong>
              </div>
            ))}</div>
          ) : <div className="quiet-empty">No payments recorded for this customer.</div>}
        </div>
      </>
    );
  }
  const [customerType, setCustomerType] = useState<
  "sales" | "service" | "vendor"
>("sales");

  const salesCustomerIds = new Set(sales.map((sale) => sale.customerId));

const serviceCustomerIds = new Set(services.map((service) => service.customerId));

const vendorCustomerIds = new Set(
  services.filter((service) => service.vendorId).map((service) => service.customerId)
);

const customerTypeIds =
  customerType === "sales"
    ? salesCustomerIds
    : customerType === "service"
    ? serviceCustomerIds
    : vendorCustomerIds;

const filtered = customers.filter((customer) => {
  const matchesType = customerTypeIds.has(customer.id);
  const matchesSearch =
    !search ||
    `${customer.name} ${customer.phone} ${customer.email}`
      .toLowerCase()
      .includes(search.toLowerCase());

  return matchesType && matchesSearch;
});
  
  return <>
    <PageHeader eyebrow="PEOPLE & RELATIONSHIPS" title="Customers" description="A single place for the people behind every sale and service."><Button onClick={onAdd}><Plus size={16} /> Add customer</Button>
    </PageHeader>
    <div className="customer-type-toggle">
  <button
    className={customerType === "sales" ? "active" : ""}
    onClick={() => setCustomerType("sales")}
  >
    Sales Customers
  </button>

  <button
    className={customerType === "service" ? "active" : ""}
    onClick={() => setCustomerType("service")}
  >
    Service Customers
  </button>

  <button
    className={customerType === "vendor" ? "active" : ""}
    onClick={() => setCustomerType("vendor")}
  >
    Vendor Customers
  </button>
</div>
    <div className="customer-metrics"><div className="panel mini-metric"><span className="metric-icon blue"><Users size={17} /></span><span>Total customers<strong>{customers.length}</strong></span></div><div className="panel mini-metric"><span className="metric-icon green"><CreditCard size={17} /></span><span>Sales recorded<strong>{sales.length}</strong></span></div><div className="panel mini-metric"><span className="metric-icon amber"><Wrench size={17} /></span><span>Service jobs<strong>{services.length}</strong></span></div></div>
    <div className="panel table-panel"><div className="table-toolbar"><label className="table-search"><Search size={16} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search name, phone or email…" /></label><span className="table-results">
  {filtered.length} {customerType === "sales"
    ? "sales customers"
    : customerType === "service"
    ? "service customers"
    : "vendor customers"}
</span></div>{filtered.length ? <div className="table-scroll"><table className="data-table"><thead>
  <tr>
    <th>CUSTOMER</th>
    <th>CONTACT</th>

    {customerType === "sales" && (
      <>
        <th>SALES</th>
        <th>SPEND</th>
        <th>OUTSTANDING</th>
      </>
    )}

    {customerType === "service" && (
      <>
        <th>SERVICE JOBS</th>
        <th>DEVICE</th>
        <th>STATUS</th>
      </>
    )}

    {customerType === "vendor" && (
      <>
        <th>VENDOR JOBS</th>
        <th>VENDOR</th>
        <th>STATUS</th>
      </>
    )}

    <th />
  </tr>
</thead><tbody>{filtered.map((customer) => {
  const ownSales = sales.filter(
    (sale) => sale.customerId === customer.id
  );

  const ownServices = services.filter(
    (service) => service.customerId === customer.id
  );

  const ownVendorServices = ownServices.filter((service) => service.vendorId);

  const spend =
    ownSales.reduce((sum, sale) => sum + sale.finalAmount, 0) +
    ownServices.reduce(
      (sum, service) => sum + service.serviceAmount - service.discount,
      0
    );

  const due =
    ownSales.reduce(
      (sum, sale) =>
        sum + Math.max(0, sale.finalAmount - paymentTotal(sale.payments)),
      0
    ) +
    ownServices.reduce((sum, service) => sum + serviceDue(service), 0);

  return (
    <tr key={customer.id}>
      <td>
        <span className="customer-cell">
          <span className="mini-avatar">
            {customer.name[0]?.toUpperCase()}
          </span>
          <span>
            <strong>{customer.name}</strong>
            <small>Since {dateLabel(customer.createdAt)}</small>
          </span>
        </span>
      </td>

      <td>
        {customer.phone}
        <small className="table-subtext">{customer.email || ""}</small>
      </td>

      {customerType === "sales" && (
        <>
          <td>{ownSales.length}</td>
          <td><strong>{money(spend)}</strong></td>
          <td>
            <strong className={due ? "due-text" : ""}>
              {money(due)}
            </strong>
          </td>
        </>
      )}

      {customerType === "service" && (
        <>
          <td>{ownServices.length}</td>
          <td>
            {ownServices.map((service) => (
              <div key={service.id}>
                {deviceLabel(service)}
              </div>
            ))}
          </td>
          <td>
            {ownServices.map((service) => (
              <div key={service.id}>
                <StatusBadge status={service.status} />
              </div>
            ))}
          </td>
        </>
      )}

      {customerType === "vendor" && (
        <>
          <td>{ownVendorServices.length}</td>
          <td>
            {ownVendorServices.map((service) => {
              const vendor = vendors.find((item) => item.id === service.vendorId);
              return <div key={service.id}>{vendor?.name || "Vendor not found"}</div>;
            })}
          </td>
          <td>
            {ownVendorServices.map((service) => (
              <div key={service.id}>
                <StatusBadge status={service.status} />
              </div>
            ))}
          </td>
        </>
      )}

      <td>
        <button
          className="row-action"
          aria-label={`Open ${customer.name}`}
          onClick={() => onView(customer.id)}
        >
          <ArrowRight size={15} />
        </button>

        <button
          className="row-action"
          aria-label={`Edit ${customer.name}`}
          onClick={() => onEdit(customer)}
        >
          <Settings size={14} />
        </button>
      </td>
    </tr>
  );
})}</tbody></table></div> : <EmptyState icon={Users} title={search ? "No customers found" : "Meet your first customer"} detail={search ? "Try a different search." : "Customers added during sales or service intake appear here too."} action={!search ? <Button onClick={onAdd}><Plus size={15} /> Add customer</Button> : undefined} />}</div>
  </>;
}

function ServiceVendorsPage({ vendors, vendorServices, search, onSearch, selectedId, onSelect, onAdd, onCreateService, onEditService, onDeleteService, onMarkNotRepaired, onStatusChange, onDeleteVendor, canEdit }: {
  vendors: ServiceVendor[];
  vendorServices: VendorService[];
  search: string;
  onSearch: (value: string) => void;
  selectedId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onCreateService: (vendor: ServiceVendor) => void;
  onEditService: (service: VendorService) => void;
  onDeleteService: (service: VendorService) => void;
  onMarkNotRepaired: (service: VendorService) => void;
  onStatusChange: (service: VendorService, status: ServiceStatus) => void;
  onDeleteVendor: (vendor: ServiceVendor) => void;
  canEdit: boolean;
}) {
  const [serviceSearch, setServiceSearch] = useState("");
  const [serviceStatusFilter, setServiceStatusFilter] = useState("All statuses");
  const [serviceFrom, setServiceFrom] = useState("");
  const [serviceTo, setServiceTo] = useState("");
  const [serviceSortBy, setServiceSortBy] = useState("date-desc");
  const selectedVendor = vendors.find((vendor) => vendor.id === selectedId);
  if (selectedId) {
    if (!selectedVendor) return <NotFound title="Service vendor not found" backLabel="Back to vendors" onBack={() => onSelect("")} />;
    const servicesForVendor = vendorServices
      .filter((service) => service.vendorId === selectedVendor.id)
      .sort((a, b) => (b.createdAt || b.inDate).localeCompare(a.createdAt || a.inDate));
    const filteredVendorServices = servicesForVendor
      .filter((service) => {
        const query = serviceSearch.trim().toLowerCase();
        return (!query || `${service.serviceNumber} ${service.customerName} ${service.brand} ${service.mobileModel} ${service.customerNumber} ${service.returnOutcome === "Not repaired" ? "Refund" : service.status} ${service.deliveryCustomer ?? ""}`.toLowerCase().includes(query))
          && (serviceStatusFilter === "All statuses" || (serviceStatusFilter === "Refund" ? service.returnOutcome === "Not repaired" : service.status === serviceStatusFilter && service.returnOutcome !== "Not repaired"))
          && (!serviceFrom || service.inDate.slice(0, 10) >= serviceFrom)
          && (!serviceTo || service.inDate.slice(0, 10) <= serviceTo);
      })
      .sort((a, b) => serviceSortBy === "date-asc" ? a.inDate.localeCompare(b.inDate)
        : serviceSortBy === "charge-desc" ? (b.returnOutcome === "Not repaired" ? 0 : b.serviceCharge) - (a.returnOutcome === "Not repaired" ? 0 : a.serviceCharge)
        : serviceSortBy === "charge-asc" ? (a.returnOutcome === "Not repaired" ? 0 : a.serviceCharge) - (b.returnOutcome === "Not repaired" ? 0 : b.serviceCharge)
        : b.inDate.localeCompare(a.inDate) || b.createdAt.localeCompare(a.createdAt));
    const exportVendorServicesPdf = () => {
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const columns = [
        { title: "SERVICE BILL NO.", width: 27 },
        { title: "IN DATE", width: 19 },
        { title: "CUSTOMER", width: 31 },
        { title: "MOBILE WITH MODEL", width: 34 },
        { title: "CUSTOMER NUMBER", width: 27 },
        { title: "STATUS", width: 23 },
        { title: "DELIVERY DATE", width: 20 },
        { title: "DELIVERY CUSTOMER", width: 32 },
        { title: "SERVICE CHARGE", width: 22 },
      ];
      const totalCharge = filteredVendorServices.reduce((total, service) => total + (service.returnOutcome === "Not repaired" ? 0 : service.serviceCharge), 0);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(16);
      pdf.text(`${selectedVendor.name} · Vendor Services`, margin, 13);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.text(`Mobile: ${selectedVendor.phone}  |  Period: ${serviceFrom || "All"} to ${serviceTo || "All"}  |  Generated: ${dateLabel(new Date().toISOString())}`, margin, 20);
      pdf.text(`Services: ${filteredVendorServices.length}  |  Service charges: ${pdfMoney(totalCharge)}  |  Status: ${serviceStatusFilter}`, margin, 26);
      const drawHeader = (y: number) => {
        pdf.setFillColor(238, 242, 248);
        pdf.rect(margin, y - 4, columns.reduce((total, column) => total + column.width, 0), 7, "F");
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(7);
        let x = margin;
        columns.forEach((column) => {
          pdf.text(column.title, x + 1, y);
          x += column.width;
        });
        pdf.setFont("helvetica", "normal");
        return y + 6;
      };
      let y = drawHeader(34);
      filteredVendorServices.forEach((service) => {
        const values = [
          service.serviceNumber,
          dateLabel(service.inDate),
          service.customerName,
          `${service.brand} ${service.mobileModel}`.trim(),
          service.customerNumber,
          service.returnOutcome === "Not repaired" ? "Refund" : service.status,
          service.deliveryDate ? dateLabel(service.deliveryDate) : "—",
          service.deliveryCustomer || "—",
          pdfMoney(service.returnOutcome === "Not repaired" ? 0 : service.serviceCharge),
        ];
        const lines = values.map((value, index) => {
  const column = columns[index];
  const width = column?.width ?? 25;

  return pdf.splitTextToSize(
    String(value || "—"),
    Math.max(5, width - 2)
  ) as string[];
});
        const rowHeight = Math.max(6, ...lines.map((cellLines) => cellLines.length * 3.2 + 2));
        if (y + rowHeight > pageHeight - 12) {
          pdf.addPage();
          y = drawHeader(14);
        }
        let x = margin;
        lines.forEach((cellLines, index) => {
          pdf.text(cellLines, x + 1, y, { maxWidth: columns[index].width - 2 });
          x += columns[index].width;
        });
        y += rowHeight;
        pdf.setDrawColor(225, 230, 238);
        pdf.line(margin, y - 2, margin + columns.reduce((total, column) => total + column.width, 0), y - 2);
      });
      const pageCount = pdf.getNumberOfPages();
      for (let page = 1; page <= pageCount; page += 1) {
        pdf.setPage(page);
        pdf.setFontSize(8);
        pdf.text(`Page ${page} of ${pageCount}`, pageWidth - margin, pageHeight - 5, { align: "right" });
      }
      const filename = selectedVendor.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      pdf.save(`${filename || "vendor"}-services-${dateInputValue()}.pdf`);
    };
    return <>
      <PageHeader eyebrow="SERVICE VENDOR" title={selectedVendor.name} description={`Mobile: ${selectedVendor.phone} · ${servicesForVendor.length} vendor service${servicesForVendor.length === 1 ? "" : "s"}`}><Button variant="secondary" onClick={() => onSelect("")}><ArrowLeft size={15} /> All vendors</Button>{canEdit && <Button variant="secondary" onClick={() => onDeleteVendor(selectedVendor)}><Trash2 size={15} /> Delete vendor</Button>}<Button variant="secondary" onClick={exportVendorServicesPdf}><Download size={15} /> Export PDF</Button>{canEdit && <Button onClick={() => onCreateService(selectedVendor)}><Plus size={16} /> Add service</Button>}</PageHeader>
      <div className="panel table-panel">
        <div className="panel-heading"><div><h2>Vendor services</h2><p>Entries saved only for {selectedVendor.name}.</p></div></div>
        <div className="table-toolbar">
          <label className="table-search"><Search size={16} /><input value={serviceSearch} onChange={(event) => setServiceSearch(event.target.value)} placeholder="Search bill, customer, model or phone…" /></label>
          <div className="table-filters">
            <label className="select-wrap"><Filter size={15} /><select aria-label="Filter vendor services by status" value={serviceStatusFilter} onChange={(event) => setServiceStatusFilter(event.target.value)}><option>All statuses</option>{(["Received", "In progress", "Ready", "Returned"] as ServiceStatus[]).map((status) => <option key={status}>{status}</option>)}<option>Refund</option></select><ChevronDown size={14} /></label>
            <div className="date-range compact-date-range"><label>From<input aria-label="Vendor services from date" className="input date-filter" type="date" value={serviceFrom} onChange={(event) => setServiceFrom(event.target.value)} /></label><label>To<input aria-label="Vendor services to date" className="input date-filter" type="date" value={serviceTo} onChange={(event) => setServiceTo(event.target.value)} /></label></div>
            <label className="select-wrap"><span>Sort</span><select aria-label="Sort vendor services" value={serviceSortBy} onChange={(event) => setServiceSortBy(event.target.value)}><option value="date-desc">Newest</option><option value="date-asc">Oldest</option><option value="charge-desc">Highest charge</option><option value="charge-asc">Lowest charge</option></select><ChevronDown size={14} /></label>
            <span className="table-results">{filteredVendorServices.length} of {servicesForVendor.length} services</span>
          </div>
        </div>
        {filteredVendorServices.length
          ? <div className="table-scroll"><table className="data-table"><thead><tr><th>SERVICE BILL NO.</th><th>IN DATE</th><th>IN CUSTOMER NAME</th><th>MOBILE WITH MODEL</th><th>CUSTOMER NUMBER</th><th>STATUS</th><th>DELIVERY DATE</th><th>DELIVERY CUSTOMER</th><th>SERVICE CHARGE</th><th /></tr></thead><tbody>{filteredVendorServices.map((service) => <tr key={service.id}>
            <td><button className="table-primary-link" onClick={() => onEditService(service)} title="View customer & product details">{service.serviceNumber}</button></td>
            <td><span className="muted-cell">{dateLabel(service.inDate)}</span></td>
            <td>{service.customerName}</td>
            <td><strong>{service.brand} {service.mobileModel}</strong></td>
            <td>{service.customerNumber}</td>
            <td>{service.returnOutcome === "Not repaired" ? <StatusBadge status="Refund" /> : <select className={`status-select status-${statusClass(service.status)}`} value={service.status} disabled={!canEdit || service.status === "Returned" || service.returnOutcome === "Not repaired"} aria-label={`Update status for ${service.serviceNumber}`} title={service.status === "Returned" || service.returnOutcome === "Not repaired" ? "This vendor service has already been returned and its status is locked." : undefined} onChange={(event) => { if (event.target.value === "__not_repaired__") onMarkNotRepaired(service); else onStatusChange(service, event.target.value as ServiceStatus); }}>{(["Received", "In progress", "Ready", "Returned"] as ServiceStatus[]).map((status) => <option key={status}>{status}</option>)}<option value="__not_repaired__">Not repaired · Return device</option></select>}</td>
            <td><span className="muted-cell">{service.deliveryDate ? dateLabel(service.deliveryDate) : "—"}</span></td>
            <td>{service.deliveryCustomer || "—"}</td>
            <td><strong>{money(service.returnOutcome === "Not repaired" ? 0 : service.serviceCharge)}</strong></td>
            <td><WhatsAppAction phone={service.customerNumber} customerName={service.customerName} /><button className="row-action" aria-label="View vendor service details" title="View details" onClick={() => onEditService(service)}><ArrowRight size={15} /></button>{canEdit && <button className="row-action" aria-label="Edit vendor service" title="Edit details" onClick={() => onEditService(service)}><Pencil size={15} /></button>}{canEdit && <button className="row-action danger-action" aria-label="Delete vendor service" title="Delete service" onClick={() => onDeleteService(service)}><Trash2 size={15} /></button>}</td>
          </tr>)}</tbody></table></div>
          : <EmptyState icon={Wrench} title={servicesForVendor.length ? "No matching vendor services" : "No vendor services yet"} detail={servicesForVendor.length ? "Adjust your search or filters to see matching services." : "Add a service here to save it only under this vendor."} action={!servicesForVendor.length && canEdit ? <Button onClick={() => onCreateService(selectedVendor)}><Plus size={15} /> Add service</Button> : undefined} />}
      </div>
    </>;
  }
  const query = search.trim().toLowerCase();
  const filteredVendors = vendors
    .filter((vendor) => !query || `${vendor.name} ${vendor.phone}`.toLowerCase().includes(query))
    .sort((a, b) => a.name.localeCompare(b.name));
  return <>
    <PageHeader eyebrow="REPAIR PARTNERS" title="Service vendors" description="Keep vendor contacts and their separate service records.">{canEdit && <Button onClick={onAdd}><Plus size={16} /> Add service vendor</Button>}</PageHeader>
    <div className="panel table-panel">
      <div className="table-toolbar"><label className="table-search"><Search size={16} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search vendor name or mobile…" /></label><span className="table-results">{filteredVendors.length} vendors</span></div>
      {filteredVendors.length
        ? <div className="table-scroll"><table className="data-table"><thead><tr><th>VENDOR NAME</th><th>MOBILE NUMBER</th><th>SERVICES</th><th /></tr></thead><tbody>{filteredVendors.map((vendor) => <tr key={vendor.id}><td><button className="table-primary-link" onClick={() => onSelect(vendor.id)}>{vendor.name}</button></td><td>{vendor.phone}</td><td>{vendorServices.filter((service) => service.vendorId === vendor.id).length}</td><td><button className="row-action" aria-label={`View services for ${vendor.name}`} onClick={() => onSelect(vendor.id)}><ArrowRight size={15} /></button>{canEdit && <button className="row-action danger-action" aria-label={`Delete ${vendor.name}`} onClick={() => onDeleteVendor(vendor)}><Trash2 size={15} /></button>}</td></tr>)}</tbody></table></div>
        : <EmptyState icon={Store} title={vendors.length ? "No vendors found" : "Add your first service vendor"} detail={vendors.length ? "Try another name or mobile number." : "Save a vendor's name and mobile number, then add service records under that vendor."} action={!vendors.length && canEdit ? <Button onClick={onAdd}><Plus size={15} /> Add service vendor</Button> : undefined} />}
    </div>
  </>;
}

function CustomerModal({ title = "Add customer", initial, onClose, onSave }: {
  title?: string;
  initial?: Customer;
  onClose: () => void; onSave: (name: string, phone: string, email: string, address: string) => Promise<void>;
}) {
  const [values, setValues] = useState({ name: initial?.name ?? "", phone: initial?.phone ?? "", email: initial?.email ?? "", address: initial?.address ?? "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = customerSchema.safeParse(values);
    if (!result.success) { setError(result.error.issues[0]?.message ?? "Check the customer details."); return; }
    setSaving(true);
    try { await onSave(values.name, values.phone, values.email, values.address); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save this customer."); }
    finally { setSaving(false); }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="modal-box compact-modal" onSubmit={submit}><div className="modal-header"><div><span className="eyebrow">CUSTOMER DIRECTORY</span><h2>{title}</h2></div><button className="icon-btn" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button></div><div className="modal-fields"><FormField label="Full name"><input className="input" value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} placeholder="e.g. Priya Sharma" /></FormField><FormField label="Contact number"><input className="input" inputMode="tel" value={values.phone} onChange={(event) => setValues({ ...values, phone: event.target.value })} placeholder="+91 98765 43210" /></FormField><FormField label="Address"><textarea className="input textarea" maxLength={500} value={values.address} onChange={(event) => setValues({ ...values, address: event.target.value })} placeholder="Street, area, city" /></FormField><FormField label="Email (optional)"><input className="input" type="email" value={values.email} onChange={(event) => setValues({ ...values, email: event.target.value })} placeholder="priya@example.com" /></FormField>{error && <span className="field-error">{error}</span>}</div><div className="modal-footer"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving…" : <><Pencil size={14} /> {title}</>}</Button></div></form></div>;
}

function ServiceVendorModal({ onClose, onSave }: {
  onClose: () => void;
  onSave: (name: string, phone: string) => Promise<void>;
}) {
  const [values, setValues] = useState({ name: "", phone: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = serviceVendorSchema.safeParse(values);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the vendor details.");
      return;
    }
    setSaving(true);
    try { await onSave(parsed.data.name, parsed.data.phone); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save this vendor."); }
    finally { setSaving(false); }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="modal-box compact-modal" onSubmit={submit}><div className="modal-header"><div><span className="eyebrow">SERVICE PARTNERS</span><h2>Add service vendor</h2></div><button className="icon-btn" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button></div><div className="modal-fields"><FormField label="Vendor name"><input className="input" value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} placeholder="e.g. City Mobile Repairs" autoFocus /></FormField><FormField label="Mobile number"><input className="input" inputMode="tel" value={values.phone} onChange={(event) => setValues({ ...values, phone: event.target.value })} placeholder="+91 98765 43210" /></FormField>{error && <span className="field-error">{error}</span>}</div><div className="modal-footer"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving…" : <><Plus size={15} /> Add vendor</>}</Button></div></form></div>;
}

function VendorDeleteModal({ vendor, linkedEntries, linkedJobs, onCancel, onConfirm }: {
  vendor: ServiceVendor;
  linkedEntries: number;
  linkedJobs: number;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onConfirm();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The vendor could not be deleted. Please try again.");
    } finally {
      setSaving(false);
    }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (!saving && event.target === event.currentTarget) onCancel(); }}><form className="modal-box compact-modal" onSubmit={submit}><div className="modal-header"><div><span className="eyebrow">SERVICE PARTNERS</span><h2>Delete {vendor.name}?</h2></div><button className="icon-btn" type="button" disabled={saving} onClick={onCancel} aria-label="Close"><X size={18} /></button></div><div className="modal-fields"><p>This permanently deletes the vendor and {linkedEntries} associated vendor service {linkedEntries === 1 ? "entry" : "entries"}.</p>{linkedJobs > 0 && <p>{linkedJobs} service desk {linkedJobs === 1 ? "job will" : "jobs will"} remain, but the vendor assignment will be removed.</p>}<p>This action cannot be undone.</p>{error && <span className="field-error">{error}</span>}</div><div className="modal-footer"><Button variant="ghost" disabled={saving} onClick={onCancel}>Cancel</Button><Button type="submit" variant="danger" disabled={saving}><Trash2 size={15} />{saving ? "Deleting…" : "Delete vendor"}</Button></div></form></div>;
}

function VendorServiceModal({ vendor, initialServiceNumber, onClose, onSave }: {
  vendor: ServiceVendor;
  initialServiceNumber: string;
  onClose: () => void;
  onSave: (service: Omit<VendorService, "id" | "createdAt" | "vendorId">) => Promise<void>;
}) {
  const [values, setValues] = useState({
    serviceNumber: initialServiceNumber,
    inDate: dateInputValue(),
    customerName: "",
    customerAddress: "",
    brand: "",
    mobileModel: "",
    customerNumber: "",
    fault: "",
    status: "Received" as ServiceStatus,
    receivedCondition: "Good condition",
    deliveryDate: "",
    deliveryCustomer: "",
    serviceCharge: "",
  });
  const [otherCondition, setOtherCondition] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (values.receivedCondition === "Other" && !otherCondition.trim()) {
      setError("Please specify the other condition.");
      return;
    }
    const finalCondition = values.receivedCondition === "Other"
      ? (otherCondition.trim()
          ? (otherCondition.trim().toLowerCase().startsWith("other") ? otherCondition.trim() : `Other: ${otherCondition.trim()}`)
          : "Other")
      : values.receivedCondition;

    const parsed = vendorServiceFormSchema.safeParse({
      ...values,
      receivedCondition: finalCondition,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the service details.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const draft = {
        ...parsed.data,
        // Keep the vendor-reported fault with this vendor service record.
        fault: values.fault.trim(),
        receivedCondition: finalCondition,
        inDate: businessDateTime(parsed.data.inDate),
        deliveryDate: parsed.data.deliveryDate ? businessDateTime(parsed.data.deliveryDate) : undefined,
      } as Omit<VendorService, "id" | "createdAt" | "vendorId">;
      await onSave(draft);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save this vendor service.");
    } finally {
      setSaving(false);
    }
  };
  const update = (field: keyof typeof values, value: string) => setValues((current) => ({ ...current, [field]: value }));
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="modal-box compact-modal" onSubmit={submit}><div className="modal-header"><div><span className="eyebrow">SERVICE FOR {vendor.name.toUpperCase()}</span><h2>Add vendor service</h2></div><button className="icon-btn" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button></div><div className="modal-fields form-grid two-col">
    <FormField label="Service bill number"><input className="input" value={values.serviceNumber} onChange={(event) => update("serviceNumber", event.target.value)} autoFocus /><span className="field-hint">Auto-generated; edit if needed.</span></FormField>
    <FormField label="In date"><input className="input" type="date" value={values.inDate} onChange={(event) => update("inDate", event.target.value)} /></FormField>
    <FormField label="In person"><input className="input" value={values.customerName} onChange={(event) => update("customerName", event.target.value)} /></FormField>
    <FormField label="Customer number"><input className="input" inputMode="tel" value={values.customerNumber} onChange={(event) => update("customerNumber", event.target.value)} /></FormField>
    <FormField label="Customer address"><textarea className="input textarea" maxLength={500} value={values.customerAddress} onChange={(event) => update("customerAddress", event.target.value)} placeholder="Street, area, city" /></FormField>
    <FormField label="Fault"><textarea className="input textarea" value={values.fault} onChange={(event) => update("fault", event.target.value)} placeholder="Describe the device fault or issue" /></FormField>
    <FormField label="Brand"><input className="input" value={values.brand} onChange={(event) => update("brand", event.target.value)} /></FormField>
    <FormField label="Model"><input className="input" value={values.mobileModel} onChange={(event) => update("mobileModel", event.target.value)} /></FormField>
    <FormField label="Status"><select className="input" value={values.status} onChange={(event) => update("status", event.target.value)}>{(["Received", "In progress", "Ready", "Returned"] as ServiceStatus[]).map((status) => <option key={status}>{status}</option>)}</select></FormField>
    <FormField label="Received Condition">
      <select
        className="input"
        value={values.receivedCondition}
        onChange={(event) => {
          update("receivedCondition", event.target.value);
          if (event.target.value !== "Other") {
            setOtherCondition("");
          }
        }}
      >
        {CONDITIONS.map((condition) => (
          <option key={condition} value={condition}>
            {condition}
          </option>
        ))}
      </select>
      {values.receivedCondition === "Other" && (
        <input
          className="input"
          style={{ marginTop: 8 }}
          type="text"
          value={otherCondition}
          onChange={(event) => setOtherCondition(event.target.value)}
          placeholder="Please specify other condition..."
          autoFocus
        />
      )}
    </FormField>
    <FormField label="Service charge (₹)"><input className="input" type="number" min="0" value={values.serviceCharge} onChange={(event) => update("serviceCharge", event.target.value)} /></FormField>
    <FormField label="Delivery date (optional)"><input className="input" type="date" value={values.deliveryDate} onChange={(event) => update("deliveryDate", event.target.value)} /></FormField>
    <FormField label="Out person"><input className="input" value={values.deliveryCustomer} onChange={(event) => update("deliveryCustomer", event.target.value)} /></FormField>
    {error && <span className="field-error">{error}</span>}
  </div><div className="modal-footer"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving…" : <><Plus size={15} /> Save service</>}</Button></div></form></div>;
}

function VendorServiceNotRepairedConfirm({ service, onCancel, onConfirm }: {
  service: VendorService;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const confirm = async () => {
    setSaving(true);
    setError("");
    try {
      await onConfirm();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not return this device.");
    } finally {
      setSaving(false);
    }
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (!saving && event.target === event.currentTarget) onCancel(); }}><div className="modal-box compact-modal" role="dialog" aria-modal="true" aria-labelledby="vendor-not-repaired-title"><div className="modal-header"><div><span className="eyebrow">{service.serviceNumber}</span><h2 id="vendor-not-repaired-title">Not repaired · Return device?</h2></div><button className="icon-btn" type="button" disabled={saving} onClick={onCancel} aria-label="Close"><X size={18} /></button></div><div className="modal-fields"><p>Are you sure you want to mark this vendor service as returned without repair?</p>{error && <span className="field-error">{error}</span>}</div><div className="modal-footer"><Button variant="ghost" disabled={saving} onClick={onCancel}>Cancel</Button><Button variant="danger" disabled={saving} onClick={confirm}>{saving ? "Saving…" : "Yes, return device"}</Button></div></div></div>;
}

function VendorServiceDetailModal({
  service,
  vendor,
  canEdit,
  onClose,
  onDelete,
  onSave,
}: {
  service: VendorService;
  vendor: ServiceVendor;
  canEdit: boolean;
  onClose: () => void;
  onDelete?: (service: VendorService) => void;
  onSave: (updated: Partial<VendorService>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState({
    customerName: service.customerName,
    customerNumber: service.customerNumber,
    customerAddress: service.customerAddress || "",
    brand: service.brand,
    mobileModel: service.mobileModel,
    fault: service.fault || "",
    receivedCondition: service.receivedCondition || "Good condition",
    deliveryDate: service.deliveryDate?.slice(0, 10) || "",
    deliveryCustomer: service.deliveryCustomer || "",
    serviceCharge: String(service.serviceCharge || 0),
  });
  const [otherCondition, setOtherCondition] = useState(() => {
    if (service.receivedCondition?.startsWith("Other: ")) {
      return service.receivedCondition.slice(7);
    }
    return CONDITIONS.includes(service.receivedCondition) ? "" : (service.receivedCondition || "");
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const update = (field: keyof typeof values, value: string) =>
    setValues((prev) => ({ ...prev, [field]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!values.customerName.trim()) {
      setError("Customer name is required.");
      return;
    }
    if (!values.customerNumber.trim()) {
      setError("Customer number is required.");
      return;
    }
    if (!values.brand.trim()) {
      setError("Brand is required.");
      return;
    }
    if (!values.mobileModel.trim()) {
      setError("Model is required.");
      return;
    }
    if (values.receivedCondition === "Other" && !otherCondition.trim()) {
      setError("Please specify the other condition.");
      return;
    }

    const finalCondition = values.receivedCondition === "Other"
      ? (otherCondition.trim()
          ? (otherCondition.trim().toLowerCase().startsWith("other") ? otherCondition.trim() : `Other: ${otherCondition.trim()}`)
          : "Other")
      : values.receivedCondition;

    setSaving(true);
    setError("");
    try {
      await onSave({
        customerName: values.customerName.trim(),
        customerNumber: values.customerNumber.trim(),
        customerAddress: values.customerAddress.trim(),
        brand: values.brand.trim(),
        mobileModel: values.mobileModel.trim(),
        fault: values.fault.trim(),
        receivedCondition: finalCondition,
        serviceCharge: Number(values.serviceCharge) || 0,
        deliveryDate: values.deliveryDate ? businessDateTime(values.deliveryDate) : undefined,
        deliveryCustomer: values.deliveryCustomer.trim() || undefined,
      });
      setEditing(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save details.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (!saving && event.target === event.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 580 }}>
        <div className="modal-header">
          <div>
            <span className="eyebrow">SERVICE VENDOR · {vendor.name.toUpperCase()} · {service.serviceNumber}</span>
            <h2>{editing ? "Edit vendor service" : `${service.brand} ${service.mobileModel}`}</h2>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {!editing ? (
          <>
            <div style={{ padding: "16px 20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, color: "#718096" }}>Status:</span>
                  <StatusBadge status={service.returnOutcome === "Not repaired" ? "Refund" : service.status} />
                </div>
                <div style={{ fontSize: 13, color: "#718096" }}>
                  In date: <strong>{dateLabel(service.inDate)}</strong>
                </div>
              </div>

              {/* Customer Details */}
              <div className="panel detail-panel" style={{ marginBottom: 14 }}>
                <div className="panel-heading" style={{ padding: "10px 14px", borderBottom: "1px solid #edf0f4" }}>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#2d3748" }}>Customer details</h3>
                </div>
                <div className="detail-fields" style={{ padding: "12px 14px" }}>
                  <DetailField label="In person / Name" value={service.customerName} />
                  <DetailField label="Customer number" value={service.customerNumber} />
                  <DetailField label="Customer address" value={service.customerAddress || "—"} />
                  <DetailField label="Out person / Delivered to" value={service.deliveryCustomer || "—"} />
                  <DetailField label="Delivery date" value={service.deliveryDate ? dateLabel(service.deliveryDate) : "—"} />
                </div>
              </div>

              {/* Product Details */}
              <div className="panel detail-panel" style={{ marginBottom: 14 }}>
                <div className="panel-heading" style={{ padding: "10px 14px", borderBottom: "1px solid #edf0f4" }}>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#2d3748" }}>Product details</h3>
                </div>
                <div className="detail-fields" style={{ padding: "12px 14px" }}>
                  <DetailField label="Brand" value={service.brand} />
                  <DetailField label="Model" value={service.mobileModel} />
                  <DetailField label="Received condition" value={service.receivedCondition || "Not specified"} />
                  <DetailField label="Reported fault" value={service.fault || "None recorded"} />
                </div>
              </div>

              {/* Service & Charge Details */}
              <div className="panel detail-panel">
                <div className="panel-heading" style={{ padding: "10px 14px", borderBottom: "1px solid #edf0f4" }}>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#2d3748" }}>Service & charges</h3>
                </div>
                <div className="detail-fields" style={{ padding: "12px 14px" }}>
                  <DetailField label="Service vendor" value={`${vendor.name} · ${vendor.phone}`} />
                  <DetailField label="Service charge" value={money(service.returnOutcome === "Not repaired" ? 0 : service.serviceCharge)} />
                </div>
              </div>
            </div>

            <div className="modal-footer" style={{ padding: "12px 20px" }}>
              {canEdit && onDelete && (
                <Button variant="danger" type="button" onClick={() => onDelete(service)}>
                  <Trash2 size={14} /> Delete service
                </Button>
              )}
              {canEdit && (
                <Button variant="secondary" type="button" onClick={() => setEditing(true)}>
                  <Pencil size={14} /> Edit details
                </Button>
              )}
              <Button type="button" onClick={onClose}>Close</Button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <div className="modal-fields form-grid two-col" style={{ padding: "16px 20px" }}>
              <FormField label="In person (Customer Name)">
                <input
                  className="input"
                  value={values.customerName}
                  onChange={(event) => update("customerName", event.target.value)}
                  required
                />
              </FormField>
              <FormField label="Customer number">
                <input
                  className="input"
                  inputMode="tel"
                  value={values.customerNumber}
                  onChange={(event) => update("customerNumber", event.target.value)}
                  required
                />
              </FormField>
              <FormField label="Customer address">
                <textarea
                  className="input textarea"
                  maxLength={500}
                  value={values.customerAddress}
                  onChange={(event) => update("customerAddress", event.target.value)}
                  placeholder="Street, area, city"
                />
              </FormField>
              <FormField label="Brand">
                <input
                  className="input"
                  value={values.brand}
                  onChange={(event) => update("brand", event.target.value)}
                  required
                />
              </FormField>
              <FormField label="Model">
                <input
                  className="input"
                  value={values.mobileModel}
                  onChange={(event) => update("mobileModel", event.target.value)}
                  required
                />
              </FormField>
              <FormField label="Reported fault">
                <textarea
                  className="input textarea"
                  value={values.fault}
                  onChange={(event) => update("fault", event.target.value)}
                  placeholder="Describe the device fault or issue"
                />
              </FormField>
              <FormField label="Received condition">
                <select
                  className="input"
                  value={CONDITIONS.includes(values.receivedCondition) ? values.receivedCondition : "Other"}
                  onChange={(event) => {
                    update("receivedCondition", event.target.value);
                    if (event.target.value !== "Other") {
                      setOtherCondition("");
                    }
                  }}
                >
                  {CONDITIONS.map((cond) => (
                    <option key={cond} value={cond}>
                      {cond}
                    </option>
                  ))}
                </select>
                {(values.receivedCondition === "Other" || !CONDITIONS.includes(values.receivedCondition)) && (
                  <input
                    className="input"
                    style={{ marginTop: 8 }}
                    type="text"
                    value={otherCondition}
                    onChange={(event) => setOtherCondition(event.target.value)}
                    placeholder="Please specify other condition..."
                    autoFocus
                  />
                )}
              </FormField>
              <FormField label="Service charge (₹)">
                <input
                  className="input"
                  type="number"
                  min="0"
                  value={values.serviceCharge}
                  onChange={(event) => update("serviceCharge", event.target.value)}
                />
              </FormField>
              <FormField label="Delivery date">
                <input
                  className="input"
                  type="date"
                  value={values.deliveryDate}
                  onChange={(event) => update("deliveryDate", event.target.value)}
                />
              </FormField>
              <FormField label="Out person (Delivered to)">
                <input
                  className="input"
                  value={values.deliveryCustomer}
                  onChange={(event) => update("deliveryCustomer", event.target.value)}
                />
              </FormField>
              {error && <span className="field-error" style={{ gridColumn: "span 2" }}>{error}</span>}
            </div>
            <div className="modal-footer" style={{ padding: "12px 20px" }}>
              <Button variant="ghost" type="button" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : <><Check size={15} /> Save changes</>}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function VendorServiceDeliveryModal({ service, vendor, onClose, onSave }: {
  service: VendorService;
  vendor: ServiceVendor;
  onClose: () => void;
  onSave: (delivery: Pick<VendorService, "deliveryDate" | "deliveryCustomer">) => Promise<void>;
}) {
  const [deliveryDate, setDeliveryDate] = useState(service.deliveryDate?.slice(0, 10) || dateInputValue());
  const [deliveryCustomer, setDeliveryCustomer] = useState(service.deliveryCustomer ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!deliveryDate) {
      setError("Choose a delivery date.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave({
        deliveryDate: businessDateTime(deliveryDate),
        deliveryCustomer: deliveryCustomer.trim(),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save delivery details.");
    } finally {
      setSaving(false);
    }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="modal-box compact-modal" onSubmit={submit}><div className="modal-header"><div><span className="eyebrow">{vendor.name.toUpperCase()} · {service.serviceNumber}</span><h2>Delivery details</h2></div><button className="icon-btn" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button></div><div className="modal-fields"><FormField label="Delivery date"><input className="input" type="date" value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} required /><span className="field-hint">Defaults to today.</span></FormField><FormField label="Delivery customer"><input className="input" value={deliveryCustomer} onChange={(event) => setDeliveryCustomer(event.target.value)} placeholder="Name of the person receiving the device" /></FormField>{error && <span className="field-error">{error}</span>}</div><div className="modal-footer"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving…" : <><Check size={15} /> Save delivery details</>}</Button></div></form></div>;
}

function ConfirmDeleteModal({
  title,
  itemName,
  description,
  confirmLabel = "Delete",
  onCancel,
  onConfirm,
}: {
  title: string;
  itemName?: string;
  description: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const handleConfirm = async () => {
    setBusy(true);
    setError("");
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deletion failed.");
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (!busy && e.target === e.currentTarget) onCancel(); }}>
      <div className="modal-box compact-modal" role="dialog" aria-modal="true">
        <div className="modal-header">
          <div>
            {itemName && <span className="eyebrow">{itemName}</span>}
            <h2>{title}</h2>
          </div>
          <button className="icon-btn" type="button" disabled={busy} onClick={onCancel} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-fields">
          <p style={{ margin: 0, color: "#4a5568", lineHeight: 1.5 }}>{description}</p>
          {error && <span className="field-error">{error}</span>}
        </div>
        <div className="modal-footer">
          <Button variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button variant="danger" disabled={busy} onClick={handleConfirm}>
            {busy ? "Deleting…" : <><Trash2 size={15} /> {confirmLabel}</>}
          </Button>
        </div>
      </div>
    </div>
  );
}

function EditSaleModal({
  sale,
  onClose,
  onSave,
}: {
  sale: Sale;
  onClose: () => void;
  onSave: (updated: {
    customerName: string;
    contactNumber: string;
    customerAddress: string;
    invoiceDate: string;
    products: ProductLine[];
    subtotal: number;
    discount: number;
    tax: number;
    finalAmount: number;
  }) => Promise<void>;
}) {
  const [customerName, setCustomerName] = useState(sale.customerName);
  const [contactNumber, setContactNumber] = useState(sale.contactNumber);
  const [customerAddress, setCustomerAddress] = useState(sale.customerAddress || "");
  const [invoiceDate, setInvoiceDate] = useState(sale.invoiceDate.slice(0, 10));
  const [products, setProducts] = useState<ProductLine[]>(sale.products.map((p) => ({ ...p })));
  const [discount, setDiscount] = useState(sale.discount || 0);
  const [tax, setTax] = useState(sale.tax || 0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const subtotal = products.reduce((sum, p) => sum + Math.max(0, p.quantity * p.rate - p.discount), 0);
  const finalAmount = Math.max(0, subtotal - discount + tax);
  const paid = paymentTotal(sale.payments);
  const due = Math.max(0, finalAmount - paid);

  const addProduct = () => {
    setProducts((curr) => [
      ...curr,
      { id: newId(), category: "Electronics", brand: "", model: "", productName: "", imei: "", quantity: 1, rate: 0, discount: 0 },
    ]);
  };

  const updateProduct = (id: string, key: keyof ProductLine, value: string | number) => {
    setProducts((curr) => curr.map((p) => p.id === id ? { ...p, [key]: value } : p));
  };

  const removeProduct = (id: string) => {
    if (products.length <= 1) return;
    setProducts((curr) => curr.filter((p) => p.id !== id));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!customerName.trim()) {
      setError("Customer name is required.");
      return;
    }
    if (!contactNumber.trim()) {
      setError("Customer contact number is required.");
      return;
    }
    if (products.length === 0) {
      setError("At least one product is required.");
      return;
    }
    for (const [i, p] of products.entries()) {
      const cat = p.category ?? "Electronics";
      if (cat === "Electronics") {
        if (!p.brand.trim() || !p.model.trim()) {
          setError(`Product ${i + 1}: Brand and Model are required.`);
          return;
        }
      } else {
        if (!p.productName?.trim()) {
          setError(`Product ${i + 1}: Product name is required.`);
          return;
        }
      }
      if (p.discount > p.quantity * p.rate) {
        setError(`Product ${i + 1}: Discount cannot exceed line amount.`);
        return;
      }
    }

    setSaving(true);
    setError("");
    try {
      await onSave({
        customerName: customerName.trim(),
        contactNumber: contactNumber.trim(),
        customerAddress: customerAddress.trim(),
        invoiceDate: businessDateTime(invoiceDate),
        products: products.map((p) => ({
          ...p,
          category: p.category ?? "Electronics",
          brand: (p.category ?? "Electronics") === "Electronics" ? p.brand.trim() : "",
          model: (p.category ?? "Electronics") === "Electronics" ? p.model.trim() : "",
          productName: (p.category ?? "Electronics") === "Accessories" ? p.productName?.trim() : undefined,
          imei: p.imei?.trim() || "",
        })),
        subtotal,
        discount,
        tax,
        finalAmount,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update invoice.");
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (!saving && e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 680 }}>
        <form onSubmit={handleSubmit}>
          <div className="modal-header">
            <div>
              <span className="eyebrow">EDIT INVOICE · {sale.invoiceNumber}</span>
              <h2>Edit sales details</h2>
            </div>
            <button className="icon-btn" type="button" disabled={saving} onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>

          <div style={{ padding: "16px 20px", display: "grid", gap: 16 }}>
            <div className="panel detail-panel" style={{ padding: 14 }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600, color: "#2d3748" }}>Customer details</h3>
              <div className="form-grid two-col">
                <FormField label="Customer name">
                  <input className="input" value={customerName} onChange={(e) => setCustomerName(e.target.value)} required />
                </FormField>
                <FormField label="Contact number">
                  <input className="input" inputMode="tel" value={contactNumber} onChange={(e) => setContactNumber(e.target.value)} required />
                </FormField>
                <FormField label="Customer address">
                  <textarea className="input textarea" maxLength={500} value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} placeholder="Street, area, city" />
                </FormField>
                <FormField label="Invoice date">
                  <input className="input" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} required />
                </FormField>
              </div>
            </div>

            <div className="panel detail-panel" style={{ padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#2d3748" }}>Products</h3>
                <Button variant="secondary" type="button" onClick={addProduct}><Plus size={14} /> Add product</Button>
              </div>
              <div className="product-list">
                {products.map((p, idx) => (
                  <div className="product-row" key={p.id}>
                    <div className="product-row-title">
                      <span>Item {String(idx + 1).padStart(2, "0")}</span>
                      {products.length > 1 && (
                        <button className="remove-link" type="button" onClick={() => removeProduct(p.id)}>
                          <X size={14} /> Remove
                        </button>
                      )}
                    </div>
                    <div className="form-grid product-fields">
                      <FormField label="Category">
                        <div className="select-wrap category1-select-wrap">
                          <select className="input" value={p.category ?? "Electronics"} onChange={(e) => {
                            const cat = e.target.value as ProductCategory;
                            setProducts(curr => curr.map(item => item.id === p.id ? { ...item, category: cat, brand: "", model: "", productName: "" } : item));
                          }}>
                            <option value="Electronics">Electronics</option>
                            <option value="Accessories">Accessories</option>
                          </select>
                          <ChevronDown size={14} />
                        </div>
                      </FormField>
                      {(p.category ?? "Electronics") === "Electronics" ? (
                        <>
                          <FormField label="Brand">
                            <input className="input" placeholder="Brand" value={p.brand} onChange={(e) => updateProduct(p.id, "brand", e.target.value)} required />
                          </FormField>
                          <FormField label="Model">
                            <input className="input" placeholder="Model" value={p.model} onChange={(e) => updateProduct(p.id, "model", e.target.value)} required />
                          </FormField>
                        </>
                      ) : (
                        <div className="product-span-2">
                          <FormField label="Product name">
                            <input className="input" placeholder="e.g. Charger, Case" value={p.productName ?? ""} onChange={(e) => updateProduct(p.id, "productName", e.target.value)} required />
                          </FormField>
                        </div>
                      )}
                      <FormField label="IMEI / Serial">
                        <div className="imei-input-wrap"><input className="input" maxLength={20} placeholder="Optional" value={p.imei} onChange={(e) => updateProduct(p.id, "imei", e.target.value)} /><ScanBarcodeButton onScan={(value) => updateProduct(p.id, "imei", value)} /></div>
                      </FormField>
                      <FormField label="Qty">
                        <input className="input" type="number" min="1" value={p.quantity} onChange={(e) => updateProduct(p.id, "quantity", Math.max(1, Number(e.target.value)))} required />
                      </FormField>
                      <FormField label="Rate (₹)">
                        <input className="input" type="number" min="0" value={p.rate || ""} placeholder="0" onChange={(e) => updateProduct(p.id, "rate", Math.max(0, Number(e.target.value)))} required />
                      </FormField>
                      <FormField label="Discount (₹)">
                        <input className="input" type="number" min="0" value={p.discount || ""} placeholder="0" onChange={(e) => updateProduct(p.id, "discount", Math.max(0, Number(e.target.value)))} />
                      </FormField>
                      <div className="line-total">
                        <span>Line total</span>
                        <strong>{money(Math.max(0, p.quantity * p.rate - p.discount))}</strong>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel detail-panel" style={{ padding: 14 }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600, color: "#2d3748" }}>Tax & discount</h3>
              <div className="form-grid two-col">
                <FormField label="Invoice discount (₹)">
                  <input className="input" type="number" min="0" value={discount || ""} placeholder="0" onChange={(e) => setDiscount(Math.max(0, Number(e.target.value)))} />
                </FormField>
                <FormField label="Tax (₹)">
                  <input className="input" type="number" min="0" value={tax || ""} placeholder="0" onChange={(e) => setTax(Math.max(0, Number(e.target.value)))} />
                </FormField>
              </div>
            </div>

            <div style={{ background: "#f8fafc", padding: 14, borderRadius: 8, display: "grid", gap: 6, fontSize: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>Subtotal</span><strong>{money(subtotal)}</strong></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>Discount</span><strong>− {money(discount)}</strong></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>Tax</span><strong>{money(tax)}</strong></div>
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px dashed #cbd5e1", paddingTop: 6, fontWeight: 700, fontSize: 15 }}>
                <span>Total amount</span><strong>{money(finalAmount)}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b" }}><span>Already paid</span><span>{money(paid)}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", color: due > 0 ? "#c2410c" : "#15803d", fontWeight: 600 }}>
                <span>Remaining balance</span><strong>{money(due)}</strong>
              </div>
            </div>

            {error && <span className="field-error">{error}</span>}
          </div>

          <div className="modal-footer" style={{ padding: "12px 20px" }}>
            <Button variant="ghost" type="button" disabled={saving} onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : <><Check size={15} /> Save changes</>}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditServiceModal({
  service,
  vendors,
  onClose,
  onSave,
}: {
  service: ServiceJob;
  vendors: ServiceVendor[];
  onClose: () => void;
  onSave: (updated: {
    customerName: string;
    contactNumber: string;
    customerAddress: string;
    inDate: string;
    category?: ProductCategory;
    brand: string;
    mobileModel: string;
    productName?: string;
    imei: string;
    reportedFault: string;
    technicianNotes?: string;
    receivedConditions?: string[];
    remarks?: string;
    serviceAmount: number;
    discount: number;
    finalAmount: number;
    vendorId?: string;
  }) => Promise<void>;
}) {
  const [customerName, setCustomerName] = useState(service.customerName);
  const [contactNumber, setContactNumber] = useState(service.contactNumber);
  const [customerAddress, setCustomerAddress] = useState(service.customerAddress || "");
  const [inDate, setInDate] = useState(service.inDate.slice(0, 10));
  const [category, setCategory] = useState<ProductCategory>(service.category ?? "Electronics");
  const [brand, setBrand] = useState(service.brand || "");
  const [mobileModel, setMobileModel] = useState(service.mobileModel || "");
  const [productName, setProductName] = useState(service.productName || "");
  const [imei, setImei] = useState(service.imei || "");
  const [reportedFault, setReportedFault] = useState(service.reportedFault || "");
  const [technicianNotes, setTechnicianNotes] = useState(service.technicianNotes || "");
  const [conditions, setConditions] = useState<string[]>(service.receivedConditions || []);
  const [otherCondition, setOtherCondition] = useState(() => {
    const custom = (service.receivedConditions || []).find((c) => !CONDITIONS.includes(c) || c.startsWith("Other: "));
    if (custom) return custom.replace(/^Other:\s*/, "");
    return "";
  });
  const [remarks, setRemarks] = useState(service.remarks || "");
  const [serviceAmount, setServiceAmount] = useState(service.serviceAmount || 0);
  const [discount, setDiscount] = useState(service.discount || 0);
  const [vendorId, setVendorId] = useState(service.vendorId || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const finalAmount = Math.max(0, serviceAmount - discount);

  const toggleCondition = (item: string) => {
    setConditions((curr) =>
      curr.includes(item) ? curr.filter((c) => c !== item) : [...curr, item]
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!customerName.trim()) {
      setError("Customer name is required.");
      return;
    }
    if (!contactNumber.trim()) {
      setError("Contact number is required.");
      return;
    }
    if (category === "Electronics") {
      if (!brand.trim()) {
        setError("Brand is required.");
        return;
      }
      if (!mobileModel.trim()) {
        setError("Model is required.");
        return;
      }
    } else {
      if (!productName.trim()) {
        setError("Product name is required.");
        return;
      }
    }
    if (!reportedFault.trim()) {
      setError("Reported fault is required.");
      return;
    }

    const finalConditions = conditions.filter((c) => c !== "Other" && !c.startsWith("Other: "));
    if (conditions.includes("Other") && otherCondition.trim()) {
      finalConditions.push(`Other: ${otherCondition.trim()}`);
    }

    setSaving(true);
    setError("");
    try {
      await onSave({
        customerName: customerName.trim(),
        contactNumber: contactNumber.trim(),
        customerAddress: customerAddress.trim(),
        inDate: businessDateTime(inDate),
        category,
        brand: category === "Electronics" ? brand.trim() : "",
        mobileModel: category === "Electronics" ? mobileModel.trim() : "",
        productName: category === "Accessories" ? productName.trim() : undefined,
        imei: imei.trim(),
        reportedFault: reportedFault.trim(),
        technicianNotes: technicianNotes.trim(),
        receivedConditions: finalConditions,
        remarks: remarks.trim(),
        serviceAmount,
        discount,
        finalAmount,
        vendorId: vendorId || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update service job.");
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (!saving && e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 650 }}>
        <form onSubmit={handleSubmit}>
          <div className="modal-header">
            <div>
              <span className="eyebrow">EDIT SERVICE · {service.serviceNumber}</span>
              <h2>Edit service job details</h2>
            </div>
            <button className="icon-btn" type="button" disabled={saving} onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>

          <div style={{ padding: "16px 20px", display: "grid", gap: 14 }}>
            <div className="panel detail-panel" style={{ padding: 14 }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600, color: "#2d3748" }}>Customer details</h3>
              <div className="form-grid two-col">
                <FormField label="Customer name">
                  <input className="input" value={customerName} onChange={(e) => setCustomerName(e.target.value)} required />
                </FormField>
                <FormField label="Contact number">
                  <input className="input" inputMode="tel" value={contactNumber} onChange={(e) => setContactNumber(e.target.value)} required />
                </FormField>
                <FormField label="Customer address">
                  <textarea className="input textarea" maxLength={500} value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} placeholder="Street, area, city" />
                </FormField>
                <FormField label="Intake date">
                  <input className="input" type="date" value={inDate} onChange={(e) => setInDate(e.target.value)} required />
                </FormField>
                <FormField label="Service vendor (optional)">
                  <select className="input" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                    <option value="">No vendor (Shop repair)</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>{v.name} ({v.phone})</option>
                    ))}
                  </select>
                </FormField>
              </div>
            </div>

            <div className="panel detail-panel" style={{ padding: 14 }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600, color: "#2d3748" }}>Device & issue</h3>
              <div className="form-grid two-col">
                <FormField label="Category">
                  <select className="input" value={category} onChange={(e) => setCategory(e.target.value as ProductCategory)}>
                    <option value="Electronics">Electronics</option>
                    <option value="Accessories">Accessories</option>
                  </select>
                </FormField>
                {category === "Electronics" ? (
                  <>
                    <FormField label="Brand">
                      <input className="input" placeholder="e.g. Samsung" value={brand} onChange={(e) => setBrand(e.target.value)} required />
                    </FormField>
                    <FormField label="Model">
                      <input className="input" placeholder="e.g. Galaxy S23" value={mobileModel} onChange={(e) => setMobileModel(e.target.value)} required />
                    </FormField>
                  </>
                ) : (
                  <FormField label="Product name">
                    <input className="input" placeholder="e.g. Earphones, Charger" value={productName} onChange={(e) => setProductName(e.target.value)} required />
                  </FormField>
                )}
                <FormField label="IMEI / Serial">
                  <div className="imei-input-wrap"><input className="input" maxLength={20} placeholder="Optional" value={imei} onChange={(e) => setImei(e.target.value)} /><ScanBarcodeButton onScan={setImei} /></div>
                </FormField>
              </div>

              <div style={{ marginTop: 12 }}>
                <FormField label="Reported fault">
                  <textarea className="input textarea" value={reportedFault} onChange={(e) => setReportedFault(e.target.value)} rows={2} required />
                </FormField>
              </div>

              <div style={{ marginTop: 12 }}>
                <FormField label="Technician notes">
                  <textarea className="input textarea" value={technicianNotes} onChange={(e) => setTechnicianNotes(e.target.value)} rows={2} />
                </FormField>
              </div>

              <div style={{ marginTop: 12 }}>
                <span className="field-label" style={{ marginBottom: 6 }}>Received condition</span>
                <div className="condition-list">
                  {CONDITIONS.map((cond) => {
                    const checked = cond === "Other"
                      ? conditions.includes("Other") || conditions.some((c) => c.startsWith("Other: "))
                      : conditions.includes(cond);
                    return (
                      <button
                        key={cond}
                        type="button"
                        className={`condition-chip ${checked ? "checked" : ""}`}
                        onClick={() => toggleCondition(cond)}
                      >
                        <span>{checked ? <Check size={11} strokeWidth={3} /> : null}</span>
                        {cond}
                      </button>
                    );
                  })}
                </div>
                {(conditions.includes("Other") || conditions.some((c) => c.startsWith("Other: "))) && (
                  <div style={{ marginTop: 8 }}>
                    <input
                      className="input"
                      placeholder="Specify other received condition"
                      value={otherCondition}
                      onChange={(e) => setOtherCondition(e.target.value)}
                    />
                  </div>
                )}
              </div>

              <div style={{ marginTop: 12 }}>
                <FormField label="Additional remarks">
                  <input className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
                </FormField>
              </div>
            </div>

            <div className="panel detail-panel" style={{ padding: 14 }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600, color: "#2d3748" }}>Service charges</h3>
              <div className="form-grid two-col">
                <FormField label="Service amount (₹)">
                  <input className="input" type="number" min="0" value={serviceAmount || ""} placeholder="0" onChange={(e) => setServiceAmount(Math.max(0, Number(e.target.value)))} required />
                </FormField>
                <FormField label="Discount (₹)">
                  <input className="input" type="number" min="0" value={discount || ""} placeholder="0" onChange={(e) => setDiscount(Math.max(0, Number(e.target.value)))} />
                </FormField>
              </div>
              <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", fontWeight: 600, fontSize: 15 }}>
                <span>Final amount:</span>
                <strong>{money(finalAmount)}</strong>
              </div>
            </div>

            {error && <span className="field-error">{error}</span>}
          </div>

          <div className="modal-footer" style={{ padding: "12px 20px" }}>
            <Button variant="ghost" type="button" disabled={saving} onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : <><Check size={15} /> Save changes</>}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ReportsPage({ data, revenuePeriod, setRevenuePeriod, canViewSales, canViewServices }: {
  data: WorkspaceData;
  revenuePeriod: RevenuePeriod;
  setRevenuePeriod: (period: RevenuePeriod) => void;
  canViewSales: boolean;
  canViewServices: boolean;
}) {
  const { sales, services } = data;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const included = (date: string) => (!from || date >= from) && (!to || date <= `${to}T23:59:59`);
  const filteredSales = sales.filter((sale) => included(sale.invoiceDate));
  const filteredServices = services.filter((service) => included(service.inDate));
  const filteredVendorServices = data.vendorServices.filter((service) => included(service.inDate));
  const salesTotal = filteredSales.reduce((sum, sale) => sum + sale.finalAmount, 0);
  const collected = filteredSales.reduce((sum, sale) => sum + paymentTotal(sale.payments), 0)
    + filteredServices.reduce((sum, service) => sum + servicePaid(service), 0);
  const due = filteredSales.reduce((sum, sale) => sum + Math.max(0, sale.finalAmount - paymentTotal(sale.payments)), 0)
    + filteredServices.reduce((sum, service) => sum + serviceDue(service), 0);
  const exportCsv = () => {
    const rows = [["Type", "Reference", "Date", "Customer", "Total", "Paid", "Balance", "Status"]];
    filteredSales.forEach((sale) => rows.push(["Sale", sale.invoiceNumber, sale.invoiceDate, sale.customerName, String(sale.finalAmount), String(paymentTotal(sale.payments)), String(Math.max(0, sale.finalAmount - paymentTotal(sale.payments))), statusOf(sale.finalAmount, paymentTotal(sale.payments))]));
    filteredServices.forEach((service) => rows.push(["Service", service.serviceNumber, service.inDate, service.customerName, String(service.serviceAmount - service.discount), String(servicePaid(service)), String(serviceDue(service)), service.status]));
    const csv = rows.map((row) => row.map((field) => `"${field.replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); link.download = `AH Mobiles-report-${dateInputValue()}.csv`; link.click(); URL.revokeObjectURL(link.href);
  };
  const exportServicesPdf = () => {
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const columns = [
      { title: "SERVICE BILL", width: 22 },
      { title: "DATE", width: 21 },
      { title: "CUSTOMER", width: 34 },
      { title: "CONTACT", width: 23 },
      { title: "DEVICE", width: 34 },
      { title: "REPORTED FAULT", width: 52 },
      { title: "STATUS", width: 22 },
      { title: "TOTAL", width: 22 },
      { title: "PAID", width: 22 },
      { title: "BALANCE", width: 22 },
    ];
    const orderedServices = filteredServices.slice()
      .sort((a, b) => (b.createdAt || b.inDate).localeCompare(a.createdAt || a.inDate));
    const serviceTotal = orderedServices.reduce((sum, service) => sum + service.serviceAmount - service.discount, 0);
    const serviceCollected = orderedServices.reduce((sum, service) => sum + servicePaid(service), 0);
    const serviceDueTotal: number = orderedServices.reduce(
      (sum, service) => sum + serviceDue(service),
      0
    );
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(16);
    pdf.text("Service Data Report", margin, 13);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.text(`Period: ${from || "All"} to ${to || "All"}  |  Generated: ${dateLabel(new Date().toISOString())}`, margin, 20);
    pdf.text(`Jobs: ${orderedServices.length}  |  Total: ${pdfMoney(serviceTotal)}  |  Paid: ${pdfMoney(serviceCollected)}  |  Balance: ${pdfMoney(serviceDueTotal)}`, margin, 26);

    const drawTableHeader = (y: number) => {
      pdf.setFillColor(238, 242, 248);
      pdf.rect(margin, y - 4, pageWidth - margin * 2, 7, "F");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7);
      let x = margin;
      columns.forEach((column) => {
        pdf.text(column.title, x + 1, y);
        x += column.width;
      });
      pdf.setFont("helvetica", "normal");
      return y + 6;
    };
    let y = drawTableHeader(34);
    orderedServices.forEach((service) => {
      const paid = servicePaid(service);
      const balance = Math.max(0, service.serviceAmount - service.discount - paid);
      const values = [
        service.serviceNumber,
        dateLabel(service.inDate),
        service.customerName,
        service.contactNumber,
        `${service.brand} ${service.mobileModel}`,
        service.reportedFault,
        service.status,
        pdfMoney(service.serviceAmount - service.discount),
        pdfMoney(paid),
        pdfMoney(balance),
      ];
      const lines = values.map((value, index) => pdf.splitTextToSize(value || "—", columns[index].width - 2) as string[]);
      const rowHeight = Math.max(6, ...lines.map((cellLines) => cellLines.length * 3.2 + 2));
      if (y + rowHeight > pageHeight - 12) {
        pdf.addPage();
        y = drawTableHeader(14);
      }
      let x = margin;
      lines.forEach((cellLines, index) => {
        pdf.text(cellLines, x + 1, y, { maxWidth: columns[index].width - 2 });
        x += columns[index].width;
      });
      y += rowHeight;
      pdf.setDrawColor(225, 230, 238);
      pdf.line(margin, y - 2, pageWidth - margin, y - 2);
    });
    const pageCount = pdf.getNumberOfPages();
    for (let page = 1; page <= pageCount; page += 1) {
      pdf.setPage(page);
      pdf.setFontSize(8);
      pdf.text(`Page ${page} of ${pageCount}`, pageWidth - margin, pageHeight - 5, { align: "right" });
    }
    pdf.save(`AH Mobiles-service-report-${dateInputValue()}.pdf`);
  };
  return <>
    <PageHeader eyebrow="BUSINESS INSIGHTS" title="Reports" description="A clear picture of sales, services, and the money collected."><Button variant="secondary" onClick={exportServicesPdf}><Download size={15} /> Export services PDF</Button><Button variant="secondary" onClick={exportCsv}><Download size={15} /> Export CSV</Button></PageHeader>
    <RevenueAnalytics data={data} period={revenuePeriod} onPeriodChange={setRevenuePeriod} canViewSales={canViewSales} canViewServices={canViewServices} />
    <section className="panel report-filter"><div><strong>Report period</strong><span>Choose a date range for your records.</span></div><div className="date-range"><label>From<input className="input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><ArrowRight size={15} /><label>To<input className="input" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><button className="text-link" onClick={() => { setFrom(""); setTo(""); }}>Clear</button></div></section>
    <div className="report-metrics">{[{ label: "Sales billed", value: money(salesTotal), note: `${filteredSales.length} invoices`, icon: CreditCard }, { label: "Service revenue", value: money(filteredServices.reduce((sum, item) => sum + item.serviceAmount - item.discount, 0)), note: `${filteredServices.length} jobs`, icon: Wrench }, { label: "Collected", value: money(collected), note: "Sales & service payments", icon: CheckCircle2 }, { label: "Outstanding", value: money(due), note: "Remaining balances", icon: Clock3 }].map(({ label, value, note, icon: Icon }) => <div className="panel report-metric" key={label}><span className="metric-icon blue"><Icon size={17} /></span><span>{label}<strong>{value}</strong><small>{note}</small></span></div>)}</div>
    <div className="reports-grid"><section className="panel report-chart-panel"><div className="panel-heading"><div><h2>Revenue over time</h2><p>Filtered sales, service, and vendor service totals</p></div></div>{filteredSales.length + filteredServices.length + filteredVendorServices.length ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartForPeriod({ ...EMPTY_DATA, sales: filteredSales, services: filteredServices, vendorServices: filteredVendorServices }, "Month")}><CartesianGrid stroke="#eef1f6" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 14, fill: "#98a1b3" }} /><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 14, fill: "#98a1b3" }} /><Tooltip formatter={(value) => money(Number(value))} /><Area type="monotone" dataKey="sales" name="Sales" stroke="#4777f5" fill="#4777f5" fillOpacity={0.12} /><Area type="monotone" dataKey="services" name="Services" stroke="#22ad94" fill="#22ad94" fillOpacity={0.12} /><Area type="monotone" dataKey="vendorServices" name="Vendor services" stroke="#8c71e8" fill="#8c71e8" fillOpacity={0.12} /></AreaChart></ResponsiveContainer></div> : <EmptyState icon={BarChart3} title="Your reports will grow with you" detail="Add sales and service jobs to see your revenue trends." />}</section><section className="panel report-status-panel"><div className="panel-heading"><div><h2>Service status</h2><p>Jobs by current stage</p></div></div>{(["Received", "In progress", "Ready", "Returned"] as ServiceStatus[]).map((status) => { const count = filteredServices.filter((service) => service.status === status).length; const ratio = filteredServices.length ? count / filteredServices.length * 100 : 0; return <div className="report-status" key={status}><div><span>{status}</span><strong>{count}</strong></div><div className="progress-track"><i className={`progress-${statusClass(status)}`} style={{ width: `${ratio}%` }} /></div></div>; })}</section></div>
    {canViewServices && <VendorAnalytics data={data} period={revenuePeriod} />}
  </>;
}

function SettingsPage({ settings, identity, canEdit, onSave, onChangePassword }: {
  settings: ShopSettings;
  identity: WorkspaceIdentity | null;
  canEdit: boolean;
  onSave: (settings: ShopSettings) => Promise<void>;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}) {
  const [form, setForm] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [logoError, setLogoError] = useState("");
  const update = <K extends keyof ShopSettings,>(key: K, value: ShopSettings[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const uploadLogo = (file?: File) => {
    setLogoError("");
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      setLogoError("Choose a PNG or JPEG image.");
      return;
    }
    if (file.size > 200 * 1024) {
      setLogoError("The logo must be 200 KB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        setLogoError("The image could not be read.");
        return;
      }
      update("logoDataUrl", reader.result);
    };
    reader.onerror = () => setLogoError("The image could not be read.");
    reader.readAsDataURL(file);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try { await onSave(form); }
    finally { setSaving(false); }
  };
  return <>
    <PageHeader eyebrow="YOUR WORKSPACE" title="Settings" description="Make every invoice feel like it came from your shop." />
    <AccountAccessSettings identity={identity} onChangePassword={onChangePassword} />
    <form onSubmit={submit} className="settings-layout">
      <div className="settings-main">
        <fieldset className="settings-fields" disabled={!canEdit}>
        <section className="panel form-panel">
          <div className="form-section-head"><span className="step-number"><Settings size={16} /></span><div><h2>Shop information</h2><p>This information appears on customer invoices and receipts.</p></div></div>
          <div className="form-grid two-col">
            <FormField label="Shop name"><input className="input" value={form.shopName} onChange={(event) => update("shopName", event.target.value)} required /></FormField>
            <FormField label="Owner name"><input className="input" value={form.ownerName} onChange={(event) => update("ownerName", event.target.value)} /></FormField>
            <FormField label="Contact number"><input className="input" value={form.phone} onChange={(event) => update("phone", event.target.value)} /></FormField>
            <FormField label="Email"><input className="input" type="email" value={form.email} onChange={(event) => update("email", event.target.value)} /></FormField>
            <FormField label="GSTIN (optional)"><input className="input" value={form.gstin} onChange={(event) => update("gstin", event.target.value)} placeholder="15-character GSTIN" /></FormField>
            <FormField label="Address"><textarea className="input textarea" value={form.address} onChange={(event) => update("address", event.target.value)} placeholder="Shop address" /></FormField>
            <FormField label="Shop logo (PNG/JPEG, up to 200 KB)">
              <input className="input" type="file" accept="image/png,image/jpeg" onChange={(event) => uploadLogo(event.target.files?.[0])} />
              {logoError && <span className="field-error">{logoError}</span>}
              <div className="settings-logo-row"><div className="settings-logo-preview" role="img" aria-label={form.logoDataUrl ? "Current custom shop logo" : "Default AH Mobiles logo"} style={{ backgroundColor: form.logoDataUrl ? "#fff" : "#000", backgroundImage: `url("${form.logoDataUrl || BRAND_LOGO_PATH}")` }} />{form.logoDataUrl && <button type="button" className="text-link" onClick={() => update("logoDataUrl", undefined)}>Use default AH Mobiles logo</button>}</div>
            </FormField>
          </div>
        </section>
        <section className="panel form-panel">
          <div className="form-section-head"><span className="step-number"><FileText size={16} /></span><div><h2>Invoice preferences</h2><p>Choose the numbering, print size, and customer footer.</p></div></div>
          <div className="form-grid two-col">
            <FormField label="Sales prefix"><input className="input" maxLength={6} value={form.salesPrefix} onChange={(event) => update("salesPrefix", event.target.value.toUpperCase())} /></FormField>
            <FormField label="Service prefix"><input className="input" maxLength={6} value={form.servicePrefix} onChange={(event) => update("servicePrefix", event.target.value.toUpperCase())} /></FormField>
            <FormField label="Invoice print size"><select className="input" value={form.invoicePaperSize} onChange={(event) => update("invoicePaperSize", event.target.value as ShopSettings["invoicePaperSize"])}><option value="A4">A4</option><option value="Thermal">Thermal receipt (80 mm)</option></select><small className="field-hint">PDF downloads remain A4; this setting applies to sales and service printing.</small></FormField>
            <FormField label="Invoice footer"><textarea className="input textarea" value={form.invoiceFooter} onChange={(event) => update("invoiceFooter", event.target.value)} /></FormField>
            <div className="invoice-format-preview"><span>Next invoice numbers</span><strong>{form.salesPrefix || "SAL"}-{businessYear()}-0001</strong><strong>{form.servicePrefix || "SRV"}-{businessYear()}-0001</strong></div>
          </div>
        </section>
        </fieldset>
        {canEdit && <div className="form-footer"><Button type="submit" disabled={saving}>{saving ? "Saving…" : <><Check size={16} /> Save settings</>}</Button></div>}
      </div>
      <aside className="settings-aside">
        <div className="panel settings-note"><span className="settings-note-icon"><ShieldCheck size={17} /></span><h3>Your data, kept safe.</h3><p>Each workspace is scoped to its authenticated owner. Keep Firestore rules deployed and up to date.</p></div>
        <div className="panel settings-note"><span className="settings-note-icon violet-icon"><Zap size={17} /></span><h3>Made for India.</h3><p>Currency is displayed in Indian rupees (₹) and dates use the Indian format.</p></div>
      </aside>
    </form>
  </>;
}

function AccountAccessSettings({ identity, onChangePassword }: {
  identity: WorkspaceIdentity | null;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}) {
  const [employees, setEmployees] = useState<EmployeeAccount[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [permissions, setPermissions] = useState<EmployeePermissions>({ ...NO_EMPLOYEE_PERMISSIONS });
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [passwordError, setPasswordError] = useState("");

  useEffect(() => {
    if (identity?.role !== "admin") return;
    let active = true;
    void listEmployees().then((items) => {
      if (active) setEmployees(items);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Employees could not be loaded.");
    });
    return () => { active = false; };
  }, [identity]);

  const savePassword = async () => {
    setPasswordError("");
    if (newPassword.length < 8) { setPasswordError("Use at least 8 characters for the new password."); return; }
    if (newPassword !== confirmPassword) { setPasswordError("The new passwords do not match."); return; }
    setBusy(true);
    try {
      await onChangePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (reason) {
      setPasswordError(reason instanceof Error ? reason.message : "The password could not be changed.");
    } finally { setBusy(false); }
  };

  const createAccount = async () => {
    setError("");
    setBusy(true);
    try {
      const employee = await createEmployee({ username, password, permissions });
      setEmployees((current) => [...current, employee]);
      setUsername("");
      setPassword("");
      setPermissions({ ...NO_EMPLOYEE_PERMISSIONS });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Employee account could not be created.");
    } finally { setBusy(false); }
  };

  const changeEmployee = async (employee: EmployeeAccount, module: EmployeeModule, access: ModuleAccess) => {
    const nextPermissions = { ...employee.permissions, [module]: access };
    setError("");
    setBusy(true);
    try {
      await updateEmployee(employee.id, nextPermissions, employee.active);
      setEmployees((current) => current.map((item) => item.id === employee.id ? { ...item, permissions: nextPermissions } : item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Employee permissions could not be updated.");
    } finally { setBusy(false); }
  };

  const toggleEmployee = async (employee: EmployeeAccount) => {
    setError("");
    setBusy(true);
    try {
      await updateEmployee(employee.id, employee.permissions, !employee.active);
      setEmployees((current) => current.map((item) => item.id === employee.id ? { ...item, active: !item.active } : item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Employee account could not be updated.");
    } finally { setBusy(false); }
  };

  const deleteEmployee = async (employee: EmployeeAccount) => {
    if (!window.confirm(`Remove ${employee.username}'s account?`)) return;
    setError("");
    setBusy(true);
    try {
      await removeEmployee(employee.id);
      setEmployees((current) => current.filter((item) => item.id !== employee.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Employee account could not be removed.");
    } finally { setBusy(false); }
  };

  return <div className="account-access-settings">
    {identity && <section className="panel form-panel">
      <div className="form-section-head"><span className="step-number"><ShieldCheck size={16} /></span><div><h2>Account security</h2><p>Change the password for your {identity.role} sign-in.</p></div></div>
      <div className="form-grid two-col">
        <FormField label="Current password"><PasswordInput autoComplete="current-password" value={currentPassword} onChange={setCurrentPassword} /></FormField>
        <FormField label="New password"><PasswordInput autoComplete="new-password" value={newPassword} onChange={setNewPassword} /></FormField>
        <FormField label="Confirm new password"><PasswordInput autoComplete="new-password" value={confirmPassword} onChange={setConfirmPassword} /></FormField>
      </div>
      <div className="form-footer"><Button variant="secondary" disabled={busy || !currentPassword || !newPassword || !confirmPassword} onClick={() => void savePassword()}>Change password</Button></div>
      {passwordError && <div className="form-alert" role="alert">{passwordError}</div>}
    </section>}
    {identity?.role === "admin" && <section className="panel form-panel">
      <div className="form-section-head"><span className="step-number"><Users size={16} /></span><div><h2>Employee access</h2><p>Create staff logins and choose which modules they can view or edit.</p></div></div>
      <div className="form-grid two-col employee-create-fields">
        <FormField label="Username"><input className="input" autoComplete="off" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="e.g. sales.staff" /></FormField>
        <FormField label="Temporary password"><PasswordInput autoComplete="new-password" value={password} onChange={setPassword} placeholder="At least 8 characters" /></FormField>
      </div>
      <div className="employee-permissions">
        {EMPLOYEE_MODULES.map(({ key, label }) => <label className="employee-permission" key={key}><span>{label}</span><select className="input" value={permissions[key]} onChange={(event) => setPermissions((current) => ({ ...current, [key]: event.target.value as ModuleAccess }))}><option value="none">No access</option><option value="view">View only</option><option value="edit">Edit</option></select></label>)}
      </div>
      <div className="form-footer"><Button variant="secondary" disabled={busy || !username || password.length < 8 || Object.values(permissions).every((access) => access === "none")} onClick={() => void createAccount()}><Plus size={15} /> Create employee</Button></div>
      {employees.length > 0 && <div className="employee-list">{employees.map((employee) => <article className="employee-row" key={employee.id}>
        <div className="employee-row-heading"><strong>{employee.username}</strong><span className={employee.active ? "employee-active" : "employee-inactive"}>{employee.active ? "Active" : "Disabled"}</span><button className="btn btn-secondary" type="button" disabled={busy} onClick={() => void toggleEmployee(employee)}>{employee.active ? "Disable" : "Enable"}</button><button className="btn btn-danger" type="button" disabled={busy} onClick={() => void deleteEmployee(employee)}>Remove</button></div>
        <div className="employee-permissions">{EMPLOYEE_MODULES.map(({ key, label }) => <label className="employee-permission" key={key}><span>{label}</span><select className="input" value={employee.permissions[key]} disabled={busy || !employee.active} onChange={(event) => void changeEmployee(employee, key, event.target.value as ModuleAccess)}><option value="none">No access</option><option value="view">View only</option><option value="edit">Edit</option></select></label>)}</div>
      </article>)}</div>}
      {error && <div className="form-alert" role="alert">{error}</div>}
    </section>}
  </div>;
}

function PaymentModal({ total, paid, onClose, onSave }: {
  total: number; paid: number; onClose: () => void; onSave: (amount: number, notes: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const due = Math.max(0, total - paid);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const number = Number(amount);
    if (!Number.isFinite(number) || number <= 0) { setError("Enter a payment greater than zero."); return; }
    if (number > due) { setError(`Payment cannot exceed the balance of ${money(due)}.`); return; }
    setSaving(true);
    try { await onSave(number, notes); }
    finally { setSaving(false); }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="modal-box compact-modal" onSubmit={submit}><div className="modal-header"><div><span className="eyebrow">PAYMENT ENTRY</span><h2>Record a payment</h2></div><button className="icon-btn" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button></div><div className="payment-due-banner"><span>Remaining balance</span><strong>{money(due)}</strong></div><div className="modal-fields"><FormField label="Amount received (₹)"><input className="input" type="number" min="0.01" step="0.01" max={due} value={amount} onChange={(event) => setAmount(event.target.value)} autoFocus /></FormField><FormField label="Notes (optional)"><input className="input" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Reference or short note" /></FormField>{error && <span className="field-error">{error}</span>}</div><div className="modal-footer"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving…" : <><Check size={15} /> Save payment</>}</Button></div></form></div>;
}

function DeliveryModal({ service, onCancel, onSave }: {
  service: ServiceJob;
  onCancel: () => void;
  onSave: (delivery: Pick<ServiceJob, "deliveryOutDate" | "deliveryOutPerson" | "deliveryRemarks">) => Promise<void>;
}) {
  const [date, setDate] = useState(dateInputValue());
  const [customerName, setCustomerName] = useState("");
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!customerName.trim()) { setError("Enter the name of the customer picking up the device."); return; }
    if (!date) { setError("Choose the handover date."); return; }
    setSaving(true);
    try {
      await onSave({
        deliveryOutDate: businessDateTime(date),
        deliveryOutPerson: customerName.trim(),
        deliveryRemarks: remarks.trim(),
      });
    } finally { setSaving(false); }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}><form className="modal-box compact-modal" onSubmit={submit}><div className="modal-header"><div><span className="eyebrow">SERVICE HANDOVER</span><h2>Mark device as returned?</h2></div><button className="icon-btn" type="button" onClick={onCancel} aria-label="Close"><X size={18} /></button></div><p className="delivery-modal-copy"><strong>{service.serviceNumber}</strong> · {service.customerName}<br />Confirm the handover details before closing this job.</p><div className="modal-fields"><FormField label="Delivery out date"><input className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></FormField><FormField label="Customer picking up"><input className="input" value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Customer name" autoFocus /></FormField><FormField label="Delivery remarks (optional)"><textarea className="input textarea" value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Notes about the handover" /></FormField>{error && <span className="field-error">{error}</span>}</div><div className="modal-footer"><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving…" : <><Check size={15} /> Confirm handover</>}</Button></div></form></div>;
}

function NotRepairedModal({ service, refundable, onCancel, onSave }: {
  service: ServiceJob; refundable: number; onCancel: () => void;
  onSave: (details: { deliveryOutDate: string; deliveryOutPerson: string; deliveryRemarks: string; refundAmount: number }) => Promise<void>;
}) {
  const [date, setDate] = useState(dateInputValue());
  const [customerName, setCustomerName] = useState(service.customerName);
  const [remarks, setRemarks] = useState("Product could not be repaired.");
  const [refund, setRefund] = useState(String(refundable));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(refund);
    if (!customerName.trim()) { setError("Enter the name of the customer receiving the device."); return; }
    if (!date) { setError("Choose the return date."); return; }
    if (!Number.isFinite(amount) || amount < 0 || amount > refundable) { setError(`Refund must be between ₹0 and ${money(refundable)}.`); return; }
    setSaving(true);
    try { await onSave({ deliveryOutDate: businessDateTime(date), deliveryOutPerson: customerName.trim(), deliveryRemarks: remarks.trim(), refundAmount: Math.round(amount * 100) / 100 }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not complete the return."); }
    finally { setSaving(false); }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}><form className="modal-box compact-modal" onSubmit={submit}><div className="modal-header"><div><span className="eyebrow">SERVICE CLOSURE</span><h2>Return without repair</h2></div><button className="icon-btn" type="button" onClick={onCancel} aria-label="Close"><X size={18} /></button></div><p className="delivery-modal-copy"><strong>{service.serviceNumber}</strong> · {service.customerName}<br />Confirm the device handover and refund any advance collected.</p><div className="payment-required-summary"><div><span>Advance received</span><strong>{money(paymentTotal(service.payments))}</strong></div><div><span>Already refunded</span><strong>{money(paymentTotal(service.payments) - refundable)}</strong></div><div className="payment-required-due"><span>Available to refund</span><strong>{money(refundable)}</strong></div></div><div className="modal-fields"><FormField label="Refund amount (₹)"><input className="input" type="number" min="0" step="0.01" max={refundable} value={refund} onChange={(event) => setRefund(event.target.value)} /></FormField><FormField label="Return date"><input className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></FormField><FormField label="Customer receiving device"><input className="input" value={customerName} onChange={(event) => setCustomerName(event.target.value)} /></FormField><FormField label="Remarks (optional)"><textarea className="input textarea" value={remarks} onChange={(event) => setRemarks(event.target.value)} /></FormField>{error && <span className="field-error">{error}</span>}</div><div className="modal-footer"><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button type="submit" variant="danger" disabled={saving}>{saving ? "Saving…" : "Confirm return & refund"}</Button></div></form></div>;
}

function Pagination({ page, pages, total, pageSize, onPage }: { page: number; pages: number; total: number; pageSize: number; onPage: (page: number) => void }) {
  return <div className="pagination"><span>Showing <strong>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)}</strong> of <strong>{total}</strong></span><div><button aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={16} /></button><span>Page {page} of {pages}</span><button aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight size={16} /></button></div></div>;
}

function StatusBadge({ status }: { status: PaymentStatus | ServiceStatus | "Refund" }) {
  return <span className={`status-badge status-${statusClass(status)}`}><i />{status}</span>;
}

function statusClass(status: string): string {
  return status.toLowerCase().replaceAll(" ", "-");
}

function DetailField({ label, value }: { label: string; value: string }) {
  return <div className="detail-field"><span>{label}</span><strong>{value}</strong></div>;
}

function NotFound({ title, backLabel, onBack }: { title: string; backLabel: string; onBack: () => void }) {
  return <div className="panel not-found"><EmptyState icon={FileText} title={title} detail="The record may have been removed or the link may be incorrect." action={<Button variant="secondary" onClick={onBack}><ArrowLeft size={15} /> {backLabel}</Button>} /></div>;
}
