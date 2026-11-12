"use client";

import {
  Activity, ArrowLeft, ArrowRight, ArrowUpRight, BarChart3, Bell,
  Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ClipboardList,
  Clock3, CreditCard, Download, Eye, EyeOff, FileText, Filter, LayoutDashboard, LogOut, Menu, MoreHorizontal,
  Pencil, Plus, Printer, Search, Settings, ShieldCheck, Smartphone, Users, Wrench, X, Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { jsPDF } from "jspdf";
import {
  addPayment, changeOwnPassword, changeServiceStatus, createEmployee, createNumberedRecord, firebaseConfigured,
  listEmployees, loadWorkspaceIdentity, logOut, observeAuth, observeWorkspace, removeEmployee,
  signIn, updateEmployee, writeRecord, writeSettings,
} from "./lib/firebase";
import {
  makeCustomer, nextInvoiceNumber, patchSettings, readLocalWorkspace,
  updateLocalRecord, writeLocalWorkspace,
} from "./lib/local-data";
import {
  DEFAULT_SETTINGS, EMPLOYEE_MODULES, NO_EMPLOYEE_PERMISSIONS, type Customer, type EmployeeAccount,
  type EmployeeModule, type EmployeePermissions, type ModuleAccess, type Payment, type PaymentStatus,
  type ProductLine, type Sale, type ServiceJob, type ServiceStatus, type ShopSettings, type WorkspaceData, type WorkspaceIdentity,
} from "./lib/types";
import { customerSchema, loginSchema, saleSchema, serviceFormSchema, serviceSchema } from "./lib/validation";

const NAV = [
  { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { label: "Sales", href: "/sales", icon: CreditCard },
  { label: "Services", href: "/services", icon: Wrench },
  { label: "Ready for delivery", href: "/services/ready", icon: CheckCircle2 },
  { label: "Customers", href: "/customers", icon: Users },
  { label: "Reports", href: "/reports", icon: BarChart3 },
];
const CONDITIONS = ["Good condition", "Display damaged", "Body damaged", "Back panel damaged", "Screen cracked", "Power issue", "Other"];
const EMPTY_DATA: WorkspaceData = {
  sales: [], services: [], customers: [], settings: DEFAULT_SETTINGS,
};
type ChartPeriod = "Week" | "Month" | "Year" | "Custom";

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

function paymentTotal(payments: Payment[]): number {
  return payments.reduce((sum, payment) => sum + payment.amount, 0);
}

function statusOf(total: number, paid: number): PaymentStatus {
  if (paid >= total) return "Paid";
  return paid > 0 ? "Partially paid" : "Unpaid";
}

function newId(): string {
  return crypto.randomUUID();
}

type ToastInfo = { text: string; tone: "success" | "error" };

export default function Workspace() {
  const pathname = usePathname();
  const router = useRouter();
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
        setData({
          ...workspace,
          sales: mergePending(workspace.sales, pendingCloudRecords.current.sales),
          services: mergePending(workspace.services, pendingCloudRecords.current.services),
        });
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

  const persist = useCallback(async (nextData: WorkspaceData) => {
    if (!firebaseConfigured) writeLocalWorkspace(nextData);
    setData(nextData);
  }, []);

  const saveCustomer = useCallback(async (name: string, phone: string, email = ""): Promise<Customer> => {
    const customer = makeCustomer(name.trim(), phone.trim(), data.customers);
    const complete = { ...customer, email: email || customer.email || "" };
    if (!data.customers.some((item) => item.id === customer.id)) {
      if (firebaseConfigured && user) {
        const transactionEditor = user.role === "employee"
          && (user.permissions.sales === "edit" || user.permissions.services === "edit");
        if (user.role !== "employee" || user.permissions.customers === "edit" || !transactionEditor) {
          await writeRecord(user.shopId, "customers", complete.id, complete);
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
    const customer = await saveCustomer(draft.customerName, draft.contactNumber);
    if (firebaseConfigured && user) {
      const created = await createNumberedRecord(user.shopId, "sales", data.settings.salesPrefix || "SAL", {
        ...draft, customerId: customer.id,
      });
      const sale = { ...draft, id: created.id, invoiceNumber: created.number, customerId: customer.id };
      pendingCloudRecords.current.sales.set(sale.id, sale);
      setData((current) => ({ ...current, sales: [sale, ...current.sales.filter((item) => item.id !== sale.id)] }));
      return sale;
    }
    const id = newId();
    const invoiceNumber = draft.invoiceNumber.trim();
    const sale: Sale = { ...draft, id, invoiceNumber, customerId: customer.id };
    const customers = data.customers.some((item) => item.id === customer.id) ? data.customers : [customer, ...data.customers];
    await persist({ ...data, customers, sales: [sale, ...data.sales] });
    return sale;
  }, [data, persist, saveCustomer, user]);

  const saveService = useCallback(async (draft: Omit<ServiceJob, "id" | "serviceNumber"> & { serviceNumber?: string }): Promise<ServiceJob> => {
    const customer = await saveCustomer(draft.customerName, draft.contactNumber);
    if (firebaseConfigured && user) {
      const created = await createNumberedRecord(user.shopId, "services", data.settings.servicePrefix || "SRV", {
        ...draft, customerId: customer.id,
      });
      const service = { ...draft, id: created.id, serviceNumber: created.number, customerId: customer.id };
      pendingCloudRecords.current.services.set(service.id, service);
      setData((current) => ({ ...current, services: [service, ...current.services.filter((item) => item.id !== service.id)] }));
      return service;
    }
    const id = newId();
    const serviceNumber = draft.serviceNumber?.trim() || nextInvoiceNumber("services", data.settings.servicePrefix || "SRV", data.services);
    const service: ServiceJob = { ...draft, id, serviceNumber, customerId: customer.id };
    const customers = data.customers.some((item) => item.id === customer.id) ? data.customers : [customer, ...data.customers];
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
      if (service.payments.length === current.payments.length + 1) {
        const payment = service.payments.at(-1);
        if (!payment) throw new Error("The payment details are incomplete.");
        const newPayment = { amount: payment.amount, date: payment.date, notes: payment.notes };
        await addPayment(user.shopId, "services", service.id, newPayment);
      } else if (service.status !== current.status) {
        await changeServiceStatus(user.shopId, service.id, service.status, {
          readyAt: service.readyAt,
          deliveryOutDate: service.deliveryOutDate,
          deliveryOutPerson: service.deliveryOutPerson,
          deliveryRemarks: service.deliveryRemarks,
        });
      } else {
        throw new Error("Service records can only be changed through status or payment actions.");
      }
    } else await persist(updateLocalRecord(data, "services", service.id, service));
  }, [data, persist, user]);

  const saveShopSettings = useCallback(async (settings: ShopSettings) => {
    if (firebaseConfigured && user) await writeSettings(user.shopId, settings);
    else await persist(patchSettings(data, settings));
  }, [data, persist, user]);

  const setServiceStatus = useCallback((service: ServiceJob, status: ServiceStatus) => {
    const current = data.services.find((item) => item.id === service.id) ?? service;
    if (current.status === "Returned") {
      notify("This service job has already been returned and its status cannot be changed.");
      return;
    }
    if (status === "Returned") {
      if (current.status !== "Ready") {
        notify("Mark this service job as Ready before handing it back.");
        return;
      }
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
      return;
    }
    void updateService({ ...current, status, readyAt: status === "Ready" ? new Date().toISOString() : current.readyAt })
      .then(() => notify("Service status updated."))
      .catch(notifyFromError);
  }, [data.services, notify, notifyFromError, updateService, user?.uid, user?.username]);

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

  const segments = pathname.split("/").filter(Boolean);
  const route = segments[0] ?? "dashboard";
  const subroute = segments[1] ?? "";
  const routeId = segments[2] ?? (subroute && !["create", "ready"].includes(subroute) ? subroute : "");
  const activeHref = route === "dashboard" ? "/dashboard"
    : route === "sales" ? "/sales"
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
    : href === "/customers" ? canViewModule("customers")
    : canViewModule("reports"));

  if (!ready || loading) return <AuthLoading />;

  const openPayment = (kind: "sale" | "service", id: string) => {
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
          if (kind === "sale") await updateSale({ ...(record as Sale), payments: [...record.payments, payment] });
          else await updateService({ ...(record as ServiceJob), payments: [...record.payments, payment] });
          setModal(null);
          notify("Payment recorded.");
        } catch (reason) {
          notifyFromError(reason);
        }
      }}
    />);
  };

  const addCustomerDialog = () => {
    setModal(<CustomerModal
      onClose={() => setModal(null)}
      onSave={async (name, phone, email) => {
        try {
          const parsed = customerSchema.safeParse({ name, phone, email });
          if (!parsed.success) throw new Error(parsed.error.issues[0]?.message);
          const customer = await saveCustomer(name, phone, email);
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
      onSave={async (name, phone, email) => {
        try {
          const parsed = customerSchema.safeParse({ name, phone, email });
          if (!parsed.success) throw new Error(parsed.error.issues[0]?.message);
          const duplicate = data.customers.find((item) =>
            item.id !== customer.id && item.phone.replace(/\D/g, "") === phone.replace(/\D/g, ""));
          if (duplicate) throw new Error(`This number already belongs to ${duplicate.name}.`);
          const updated = { ...customer, name: name.trim(), phone: phone.trim(), email: email.trim() };
          if (firebaseConfigured && user) await writeRecord(user.shopId, "customers", updated.id, updated);
          else await persist(updateLocalRecord(data, "customers", updated.id, updated));
          setModal(null);
          notify("Customer details updated.");
        } catch (reason) { notifyFromError(reason); }
      }}
    />);
  };

  const view = route === "sales" && subroute === "create"
    ? <SaleForm
        data={data}
        busy={busy}
        onSubmit={async (draft) => {
          setBusy(true);
          try {
            const sale = await saveSale(draft);
            notify("Sales bill saved.");
            router.push(`/sales/${sale.id}`);
            return sale;
          } catch (reason) { notifyFromError(reason); }
          finally { setBusy(false); }
        }}
        onCancel={() => router.push("/sales")}
      />
    : route === "sales" && routeId
    ? <SaleDetail
        sale={data.sales.find((item) => item.id === routeId || item.invoiceNumber === routeId)}
        settings={data.settings}
        onBack={() => router.push("/sales")}
        onPayment={(id) => openPayment("sale", id)}
        canEdit={canEditModule("sales")}
      />
    : route === "sales"
    ? <SalesPage sales={data.sales} search={globalSearch} onSearch={setGlobalSearch}
        onCreate={() => router.push("/sales/create")} onView={(id) => router.push(`/sales/${id}`)}
        onPayment={(id) => openPayment("sale", id)} settings={data.settings} canEdit={canEditModule("sales")} />
    : route === "services" && subroute === "create"
    ? <ServiceForm
        customers={data.customers}
        services={data.services}
        settings={data.settings}
        busy={busy}
        onSubmit={async (draft) => {
          setBusy(true);
          try {
            const service = await saveService(draft);
            notify("Service job created.");
            router.push(`/services/${service.id}`);
            return service;
          } catch (reason) { notifyFromError(reason); }
          finally { setBusy(false); }
        }}
        onCancel={() => router.push("/services")}
      />
    : route === "services" && subroute === "ready"
    ? <ReadyPage services={data.services} onView={(id) => router.push(`/services/${id}`)}
        onPayment={(id) => openPayment("service", id)}
        onReturn={(service) => setServiceStatus(service, "Returned")}
        canEditPayment={canEditModule("services")}
        canReturn={canEditModule("services") || canEditModule("ready")}
        canViewAllServices={canViewModule("services") || canViewModule("reports")}
      />
    : route === "services" && routeId
    ? <ServiceDetail service={data.services.find((item) => item.id === routeId || item.serviceNumber === routeId)}
        onBack={() => router.push(canViewModule("services") || canViewModule("reports") ? "/services" : "/services/ready")}
        onPayment={(id) => openPayment("service", id)} settings={data.settings}
        onUpdate={(service) => setServiceStatus(service, service.status)} canEdit={canEditModule("services")} />
    : route === "services"
    ? <ServicesPage services={data.services} search={globalSearch} onSearch={setGlobalSearch}
        onCreate={() => router.push("/services/create")} onView={(id) => router.push(`/services/${id}`)}
        onPayment={(id) => openPayment("service", id)} onUpdate={(service) => setServiceStatus(service, service.status)}
        canEdit={canEditModule("services")} />
    : route === "customers"
    ? <CustomersPage customers={data.customers} sales={data.sales} services={data.services}
        search={globalSearch} onSearch={setGlobalSearch} onAdd={addCustomerDialog}
        selectedId={routeId} onView={(id) => router.push(id ? `/customers/${id}` : "/customers")}
        onEdit={editCustomerDialog} />
    : route === "reports"
    ? <ReportsPage sales={data.sales} services={data.services} />
    : route === "settings"
    ? <SettingsPage settings={data.settings} identity={user} canEdit={canEditModule("settings")} onSave={async (settings) => {
        try { await saveShopSettings(settings); notify("Settings saved."); }
        catch (reason) { notifyFromError(reason); }
      }} onChangePassword={async (currentPassword, newPassword) => {
        try { await changeOwnPassword(currentPassword, newPassword); notify("Password changed."); }
        catch (reason) { notifyFromError(reason); throw reason; }
      }} />
    : <Dashboard data={data} period={period} setPeriod={setPeriod} chartFrom={chartFrom} setChartFrom={setChartFrom} chartTo={chartTo} setChartTo={setChartTo}
        onCreateSale={() => router.push("/sales/create")}
        onCreateService={() => router.push("/services/create")}
        canCreateSale={canEditModule("sales")}
        canCreateService={canEditModule("services")}
        canViewSales={canViewModule("sales") || canViewModule("reports") || canViewModule("overview")}
        canViewServices={canViewModule("services") || canViewModule("reports") || canViewModule("overview")}
        canViewCustomers={canViewModule("customers") || canViewModule("overview")}
        canOpenSales={canViewModule("sales") || canViewModule("reports")}
        canOpenServices={canViewModule("services") || canViewModule("reports")}
        canOpenReady={canAccessReady}
        canOpenCustomers={canViewModule("customers")}
        onSeeSales={() => router.push("/sales")}
        onSeeServices={() => router.push("/services")}
        onSeeReady={() => router.push("/services/ready")}
        onCustomer={() => router.push("/customers")}
      />;

  return (
    <div className="app-shell">
      {menuOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <div className="brand-mark"><Smartphone size={19} strokeWidth={2.6} /></div>
          <span className="brand-name">{data.settings.shopName || "A&H Mobiles"}</span>
          <button className="icon-btn sidebar-close" aria-label="Close menu" onClick={() => setMenuOpen(false)}><X size={18} /></button>
        </div>
        <div className="sidebar-divider" role="separator" />
        <nav className="nav-list" aria-label="Main navigation">
          {visibleNav.map(({ label, href, icon: Icon }) => (
            <Link key={href} href={href} className={`nav-link ${activeHref === href ? "active" : ""}`}
              onClick={() => setMenuOpen(false)}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
              {href === "/services/ready" && data.services.filter((item) => item.status === "Ready").length > 0 &&
                <span className="nav-count">{data.services.filter((item) => item.status === "Ready").length}</span>}
            </Link>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <Link href="/settings" className={`nav-link settings-link ${activeHref === "/settings" ? "active" : ""}`}
          onClick={() => setMenuOpen(false)}>
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
          <div className="topbar-actions">
            <label className="global-search"><Search size={16} /><input value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} placeholder="Search anything..." /><kbd>⌘ K</kbd></label>
            <button className="icon-btn notification-btn" aria-label="Notifications" onClick={() => notify("You're all caught up.")}><Bell size={18} /><i /></button>
            <span className="topbar-avatar">{user?.email?.[0]?.toUpperCase() ?? "A"}</span>
          </div>
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
  if (route === "customers") return subroute ? "Customer details" : "Customers";
  if (route === "reports") return "Reports";
  if (route === "settings") return "Settings";
  return "Overview";
}

function AuthLoading() {
  return <div className="loading-screen"><div className="loading-brand"><div className="brand-mark"><Smartphone size={19} /></div><strong>A&H Mobiles</strong></div><div className="loading-spinner" /><span>Getting your workspace ready…</span></div>;
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
      <div className="auth-aside"><div className="auth-brand"><div className="brand-mark"><Smartphone size={19} /></div><strong>A&H Mobiles</strong></div><div className="auth-pitch"><span className="eyebrow">YOUR SHOP, IN SYNC</span><h1>Everything your shop needs.<br /><span>All in one place.</span></h1><p>Keep sales moving, repairs on track, and every customer feeling looked after.</p><div className="auth-points"><span><Check size={15} /> Sales & service billing</span><span><Check size={15} /> Customer & payment history</span><span><Check size={15} /> Reports that make sense</span></div></div><div className="auth-aside-foot">Simple tools. Better business.</div></div>
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

function Button({ children, variant = "primary", onClick, type = "button", disabled = false, className = "" }: {
  children: ReactNode; variant?: "primary" | "secondary" | "ghost" | "danger"; onClick?: () => void;
  type?: "button" | "submit"; disabled?: boolean; className?: string;
}) {
  return <button type={type} onClick={onClick} disabled={disabled} className={`btn btn-${variant} ${className}`}>{children}</button>;
}

function EmptyState({ icon: Icon = ClipboardList, title, detail, action }: { icon?: typeof ClipboardList; title: string; detail: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={22} strokeWidth={1.7} /></div><strong>{title}</strong><span>{detail}</span>{action}</div>;
}

function AccessDenied() {
  return <div className="panel"><EmptyState icon={ShieldCheck} title="Access not granted" detail="Ask your shop administrator to enable this module or permission." /></div>;
}

function Dashboard({ data, period, setPeriod, chartFrom, setChartFrom, chartTo, setChartTo, onCreateSale, onCreateService, canCreateSale, canCreateService, canViewSales, canViewServices, canViewCustomers, canOpenSales, canOpenServices, canOpenReady, canOpenCustomers, onSeeSales, onSeeServices, onSeeReady, onCustomer }: {
  data: WorkspaceData; period: ChartPeriod; setPeriod: (period: ChartPeriod) => void;
  chartFrom: string; setChartFrom: (value: string) => void; chartTo: string; setChartTo: (value: string) => void;
  onCreateSale: () => void; onCreateService: () => void; canCreateSale: boolean; canCreateService: boolean;
  canViewSales: boolean; canViewServices: boolean; canViewCustomers: boolean;
  canOpenSales: boolean; canOpenServices: boolean; canOpenReady: boolean; canOpenCustomers: boolean;
  onSeeSales: () => void; onSeeServices: () => void;
  onSeeReady: () => void; onCustomer: () => void;
}) {
  const today = new Date();
  const todaySales = data.sales.filter((sale) => new Date(sale.invoiceDate).toDateString() === today.toDateString()).reduce((sum, sale) => sum + sale.finalAmount, 0);
  const monthSales = data.sales.filter((sale) => {
    const date = new Date(sale.invoiceDate);
    return date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
  }).reduce((sum, sale) => sum + sale.finalAmount, 0);
  const serviceRevenue = data.services.reduce((sum, service) => sum + service.serviceAmount - service.discount, 0);
  const pending = data.services.filter((service) => !["Ready", "Returned"].includes(service.status)).length;
  const readyJobs = data.services.filter((service) => service.status === "Ready");
  const outstanding = data.sales.reduce((sum, sale) => sum + Math.max(0, sale.finalAmount - paymentTotal(sale.payments)), 0)
    + data.services.reduce((sum, service) => sum + Math.max(0, service.serviceAmount - service.discount - paymentTotal(service.payments)), 0);
  const metrics = [
    { label: "Sales today", value: money(todaySales), icon: CreditCard, accent: "blue", note: "Today's retail sales" },
    { label: "Sales this month", value: money(monthSales), icon: BarChart3, accent: "violet", note: "Retail revenue" },
    { label: "Service revenue", value: money(serviceRevenue), icon: Wrench, accent: "amber", note: "All service jobs" },
    { label: "Total service jobs", value: String(data.services.length), icon: ClipboardList, accent: "violet", note: "All-time service jobs" },
    { label: "Pending service jobs", value: String(pending), icon: Clock3, accent: "amber", note: "Received or in progress" },
    { label: "Ready for delivery", value: String(readyJobs.length), icon: CheckCircle2, accent: "green", note: "Awaiting customer pickup" },
    { label: "Total customers", value: String(data.customers.length), icon: Users, accent: "blue", note: "In your directory" },
    { label: "Outstanding", value: money(outstanding), icon: ArrowUpRight, accent: "rose", note: "Across sales & services" },
  ];
  const visibleMetrics = metrics.filter(({ label }) => {
    if (label === "Sales today" || label === "Sales this month") return canViewSales;
    if (label === "Total customers") return canViewCustomers;
    if (["Service revenue", "Total service jobs", "Pending service jobs", "Ready for delivery"].includes(label)) return canViewServices;
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
      <div className="metrics-grid">{visibleMetrics.map(({ label, value, icon: Icon, accent, note }) =>
        <div className="metric-card" key={label}><div className="metric-top"><span>{label}</span><span className={`metric-icon ${accent}`}><Icon size={17} /></span></div><strong>{value}</strong><div className="metric-note"><span>{note}</span></div></div>)}</div>
      <div className="dashboard-grid">
        {(canViewSales || canViewServices) && <section className="panel revenue-panel">
          <div className="panel-heading"><div><h2>Revenue overview</h2><p>{canViewSales && canViewServices ? "Sales and service income over time" : canViewSales ? "Sales revenue over time" : "Service income over time"}</p></div><div className="segmented">{(["Week", "Month", "Year", "Custom"] as const).map((item) => <button key={item} className={period === item ? "selected" : ""} onClick={() => setPeriod(item)}>{item}</button>)}</div></div>
          {period === "Custom" && <div className="date-range dashboard-date-range"><label>From<input className="input" type="date" value={chartFrom} onChange={(event) => setChartFrom(event.target.value)} /></label><ArrowRight size={15} /><label>To<input className="input" type="date" value={chartTo} onChange={(event) => setChartTo(event.target.value)} /></label><button className="text-link" onClick={() => { setChartFrom(""); setChartTo(""); }}>Clear</button></div>}
          {data.sales.length + data.services.length === 0
            ? <div className="chart-empty"><div className="chart-empty-art"><AreaChartIcon /></div><strong>Your revenue story starts here</strong><span>Sales and services will appear as you add your first bill.</span>{canCreateSale && <Button variant="secondary" onClick={onCreateSale}><Plus size={15} /> Add first sale</Button>}</div>
            : period === "Custom" && (!chartFrom || !chartTo || chartFrom > chartTo)
              ? <div className="chart-empty"><strong>Choose a valid date range</strong><span>Select both dates to see revenue for that period.</span></div>
              : <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 12, right: 9, left: -18, bottom: 0 }}>
                <defs><linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4677f5" stopOpacity={0.17} /><stop offset="100%" stopColor="#4677f5" stopOpacity={0} /></linearGradient><linearGradient id="servicesFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#27b69d" stopOpacity={0.16} /><stop offset="100%" stopColor="#27b69d" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid stroke="#eef1f6" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 14, fill: "#98a1b3" }} dy={8} /><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 14, fill: "#98a1b3" }} tickFormatter={(value: number) => value === 0 ? "₹0" : `₹${value / 1000}k`} /><Tooltip formatter={(value) => money(Number(value))} contentStyle={{ border: "1px solid #e8ebf1", borderRadius: 10, fontSize: 14 }} />
                {canViewSales && <Area type="monotone" dataKey="sales" name="Sales" stroke="#4777f5" strokeWidth={2.3} fill="url(#salesFill)" activeDot={{ r: 4 }} />}{canViewServices && <Area type="monotone" dataKey="services" name="Services" stroke="#22ad94" strokeWidth={2.3} fill="url(#servicesFill)" activeDot={{ r: 4 }} />}
              </AreaChart></ResponsiveContainer></div>}
          <div className="chart-legend">{canViewSales && <span><i className="legend-dot blue-dot" />Sales</span>}{canViewServices && <span><i className="legend-dot green-dot" />Services</span>}</div>
        </section>}
        {canViewServices && <section className="panel service-overview">
          <div className="panel-heading"><div><h2>Service desk</h2><p>Repair jobs at a glance</p></div>{canOpenServices && <button className="text-link" onClick={onSeeServices}>View all <ArrowRight size={14} /></button>}</div>
          <div className="service-summary">
            {(["Received", "In progress", "Ready", "Returned"] as ServiceStatus[]).map((status) => <div className="service-count" key={status}><span className={`status-dot ${statusClass(status)}`} /> <span>{status}</span><strong>{data.services.filter((job) => job.status === status).length}</strong></div>)}
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
            <div className="pickup-list">{readyJobs.slice(0, 4).map((job) => <div className="pickup-item" key={job.id}><span className="device-avatar"><Smartphone size={17} /></span><span className="pickup-info"><strong>{job.customerName}</strong><span>{job.brand} {job.mobileModel} · {job.serviceNumber}</span></span><span className="pickup-balance">{money(Math.max(0, job.serviceAmount - job.discount - paymentTotal(job.payments)))}</span></div>)}</div>}
        </section>}
        {canViewServices && <section className="panel recent-panel"><div className="panel-heading"><div><h2>Recent service bills</h2><p>Repairs that recently came in</p></div>{canOpenServices && <button className="text-link" onClick={onSeeServices}>See all <ArrowRight size={14} /></button>}</div>{data.services.length ? <div className="pickup-list">{data.services.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4).map((job) => <div className="pickup-item" key={job.id}><span className="device-avatar"><Wrench size={16} /></span><span className="pickup-info"><strong>{job.serviceNumber} · {job.customerName}</strong><span>{job.brand} {job.mobileModel} · {dateLabel(job.inDate)}</span></span><StatusBadge status={job.status} /></div>)}</div> : <EmptyState icon={Wrench} title="No service jobs yet" detail="New repair intakes will appear here." action={canCreateService ? <Button variant="secondary" onClick={onCreateService}><Plus size={14} /> Create service job</Button> : undefined} />}</section>}
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
    }).reduce((sum, item) => sum + item.serviceAmount - item.discount, 0);
    return { label: period === "Week" ? date.toLocaleDateString("en-IN", { weekday: "short" })
      : period === "Month" ? date.toLocaleDateString("en-IN", { month: "short" })
      : date.toLocaleDateString("en-IN", { month: "short" }), sales, services };
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
  const totals = new Map<string, { sales: number; services: number }>();
  const cursor = new Date(start);
  if (granularity === "month") cursor.setDate(1);
  if (granularity === "year") { cursor.setMonth(0, 1); }
  while (cursor <= end) {
    totals.set(keyForDate(cursor), { sales: 0, services: 0 });
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
    if (bucket) bucket.services += service.serviceAmount - service.discount;
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

function SalesPage({ sales, search, onSearch, onCreate, onView, onPayment, settings, canEdit }: {
  sales: Sale[]; search: string; onSearch: (value: string) => void; onCreate: () => void;
  onView: (id: string) => void; onPayment: (id: string) => void; settings: ShopSettings; canEdit: boolean;
}) {
  const [paymentFilter, setPaymentFilter] = useState("All statuses");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortBy, setSortBy] = useState("date-desc");
  const [page, setPage] = useState(1);
  const filtered = sales.filter((sale) => {
    const query = search.toLowerCase();
    const paid = paymentTotal(sale.payments);
    return (!query || `${sale.invoiceNumber} ${sale.customerName} ${sale.contactNumber}`.toLowerCase().includes(query))
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
      {filtered.length ? <SalesTable sales={filtered.slice((page - 1) * pageSize, page * pageSize)} onView={onView} onPayment={canEdit ? onPayment : undefined} settings={settings} /> :
        <EmptyState icon={CreditCard} title={search || paymentFilter !== "All statuses" ? "No matching invoices" : "Ready for your first sale?"} detail={sales.length ? "Try a different search or payment status." : "Create a sales bill and your invoices will appear here."} action={!sales.length && canEdit ? <Button onClick={onCreate}><Plus size={15} /> Create sales bill</Button> : undefined} />}
      {filtered.length > 0 && <Pagination page={page} pages={pages} total={filtered.length} pageSize={pageSize} onPage={setPage} />}
    </div>
  </>;
}

function SalesTable({ sales, compact = false, canOpen = true, onView, onPayment, settings }: {
  sales: Sale[]; compact?: boolean; canOpen?: boolean; onView?: (id: string) => void; onPayment?: (id: string) => void; settings?: ShopSettings;
}) {
  const router = useRouter();
  const viewSale = (id: string) => onView ? onView(id) : router.push(`/sales/${id}`);
  return <div className={`table-scroll ${compact ? "compact-table" : ""}`}><table className="data-table"><thead><tr><th>INVOICE</th><th>CUSTOMER</th>{!compact && <th>PRODUCTS</th>}<th>DATE</th><th>TOTAL</th>{!compact && <th>PAID</th>}<th>STATUS</th><th /></tr></thead><tbody>
    {sales.map((sale) => {
      const paid = paymentTotal(sale.payments);
      const due = Math.max(0, sale.finalAmount - paid);
      return <tr key={sale.id}><td>{canOpen ? <button className="table-primary-link" onClick={() => viewSale(sale.id)}>{sale.invoiceNumber}</button> : <span>{sale.invoiceNumber}</span>}</td><td><span className="customer-cell"><span className="mini-avatar">{sale.customerName[0]?.toUpperCase() || "?"}</span><span><strong>{sale.customerName}</strong><small>{sale.contactNumber}</small></span></span></td>{!compact && <td><span className="muted-cell">{sale.products.length} item{sale.products.length === 1 ? "" : "s"}</span></td>}<td><span className="muted-cell">{dateLabel(sale.invoiceDate)}</span></td><td><strong className="amount-cell">{money(sale.finalAmount)}</strong></td>{!compact && <td><span className="muted-cell">{money(paid)}{due > 0 && <small className="due-text">{money(due)} due</small>}</span></td>}<td><StatusBadge status={statusOf(sale.finalAmount, paid)} /></td><td>{canOpen && <button className="row-action" aria-label="View invoice" onClick={() => viewSale(sale.id)}><ArrowRight size={15} /></button>}{onPayment && due > 0 && <button className="row-action" aria-label="Record payment" onClick={() => onPayment(sale.id)}><Plus size={15} /></button>}{settings && <button className="row-action" aria-label="Download invoice" onClick={() => downloadInvoice(sale, settings)}><Download size={15} /></button>}</td></tr>;
    })}
  </tbody></table></div>;
}

function SaleForm({ data, busy, onSubmit, onCancel }: {
  data: WorkspaceData; busy: boolean; onSubmit: (draft: Omit<Sale, "id">) => Promise<Sale | undefined>; onCancel: () => void;
}) {
  const [products, setProducts] = useState<ProductLine[]>([{ id: newId(), brand: "", model: "", imei: "", quantity: 1, rate: 0, discount: 0 }]);
  const [tax, setTax] = useState(0);
  const [paid, setPaid] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState(false);
  const generatedInvoiceNumber = nextInvoiceNumber("sales", data.settings.salesPrefix || "SAL", data.sales);
  const { register, handleSubmit, control, formState: { errors } } = useForm({
    resolver: zodResolver(saleSchema.omit({ products: true })),
    defaultValues: { customerName: "", contactNumber: "", invoiceDate: dateInputValue(), invoiceNumber: generatedInvoiceNumber, discount: 0, tax: 0, amountPaid: 0 },
  });
  const name = useWatch({ control, name: "customerName" });
  const phone = useWatch({ control, name: "contactNumber" });
  const invoiceDate = useWatch({ control, name: "invoiceDate" });
  const invoiceNumber = useWatch({ control, name: "invoiceNumber" });
  const total = products.reduce((sum, product) => sum + Math.max(0, product.quantity * product.rate - product.discount), 0);
  const final = Math.max(0, total + tax);
  const matchingCustomer = data.customers.find((customer) => phone && customer.phone.replace(/\D/g, "") === phone.replace(/\D/g, ""));
  const addProduct = () => setProducts((current) => [...current, { id: newId(), brand: "", model: "", imei: "", quantity: 1, rate: 0, discount: 0 }]);
  const updateProduct = (id: string, key: keyof ProductLine, value: string | number) => setProducts((current) => current.map((item) => item.id === id ? { ...item, [key]: value } : item));
  const saveDraft = async (form: { customerName: string; contactNumber: string; invoiceDate: string; invoiceNumber: string }, printAfterSave = false) => {
    setFieldErrors({});
    const parsed = saleSchema.safeParse({ ...form, products, discount: 0, tax, amountPaid: paid });
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
    const customer = data.customers.find((item) => item.phone.replace(/\D/g, "") === form.contactNumber.replace(/\D/g, ""));
    const payments: Payment[] = paid ? [{ id: newId(), amount: paid, date: new Date().toISOString(), notes: "Payment at sale" }] : [];
    const saved = await onSubmit({
      invoiceNumber: trimmedInvoiceNumber,
      customerId: customer?.id ?? "",
      customerName: form.customerName.trim(),
      contactNumber: form.contactNumber.trim(),
      invoiceDate: businessDateTime(form.invoiceDate),
      products: products.map((item) => ({ ...item })),
      subtotal: total,
      discount: 0,
      tax,
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
    customerId: "", customerName: name || "Customer name", contactNumber: phone || "",
    invoiceDate, products, subtotal: total, discount: 0, tax, finalAmount: final,
    payments: paid ? [{ id: "preview", amount: paid, date: new Date().toISOString() }] : [], createdAt: new Date().toISOString(),
  };
  return <>
    <PageHeader eyebrow="SALES · NEW INVOICE" title="Create sales bill" description="Add a customer and products to put together a new invoice."><Button variant="secondary" onClick={onCancel}><ArrowLeft size={15} /> Back to sales</Button></PageHeader>
    <form className="billing-layout" onSubmit={submit} noValidate>
      <div className="billing-main">
        <section className="panel form-panel"><div className="form-section-head"><span className="step-number">01</span><div><h2>Customer details</h2><p>Who is this invoice for?</p></div></div>
          <div className="form-grid two-col"><FormField label="Customer name" error={errors.customerName?.message}><input className="input" placeholder="e.g. Priya Sharma" {...register("customerName")} /></FormField><FormField label="Contact number" error={errors.contactNumber?.message}><input className="input" inputMode="tel" placeholder="+91 98765 43210" {...register("contactNumber")} />{matchingCustomer && <span className="field-hint"><CheckCircle2 size={13} /> Existing customer: {matchingCustomer.name}</span>}</FormField><FormField label="Invoice date"><input className="input" type="date" {...register("invoiceDate")} /></FormField><FormField label="Invoice number" error={errors.invoiceNumber?.message ?? fieldErrors.invoiceNumber}><input className="input" maxLength={120} {...register("invoiceNumber")} /><span className="field-hint">Auto-generated; edit if needed.</span></FormField></div>
        </section>
        <section className="panel form-panel"><div className="form-section-head"><span className="step-number">02</span><div><h2>Products</h2><p>Add one or more devices to this sale.</p></div><Button variant="secondary" onClick={addProduct}><Plus size={15} /> Add product</Button></div>
          <div className="product-list">{products.map((product, index) => <div className="product-row" key={product.id}><div className="product-row-title"><span>Product {String(index + 1).padStart(2, "0")}</span>{products.length > 1 && <button className="remove-link" type="button" onClick={() => setProducts((items) => items.filter((item) => item.id !== product.id))}><X size={14} /> Remove</button>}</div><div className="form-grid product-fields"><FormField label="Brand"><input className="input" placeholder="Apple" value={product.brand} onChange={(event) => updateProduct(product.id, "brand", event.target.value)} /></FormField><FormField label="Model"><input className="input" placeholder="iPhone 15" value={product.model} onChange={(event) => updateProduct(product.id, "model", event.target.value)} /></FormField><FormField label="IMEI / Serial"><input className="input" placeholder="Optional" value={product.imei} onChange={(event) => updateProduct(product.id, "imei", event.target.value)} /></FormField><FormField label="Qty"><input className="input" type="number" min="1" value={product.quantity} onChange={(event) => updateProduct(product.id, "quantity", Number(event.target.value))} /></FormField><FormField label="Rate (₹)"><input className="input" type="number" min="0" value={product.rate || ""} placeholder="0" onChange={(event) => updateProduct(product.id, "rate", Number(event.target.value))} /></FormField><FormField label="Discount (₹)"><input className="input" type="number" min="0" value={product.discount || ""} placeholder="0" onChange={(event) => updateProduct(product.id, "discount", Number(event.target.value))} /></FormField><div className="line-total"><span>Line total</span><strong>{money(Math.max(0, product.quantity * product.rate - product.discount))}</strong></div></div></div>)}</div>
          {fieldErrors.products && <span className="field-error">{fieldErrors.products}</span>}
        </section>
        <section className="panel form-panel"><div className="form-section-head"><span className="step-number">03</span><div><h2>Payment details</h2><p>Record the amount received today.</p></div></div><div className="form-grid two-col"><FormField label="Amount paid (₹)" error={fieldErrors.amountPaid}><input className="input" type="number" min="0" value={paid || ""} placeholder="0" onChange={(event) => setPaid(Number(event.target.value))} /></FormField><FormField label="Tax (₹), optional"><input className="input" type="number" min="0" value={tax || ""} placeholder="0" onChange={(event) => setTax(Number(event.target.value))} /></FormField></div></section>
        <div className="form-footer"><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button variant="secondary" onClick={() => setPreview(true)}><FileText size={15} /> Preview invoice</Button><Button variant="secondary" onClick={() => void submitAndPrint()} disabled={busy}><Printer size={15} /> Save & print</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : <><Check size={16} /> Save sales bill</>}</Button></div>
      </div>
      <aside className="billing-side"><div className="panel total-card"><div className="total-card-title"><span className="total-icon"><CreditCard size={17} /></span><span><strong>Invoice summary</strong><small>Totals update as you go</small></span></div><div className="total-lines"><span>Subtotal <strong>{money(total)}</strong></span><span>Discount <strong>− {money(products.reduce((sum, item) => sum + item.discount, 0))}</strong></span><span>Tax <strong>{money(tax)}</strong></span><div className="total-final"><span>Amount due</span><strong>{money(final)}</strong></div><span>Paid today <strong>{money(paid)}</strong></span></div><div className={`balance-box ${final - paid > 0 ? "" : "settled"}`}><span>{final - paid > 0 ? "Balance due" : "Fully paid"}</span>{final - paid > 0 && <strong>{money(final - paid)}</strong>}</div></div><div className="billing-tip"><ShieldCheck size={16} /><span>IMEI and product details stay with this invoice for easy reference.</span></div></aside>
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

function ServiceForm({ customers, services, settings, busy, onSubmit, onCancel }: {
  customers: Customer[];
  services: ServiceJob[];
  settings: ShopSettings;
  busy: boolean; onSubmit: (draft: Omit<ServiceJob, "id" | "serviceNumber"> & { serviceNumber?: string }) => Promise<ServiceJob | undefined>; onCancel: () => void;
}) {
  const generatedServiceNumber = nextInvoiceNumber("services", settings.servicePrefix || "SRV", services);
  const [conditions, setConditions] = useState<string[]>([]);
  const [serviceNumber, setServiceNumber] = useState(generatedServiceNumber);
  const [amount, setAmount] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [formError, setFormError] = useState("");
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(serviceFormSchema),
    defaultValues: { customerName: "", contactNumber: "", inDate: dateInputValue(), brand: "", mobileModel: "", imei: "", reportedFault: "", technicianNotes: "", remarks: "", serviceAmount: 0, discount: 0 },
  });
  const final = Math.max(0, amount - discount);
  const toggleCondition = (condition: string) => setConditions((current) =>
    current.includes(condition) ? current.filter((item) => item !== condition) : [...current, condition]);
  const saveDraft = async (form: {
    customerName: string; contactNumber: string; inDate: string; brand: string; mobileModel: string;
    imei: string; reportedFault: string; technicianNotes: string; remarks: string;
  }, printAfterSave = false) => {
    setFormError("");
    const trimmedServiceNumber = serviceNumber.trim();
    if (!trimmedServiceNumber) { setFormError("Enter a service bill number."); return; }
    if (services.some((service) => service.serviceNumber === trimmedServiceNumber)) {
      setFormError("That service bill number is already in use.");
      return;
    }
    const parsed = serviceSchema.safeParse({ ...form, receivedConditions: conditions, serviceAmount: amount, discount });
    if (!parsed.success) { setFormError(parsed.error.issues[0]?.message ?? "Check the form details."); return; }
    const customer = customers.find((item) => item.phone.replace(/\D/g, "") === form.contactNumber.replace(/\D/g, ""));
    const saved = await onSubmit({
      customerId: customer?.id ?? "", customerName: form.customerName.trim(), contactNumber: form.contactNumber.trim(),
      inDate: businessDateTime(form.inDate), brand: form.brand.trim(), mobileModel: form.mobileModel.trim(),
      imei: form.imei.trim(), reportedFault: form.reportedFault.trim(), technicianNotes: form.technicianNotes.trim(),
      receivedConditions: conditions, remarks: form.remarks.trim(), status: "Received", serviceAmount: amount,
      discount, finalAmount: final, payments: [], createdAt: new Date().toISOString(),
      serviceNumber: trimmedServiceNumber === generatedServiceNumber ? undefined : trimmedServiceNumber,
    });
    if (saved && printAfterSave) printReceipt(saved, settings);
  };
  const submit = handleSubmit((form) => saveDraft(form));
  const submitAndPrint = handleSubmit((form) => saveDraft(form, true));
  return <>
    <PageHeader eyebrow="SERVICE DESK · NEW JOB" title="New service job" description="Record the device condition and repair request at intake."><Button variant="secondary" onClick={onCancel}><ArrowLeft size={15} /> Back to services</Button></PageHeader>
    <form className="billing-layout" onSubmit={submit} noValidate><div className="billing-main">
      <section className="panel form-panel"><div className="form-section-head"><span className="step-number">01</span><div><h2>Customer & intake</h2><p>Contact details and when the device arrived.</p></div></div><div className="form-grid two-col"><FormField label="Customer name" error={errors.customerName?.message}><input className="input" placeholder="e.g. Priya Sharma" {...register("customerName")} /></FormField><FormField label="Contact number" error={errors.contactNumber?.message}><input className="input" inputMode="tel" placeholder="+91 98765 43210" {...register("contactNumber")} /></FormField><FormField label="In date"><input className="input" type="date" {...register("inDate")} /></FormField><FormField label="Service bill number"><input className="input" required maxLength={120} value={serviceNumber} onChange={(event) => setServiceNumber(event.target.value)} /><span className="field-hint">Auto-generated; edit if needed.</span></FormField></div></section>
      <section className="panel form-panel"><div className="form-section-head"><span className="step-number">02</span><div><h2>Device details</h2><p>Identify the device and document its condition.</p></div></div><div className="form-grid two-col"><FormField label="Brand"><input className="input" placeholder="Samsung" {...register("brand")} /></FormField><FormField label="Model"><input className="input" placeholder="Galaxy S24" {...register("mobileModel")} /></FormField><FormField label="IMEI (optional)"><input className="input" placeholder="15-digit IMEI" {...register("imei")} /></FormField><FormField label="Reported fault" error={errors.reportedFault?.message}><input className="input" required placeholder="Describe the issue" {...register("reportedFault")} /></FormField></div><div className="condition-label">Received condition <span>Select all that apply</span></div><div className="condition-list">{CONDITIONS.map((condition) => <label key={condition} className={`condition-chip ${conditions.includes(condition) ? "checked" : ""}`}><input type="checkbox" checked={conditions.includes(condition)} onChange={() => toggleCondition(condition)} /><span>{conditions.includes(condition) && <Check size={12} />}</span>{condition}</label>)}</div><div className="form-grid two-col textareas"><FormField label="Technician notes"><textarea className="input textarea" placeholder="Notes for the repair team" {...register("technicianNotes")} /></FormField><FormField label="Additional remarks"><textarea className="input textarea" placeholder="Any other details about intake" {...register("remarks")} /></FormField></div><div className="credential-notice"><ShieldCheck size={16} /><span><strong>Device passwords and patterns are not collected.</strong> Please never record unlock credentials here or on the printed receipt.</span></div></section>
      <section className="panel form-panel"><div className="form-section-head"><span className="step-number">03</span><div><h2>Service charge</h2><p>Enter the service charge and any discount.</p></div></div><div className="form-grid two-col"><FormField label="Service charge (₹)"><input className="input" type="number" min="0" value={amount || ""} placeholder="0" onChange={(event) => setAmount(Number(event.target.value))} /></FormField><FormField label="Discount (₹)"><input className="input" type="number" min="0" value={discount || ""} placeholder="0" onChange={(event) => setDiscount(Number(event.target.value))} /></FormField></div></section>
      {formError && <div className="form-alert">{formError}</div>}<div className="form-footer"><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button variant="secondary" onClick={() => void submitAndPrint()} disabled={busy}><Printer size={15} /> Save & print</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : <><Check size={16} /> Save service job</>}</Button></div>
    </div><aside className="billing-side"><div className="panel total-card"><div className="total-card-title"><span className="total-icon amber-icon"><Wrench size={17} /></span><span><strong>Service estimate</strong><small>Update as work progresses</small></span></div><div className="total-lines"><span>Service charge <strong>{money(amount)}</strong></span><span>Discount <strong>− {money(discount)}</strong></span><div className="total-final"><span>Amount due</span><strong>{money(final)}</strong></div></div><div className="balance-box"><span>Balance</span><strong>{money(final)}</strong></div></div><div className="billing-tip"><Clock3 size={16} /><span>Service status starts as Received. Move it to Ready when repairs are complete.</span></div></aside></form>
  </>;
}

function ServicesPage({ services, search, onSearch, onCreate, onView, onPayment, onUpdate, canEdit }: {
  services: ServiceJob[]; search: string; onSearch: (value: string) => void; onCreate: () => void;
  onView: (id: string) => void; onPayment: (id: string) => void; onUpdate: (service: ServiceJob) => void; canEdit: boolean;
}) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [paymentFilter, setPaymentFilter] = useState("All payments");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortBy, setSortBy] = useState("date-desc");
  const [page, setPage] = useState(1);
  const filtered = services.filter((service) => (!search || `${service.serviceNumber} ${service.customerName} ${service.contactNumber} ${service.brand} ${service.mobileModel} ${service.imei}`.toLowerCase().includes(search.toLowerCase()))
    && (statusFilter === "All statuses" || service.status === statusFilter)
    && (paymentFilter === "All payments" || statusOf(service.finalAmount, paymentTotal(service.payments)) === paymentFilter)
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
      { title: "SERVICE BILL NO.", width: 28 },
      { title: "IN DATE", width: 22 },
      { title: "IN CUSTOMER NAME", width: 34 },
      { title: "MOBILE WITH MODEL", width: 37 },
      { title: "CUSTOMER NUMBER", width: 28 },
      { title: "STATUS", width: 23 },
      { title: "DELIVERY DATE", width: 23 },
      { title: "DELIVERY CUSTOMER", width: 36 },
      { title: "SERVICE CHARGE", width: 28 },
    ];
    const orderedServices = filtered;
    const serviceTotal = orderedServices.reduce((sum, service) => sum + service.serviceAmount, 0);
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
        `${service.brand} ${service.mobileModel}`.trim(),
        service.contactNumber,
        service.status,
        service.deliveryOutDate ? dateLabel(service.deliveryOutDate) : "—",
        service.deliveryOutPerson || "—",
        pdfMoney(service.serviceAmount),
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
    pdf.save(`service-report-${dateInputValue()}.pdf`);
  };
  return <>
    <PageHeader eyebrow="REPAIR & CARE" title="Service desk" description="Track every repair from intake to handover."><Button variant="secondary" onClick={exportServicesPdf}><Download size={15} /> Export PDF</Button><Button variant="secondary" onClick={() => router.push("/services/ready")}><CheckCircle2 size={15} /> Ready for pickup</Button>{canEdit && <Button onClick={onCreate}><Plus size={16} /> New service job</Button>}</PageHeader>
    <div className="service-kpis">{(["Received", "In progress", "Ready", "Returned"] as ServiceStatus[]).map((status) => <div className="service-kpi" key={status}><span className={`status-dot ${statusClass(status)}`} /><span>{status}</span><strong>{services.filter((item) => item.status === status).length}</strong></div>)}</div>
    <div className="panel table-panel"><div className="table-toolbar"><label className="table-search"><Search size={16} /><input value={search} onChange={(event) => { onSearch(event.target.value); setPage(1); }} placeholder="Search bill, customer, model or IMEI…" /></label><div className="table-filters"><label className="select-wrap"><Filter size={15} /><select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}><option>All statuses</option>{(["Received", "In progress", "Ready", "Returned"] as ServiceStatus[]).map((status) => <option key={status}>{status}</option>)}</select><ChevronDown size={14} /></label><label className="select-wrap"><select value={paymentFilter} onChange={(event) => { setPaymentFilter(event.target.value); setPage(1); }}><option>All payments</option><option>Paid</option><option>Partially paid</option><option>Unpaid</option></select><ChevronDown size={14} /></label><div className="date-range compact-date-range"><label>From<input aria-label="Services from date" className="input date-filter" type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} /></label><label>To<input aria-label="Services to date" className="input date-filter" type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} /></label></div><label className="select-wrap"><span>Sort</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value)}><option value="date-desc">Newest</option><option value="date-asc">Oldest</option><option value="amount-desc">Highest total</option><option value="amount-asc">Lowest total</option></select><ChevronDown size={14} /></label></div></div>
      {filtered.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>SERVICE BILL NO.</th><th>IN DATE</th><th>IN CUSTOMER NAME</th><th>MOBILE WITH MODEL</th><th>CUSTOMER NUMBER</th><th>STATUS</th><th>DELIVERY DATE</th><th>DELIVERY CUSTOMER</th><th>SERVICE CHARGE</th><th /></tr></thead><tbody>{filtered.slice((page - 1) * pageSize, page * pageSize).map((job) => {
        const due = Math.max(0, job.serviceAmount - job.discount - paymentTotal(job.payments));
        return <tr key={job.id}><td><button className="table-primary-link" onClick={() => onView(job.id)}>{job.serviceNumber}</button></td><td><span className="muted-cell">{dateLabel(job.inDate)}</span></td><td><strong>{job.customerName}</strong></td><td><strong>{job.brand} {job.mobileModel}</strong></td><td>{job.contactNumber}</td><td><select className={`status-select status-${statusClass(job.status)}`} value={job.status} disabled={!canEdit || job.status === "Returned"} aria-label={`Update status for ${job.serviceNumber}`} onChange={(event) => onUpdate({ ...job, status: event.target.value as ServiceStatus, readyAt: event.target.value === "Ready" ? new Date().toISOString() : job.readyAt })}>{(["Received", "In progress", "Ready", "Returned"] as ServiceStatus[]).map((status) => <option key={status}>{status}</option>)}</select></td><td><span className="muted-cell">{job.deliveryOutDate ? dateLabel(job.deliveryOutDate) : "—"}</span></td><td>{job.deliveryOutPerson || "—"}</td><td><strong>{money(job.serviceAmount)}</strong></td><td><button className="row-action" aria-label="View service details" onClick={() => onView(job.id)}><ArrowRight size={15} /></button>{canEdit && due > 0 && <button className="row-action" aria-label="Record service payment" onClick={() => onPayment(job.id)}><Plus size={15} /></button>}</td></tr>;
      })}</tbody></table></div> : <EmptyState icon={Wrench} title={services.length ? "No matching service jobs" : "Ready for your first repair?"} detail={services.length ? "Try another search or status." : "Create a service job to track a device from intake to pickup."} action={!services.length && canEdit ? <Button onClick={onCreate}><Plus size={15} /> New service job</Button> : undefined} />}
      {filtered.length > 0 && <Pagination page={page} pages={pages} total={filtered.length} pageSize={pageSize} onPage={setPage} />}
    </div>
  </>;
}

function ReadyPage({ services, onView, onPayment, onReturn, canEditPayment, canReturn, canViewAllServices }: {
  services: ServiceJob[]; onView: (id: string) => void; onPayment: (id: string) => void;
  onReturn: (service: ServiceJob) => void; canEditPayment: boolean; canReturn: boolean; canViewAllServices: boolean;
}) {
  const router = useRouter();
  const readyJobs = services.filter((service) => service.status === "Ready").sort((a, b) => (b.readyAt ?? "").localeCompare(a.readyAt ?? ""));
  return <>
    <PageHeader eyebrow="SERVICE DESK · HANDOVER" title="Ready for delivery" description="The finishing touch: get these repaired devices back to their owners.">{canViewAllServices && <Button variant="secondary" onClick={() => router.push("/services")}><Wrench size={15} /> All service jobs</Button>}</PageHeader>
    <div className="delivery-summary"><span className="delivery-summary-icon"><CheckCircle2 size={18} /></span><div><strong>{readyJobs.length} {readyJobs.length === 1 ? "device is" : "devices are"} ready</strong><span>Collect any remaining balance before handover.</span></div><strong className="delivery-total">{money(readyJobs.reduce((sum, item) => sum + Math.max(0, item.serviceAmount - item.discount - paymentTotal(item.payments)), 0))}<small>total balance</small></strong></div>
    {readyJobs.length ? <div className="ready-grid">{readyJobs.map((job) => {
      const due = Math.max(0, job.serviceAmount - job.discount - paymentTotal(job.payments));
      return <article className="ready-card" key={job.id}><div className="ready-card-top"><span className="ready-device-icon"><Smartphone size={20} /></span><StatusBadge status="Ready" /><button className="more-btn" aria-label="More actions" onClick={() => onView(job.id)}><MoreHorizontal size={18} /></button></div><div className="ready-card-id">{job.serviceNumber}</div><h2>{job.brand} {job.mobileModel}</h2><p>{job.reportedFault}</p><div className="ready-customer"><span className="mini-avatar amber-avatar">{job.customerName[0]?.toUpperCase() || "?"}</span><span><strong>{job.customerName}</strong><small>{job.contactNumber}</small></span></div><div className="ready-card-meta"><span>Ready since <strong>{dateLabel(job.readyAt ?? job.inDate)}</strong></span><span>Balance <strong className={due ? "balance-due" : "balance-paid"}>{money(due)}</strong></span></div>{(canEditPayment || canReturn) && <div className="ready-card-actions">{canEditPayment && due > 0 && <Button variant="secondary" onClick={() => onPayment(job.id)}><CreditCard size={14} /> Collect payment</Button>}{canReturn && <Button onClick={() => onReturn(job)}><Check size={15} /> Mark returned</Button>}</div>}</article>;
    })}</div> : <div className="panel"><EmptyState icon={CheckCircle2} title="Nothing waiting for pickup" detail="When a service job is marked Ready, you’ll find it here." action={canViewAllServices ? <Button variant="secondary" onClick={() => router.push("/services")}><Wrench size={15} /> View service jobs</Button> : undefined} /></div>}
  </>;
}

function ServiceDetail({ service, settings, onBack, onPayment, onUpdate, canEdit }: {
  service?: ServiceJob; settings: ShopSettings; onBack: () => void; onPayment: (id: string) => void; onUpdate: (service: ServiceJob) => void; canEdit: boolean;
}) {
  if (!service) return <NotFound title="Service job not found" backLabel="Back to services" onBack={onBack} />;
  const due = Math.max(0, service.serviceAmount - service.discount - paymentTotal(service.payments));
  return <>
    <PageHeader eyebrow="SERVICE JOB" title={service.serviceNumber} description={`${service.brand} ${service.mobileModel} · Received ${dateLabel(service.inDate)}`}><Button variant="secondary" onClick={onBack}><ArrowLeft size={15} /> All services</Button><Button variant="secondary" onClick={() => downloadServiceReceipt(service, settings)}><Download size={15} /> Download PDF</Button><Button variant="secondary" onClick={() => printReceipt(service, settings)}><Printer size={15} /> Print receipt</Button></PageHeader>
    <div className="detail-grid"><div className="detail-main">
      <section className="panel detail-panel"><div className="panel-heading"><div><h2>Repair status</h2><p>Track the job from intake through handover.</p></div><select className={`status-select status-${statusClass(service.status)}`} value={service.status} disabled={!canEdit || service.status === "Returned"} onChange={(event) => onUpdate({ ...service, status: event.target.value as ServiceStatus, readyAt: event.target.value === "Ready" ? new Date().toISOString() : service.readyAt, deliveryOutDate: event.target.value === "Returned" ? new Date().toISOString() : service.deliveryOutDate })}>{(["Received", "In progress", "Ready", "Returned"] as ServiceStatus[]).map((status) => <option key={status}>{status}</option>)}</select></div><div className="status-timeline">{(["Received", "In progress", "Ready", "Returned"] as ServiceStatus[]).map((status, index) => { const completed = (["Received", "In progress", "Ready", "Returned"] as string[]).indexOf(service.status) >= index; return <div className={`timeline-step ${completed ? "done" : ""}`} key={status}><span>{completed ? <Check size={13} /> : index + 1}</span><strong>{status}</strong>{index < 3 && <i />}</div>; })}</div></section>
      <section className="panel detail-panel"><div className="panel-heading"><div><h2>Device & issue</h2><p>What came in, and what needs attention.</p></div></div><div className="detail-fields"><DetailField label="Customer" value={service.customerName} /><DetailField label="Contact number" value={service.contactNumber} /><DetailField label="Device" value={`${service.brand} ${service.mobileModel}`} /><DetailField label="IMEI" value={service.imei || "Not recorded"} /><DetailField label="Reported fault" value={service.reportedFault} /><DetailField label="Received condition" value={service.receivedConditions.join(", ") || "Not specified"} /><DetailField label="Technician notes" value={service.technicianNotes || "—"} /><DetailField label="Additional remarks" value={service.remarks || "—"} /></div><div className="credential-notice"><ShieldCheck size={16} /><span>Device unlock credentials are not collected or shown on this job record.</span></div></section>
      <section className="panel detail-panel"><div className="panel-heading"><div><h2>Payment history</h2><p>Payments are recorded as separate entries.</p></div>{canEdit && due > 0 && <Button variant="secondary" onClick={() => onPayment(service.id)}><Plus size={14} /> Add payment</Button>}</div>{service.payments.length ? <div className="payment-history">{service.payments.map((payment) => <div className="payment-row" key={payment.id}><span className="payment-method-icon"><CreditCard size={15} /></span><span><strong>Amount received</strong><small>{dateLabel(payment.date)}{payment.notes ? ` · ${payment.notes}` : ""}</small></span><strong className="paid-amount">{money(payment.amount)}</strong></div>)}</div> : <div className="quiet-empty">No payments recorded yet.</div>}</section>
      {(service.deliveryHistory?.length ?? 0) > 0 && <section className="panel detail-panel"><div className="panel-heading"><div><h2>Delivery history</h2><p>Recorded handovers for this device.</p></div></div><div className="payment-history">{service.deliveryHistory?.slice().reverse().map((entry, index) => <div className="payment-row" key={`${entry.date}-${index}`}><span className="payment-method-icon"><CheckCircle2 size={15} /></span><span><strong>Handed over to customer</strong><small>{dateLabel(entry.date)} · Picked up by {entry.person}{entry.staff ? ` · Returned by ${entry.staff}` : ""}{entry.remarks ? ` · ${entry.remarks}` : ""}</small></span></div>)}</div></section>}
    </div><aside className="detail-aside"><div className="panel total-card"><div className="total-card-title"><span className="total-icon amber-icon"><Wrench size={17} /></span><span><strong>Service balance</strong><small>{service.status}</small></span></div><div className="total-lines"><span>Service amount <strong>{money(service.serviceAmount)}</strong></span><span>Discount <strong>− {money(service.discount)}</strong></span><span>Amount paid <strong>{money(paymentTotal(service.payments))}</strong></span><div className="total-final"><span>Balance due</span><strong>{money(due)}</strong></div></div>{canEdit && due > 0 && <Button className="btn-full" onClick={() => onPayment(service.id)}><CreditCard size={15} /> Record payment</Button>}</div>{service.deliveryOutDate && <div className="panel delivery-note"><CheckCircle2 size={17} /><strong>Device returned</strong><span>{dateLabel(service.deliveryOutDate)}{service.deliveryOutPerson ? ` · Picked up by ${service.deliveryOutPerson}` : ""}{service.deliveryOutStaff ? ` · Returned by ${service.deliveryOutStaff}` : ""}</span>{service.deliveryRemarks && <small>{service.deliveryRemarks}</small>}</div>}</aside></div>
  </>;
}

function SaleDetail({ sale, settings, onBack, onPayment, canEdit }: {
  sale?: Sale; settings: ShopSettings; onBack: () => void; onPayment: (id: string) => void; canEdit: boolean;
}) {
  if (!sale) return <NotFound title="Invoice not found" backLabel="Back to sales" onBack={onBack} />;
  const paid = paymentTotal(sale.payments);
  const due = Math.max(0, sale.finalAmount - paid);
  return <>
    <PageHeader eyebrow="SALES INVOICE" title={sale.invoiceNumber} description={`${sale.customerName} · ${dateLabel(sale.invoiceDate)}`}><Button variant="secondary" onClick={onBack}><ArrowLeft size={15} /> Sales history</Button><Button variant="secondary" onClick={() => downloadInvoice(sale, settings)}><Download size={15} /> Download PDF</Button><Button onClick={() => printInvoice(sale, settings)}><Printer size={15} /> Print invoice</Button></PageHeader>
    <div className="detail-grid"><div className="detail-main"><InvoicePreview sale={sale} settings={settings} /><section className="panel detail-panel"><div className="panel-heading"><div><h2>Payment history</h2><p>Every payment is listed separately.</p></div>{canEdit && due > 0 && <Button variant="secondary" onClick={() => onPayment(sale.id)}><Plus size={14} /> Add payment</Button>}</div>{sale.payments.length ? <div className="payment-history">{sale.payments.map((payment) => <div className="payment-row" key={payment.id}><span className="payment-method-icon"><CreditCard size={15} /></span><span><strong>Amount received</strong><small>{dateLabel(payment.date)}{payment.notes ? ` · ${payment.notes}` : ""}</small></span><strong className="paid-amount">{money(payment.amount)}</strong></div>)}</div> : <div className="quiet-empty">No payments recorded yet.</div>}</section></div><aside className="detail-aside"><div className="panel total-card"><div className="total-card-title"><span className="total-icon"><CreditCard size={17} /></span><span><strong>Payment summary</strong><small>{statusOf(sale.finalAmount, paid)}</small></span></div><div className="total-lines"><span>Subtotal <strong>{money(sale.subtotal)}</strong></span><span>Discount <strong>− {money(sale.discount)}</strong></span><span>Tax <strong>{money(sale.tax)}</strong></span><div className="total-final"><span>Invoice total</span><strong>{money(sale.finalAmount)}</strong></div><span>Paid <strong>{money(paid)}</strong></span></div><div className={`balance-box ${due <= 0 ? "settled" : ""}`}><span>Balance due</span><strong>{money(due)}</strong></div>{canEdit && due > 0 && <Button className="btn-full" onClick={() => onPayment(sale.id)}><CreditCard size={15} /> Record payment</Button>}</div></aside></div>
  </>;
}

function InvoicePreview({ sale, settings }: { sale: Sale; settings: ShopSettings }) {
  return <div className="panel invoice-sheet">
    <div className="invoice-brand">
      <div className="invoice-brand-info">
        {settings.logoDataUrl && <div className="invoice-logo" role="img" aria-label="Shop logo" style={{ backgroundImage: `url("${settings.logoDataUrl}")` }} />}
        <div className="invoice-shop-info"><strong>{settings.shopName}</strong><span>{settings.address || "Shop address not set"}</span><span>{settings.phone || "Contact number not set"}</span>{settings.gstin && <span>GSTIN: {settings.gstin}</span>}</div>
      </div>
      <div className="invoice-label"><strong>INVOICE</strong><span>{sale.invoiceNumber}</span><small>{dateLabel(sale.invoiceDate)}</small></div>
    </div>
    <div className="invoice-customer"><span>BILLED TO</span><strong>{sale.customerName}</strong><small>{sale.contactNumber}</small></div>
    <div className="table-scroll"><table className="invoice-table"><thead><tr><th>ITEM</th><th>IMEI / SERIAL</th><th>QTY</th><th>RATE</th><th>DISCOUNT</th><th>AMOUNT</th></tr></thead><tbody>{sale.products.map((product) => <tr key={product.id}><td><strong>{product.brand} {product.model}</strong></td><td>{product.imei || "—"}</td><td>{product.quantity}</td><td>{money(product.rate)}</td><td>{money(product.discount)}</td><td><strong>{money(product.quantity * product.rate - product.discount)}</strong></td></tr>)}</tbody></table></div>
    <div className="invoice-totals"><span>Subtotal <strong>{money(sale.subtotal)}</strong></span><span>Discount <strong>− {money(sale.discount)}</strong></span><span>Tax <strong>{money(sale.tax)}</strong></span><span className="invoice-grand">Invoice total <strong>{money(sale.finalAmount)}</strong></span><span>Paid <strong>{money(paymentTotal(sale.payments))}</strong></span><span>Balance due <strong>{money(Math.max(0, sale.finalAmount - paymentTotal(sale.payments)))}</strong></span></div>
    <div className="invoice-footer-note">{settings.invoiceFooter}</div><div className="invoice-signatures"><span>Customer signature</span><span>Authorized signature</span></div>
  </div>;
}

function downloadInvoice(sale: Sale, settings: ShopSettings) {
  const pdf = new jsPDF();
  const shopTextX = settings.logoDataUrl ? 38 : 16;
  if (settings.logoDataUrl) {
    const format = settings.logoDataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
    pdf.addImage(settings.logoDataUrl, format, 16, 12, 16, 16);
  }
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(18); pdf.text(settings.shopName || "Mobile Shop", shopTextX, 20);
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(9);
  if (settings.address) pdf.text(settings.address, shopTextX, 27);
  if (settings.phone) pdf.text(`Phone: ${settings.phone}`, shopTextX, 32);
  if (settings.gstin) pdf.text(`GSTIN: ${settings.gstin}`, shopTextX, 37);
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(14); pdf.text("SALES INVOICE", 194, 20, { align: "right" });
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(10); pdf.text(sale.invoiceNumber, 194, 27, { align: "right" }); pdf.text(dateLabel(sale.invoiceDate), 194, 33, { align: "right" });
  pdf.setDrawColor(225, 230, 238); pdf.line(16, 43, 194, 43);
  pdf.setFont("helvetica", "bold"); pdf.text("BILLED TO", 16, 53); pdf.setFont("helvetica", "normal"); pdf.text(sale.customerName, 16, 60); pdf.text(sale.contactNumber, 16, 66);
  let y = 81;
  pdf.setFillColor(245, 247, 251); pdf.rect(16, y - 6, 178, 10, "F");
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(8); pdf.text("ITEM", 18, y); pdf.text("IMEI", 92, y); pdf.text("QTY", 135, y); pdf.text("RATE", 151, y); pdf.text("TOTAL", 192, y, { align: "right" });
  y += 11; pdf.setFont("helvetica", "normal"); pdf.setFontSize(8.5);
  sale.products.forEach((product) => {
    if (y > 250) { pdf.addPage(); y = 22; }
    pdf.text(`${product.brand} ${product.model}`.slice(0, 38), 18, y);
    pdf.text(product.imei || "—", 92, y);
    pdf.text(String(product.quantity), 137, y);
    pdf.text(pdfMoney(product.rate), 151, y);
    pdf.text(pdfMoney(product.quantity * product.rate - product.discount), 192, y, { align: "right" });
    y += 9;
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
    ? `<tr><td>${escapeHtml(`${item.brand} ${item.model}`)}<small>IMEI: ${escapeHtml(item.imei || "—")}</small></td><td>${item.quantity}</td><td>${money(item.quantity * item.rate - item.discount)}</td></tr>`
    : `<tr><td>${escapeHtml(`${item.brand} ${item.model}`)}</td><td>${escapeHtml(item.imei || "—")}</td><td>${item.quantity}</td><td>${money(item.rate)}</td><td>${money(item.discount)}</td><td>${money(item.quantity * item.rate - item.discount)}</td></tr>`).join("");
  const headers = thermal
    ? "<th>PRODUCT</th><th>QTY</th><th>TOTAL</th>"
    : "<th>PRODUCT</th><th>IMEI</th><th>QTY</th><th>RATE</th><th>DISCOUNT</th><th>TOTAL</th>";
  const pageSize = thermal ? "80mm auto;margin:5mm" : "A4;margin:16mm";
  const bodyLayout = thermal ? "body{width:70mm;padding:0}.head{gap:8px}.head h2{font-size:16px}table{margin:18px 0}th,td{padding:5px 2px;font-size:10px}aside{width:100%}.sign{margin-top:42px}" : "body{padding:32px}.head{padding-bottom:18px}table{margin:28px 0}th,td{padding:10px 6px}aside{margin-left:auto;width:260px}.sign{margin-top:64px}";
  const logo = settings.logoDataUrl ? `<img class="shop-logo" src="${escapeHtml(settings.logoDataUrl)}" alt="">` : "";
  const gstin = settings.gstin ? `<div class="muted">GSTIN: ${escapeHtml(settings.gstin)}</div>` : "";
  popup.document.write(`<html><head><title>${escapeHtml(sale.invoiceNumber)}</title><style>body{font:13px Arial;color:#111}.head{display:flex;justify-content:space-between;border-bottom:1px solid #ddd}.shop{display:flex;align-items:flex-start;gap:8px}.shop-logo{width:40px;height:40px;object-fit:contain}.muted{color:#666;font-size:12px}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid #ddd}th{font-size:10px;color:#666}aside p{display:flex;justify-content:space-between}.total{font-weight:bold;border-top:1px solid #bbb;padding-top:10px}.sign{display:flex;justify-content:space-between}small{display:block;color:#777;margin-top:7px}@media print{@page{size:${pageSize}}${bodyLayout}}</style></head><body><div class="head"><div class="shop">${logo}<div><h2>${escapeHtml(settings.shopName)}</h2><div class="muted">${escapeHtml(settings.address)}</div><div class="muted">${escapeHtml(settings.phone)}</div>${gstin}</div></div><div><h2>INVOICE</h2><strong>${escapeHtml(sale.invoiceNumber)}</strong><small>${dateLabel(sale.invoiceDate)}</small></div></div><p><strong>${escapeHtml(sale.customerName)}</strong><br>${escapeHtml(sale.contactNumber)}</p><table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table><aside><p>Subtotal <strong>${money(sale.subtotal)}</strong></p><p>Discount <strong>− ${money(sale.discount)}</strong></p><p>Tax <strong>${money(sale.tax)}</strong></p><p class="total">Total <strong>${money(sale.finalAmount)}</strong></p><p>Paid <strong>${money(paymentTotal(sale.payments))}</strong></p><p>Balance <strong>${money(Math.max(0, sale.finalAmount - paymentTotal(sale.payments)))}</strong></p></aside><p>${escapeHtml(settings.invoiceFooter)}</p><div class="sign"><span>Customer signature</span><span>Authorized signature</span></div><script>window.onload=()=>window.print()</script></body></html>`);
  popup.document.close();
}

function printReceipt(service: ServiceJob, settings: ShopSettings) {
  const popup = window.open("", "_blank", "width=500,height=720");
  if (!popup) { window.alert("Please allow pop-ups to print this receipt."); return; }
  popup.document.write(`<html><head><title>${escapeHtml(service.serviceNumber)}</title><style>body{font:13px Arial;padding:24px;color:#111}h2{margin-bottom:4px}p{line-height:1.55}.line{border-top:1px dashed #888;margin:18px 0}.sign{margin-top:42px}@media print{@page{size:80mm auto;margin:5mm}}</style></head><body><h2>${escapeHtml(settings.shopName)}</h2><p>${escapeHtml(settings.address)}<br>${escapeHtml(settings.phone)}<br>Service receipt · ${escapeHtml(service.serviceNumber)}<br>In date: ${dateLabel(service.inDate)}</p><div class="line"></div><p><strong>${escapeHtml(service.customerName)}</strong><br>${escapeHtml(service.contactNumber)}<br>${escapeHtml(`${service.brand} ${service.mobileModel}`)}<br>IMEI: ${escapeHtml(service.imei || "—")}</p><p>Reported fault: ${escapeHtml(service.reportedFault)}<br>Condition: ${escapeHtml(service.receivedConditions.join(", "))}</p><div class="line"></div><p>Estimate: ${money(service.serviceAmount - service.discount)}<br>Advance: ${money(paymentTotal(service.payments))}<br>Balance: ${money(Math.max(0, service.serviceAmount - service.discount - paymentTotal(service.payments)))}</p><p>Device passwords and patterns are never printed.</p><p class="sign">Customer acknowledgment __________________</p><script>window.onload=()=>window.print()</script></body></html>`);
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

function downloadServiceReceipt(service: ServiceJob, settings: ShopSettings) {
  const pdf = new jsPDF({ unit: "mm", format: [80, 190] });
  pdf.setFontSize(15); pdf.setFont("helvetica", "bold"); pdf.text(settings.shopName || "Mobile Shop", 7, 12);
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.text(`Service receipt · ${service.serviceNumber}`, 7, 20);
  let y = 26;
  pdf.setFontSize(8);
  if (settings.address) { pdf.text(settings.address.slice(0, 72), 7, y); y += 5; }
  if (settings.phone) { pdf.text(settings.phone, 7, y); y += 5; }
  pdf.text(`In date: ${dateLabel(service.inDate)}`, 7, y); y += 5; pdf.line(7, y, 73, y); y += 8;
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(9); pdf.text(service.customerName.slice(0, 35), 7, y); y += 6;
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.text(service.contactNumber, 7, y); y += 6;
  pdf.text(`${service.brand} ${service.mobileModel}`.slice(0, 34), 7, y); y += 6; pdf.text(`IMEI: ${service.imei || "—"}`, 7, y); y += 8;
  pdf.text(`Fault: ${service.reportedFault}`.slice(0, 70), 7, y); y += 7;
  pdf.text(`Condition: ${service.receivedConditions.join(", ")}`.slice(0, 70), 7, y); y += 7; pdf.line(7, y, 73, y); y += 8;
  pdf.text(`Estimate: ${pdfMoney(service.serviceAmount - service.discount)}`, 7, y); y += 6;
  pdf.text(`Advance: ${pdfMoney(paymentTotal(service.payments))}`, 7, y); y += 6;
  pdf.text(`Balance: ${pdfMoney(Math.max(0, service.serviceAmount - service.discount - paymentTotal(service.payments)))}`, 7, y); y += 12;
  pdf.setFontSize(7); pdf.text("Device passwords and patterns are never printed.", 7, y);
  pdf.save(`${service.serviceNumber}.pdf`);
}

function CustomersPage({ customers, sales, services, search, onSearch, onAdd, selectedId, onView, onEdit }: {
  customers: Customer[]; sales: Sale[]; services: ServiceJob[]; search: string; onSearch: (value: string) => void;
  onAdd: () => void; selectedId: string; onView: (id: string) => void; onEdit: (customer: Customer) => void;
}) {
  if (selectedId) {
    const customer = customers.find((item) => item.id === selectedId);
    if (!customer) return <NotFound title="Customer not found" backLabel="Back to customers" onBack={() => onView("")} />;
    const customerSales = sales.filter((sale) => sale.customerId === customer.id);
    const customerServices = services.filter((service) => service.customerId === customer.id)
      .sort((a, b) => (b.createdAt || b.inDate).localeCompare(a.createdAt || a.inDate));
    const outstanding = customerSales.reduce((sum, sale) => sum + Math.max(0, sale.finalAmount - paymentTotal(sale.payments)), 0)
      + customerServices.reduce((sum, service) => sum + Math.max(0, service.serviceAmount - service.discount - paymentTotal(service.payments)), 0);
    const paymentHistory = [
      ...customerSales.flatMap((sale) => sale.payments.map((payment) => ({ ...payment, reference: sale.invoiceNumber }))),
      ...customerServices.flatMap((service) => service.payments.map((payment) => ({ ...payment, reference: service.serviceNumber }))),
    ].sort((a, b) => b.date.localeCompare(a.date));
    return <><PageHeader eyebrow="CUSTOMER PROFILE" title={customer.name} description={`Customer since ${dateLabel(customer.createdAt)}`}><Button variant="secondary" onClick={() => onEdit(customer)}><Pencil size={14} /> Edit customer</Button><Button variant="secondary" onClick={() => onView("")}><ArrowLeft size={15} /> All customers</Button></PageHeader><div className="customer-profile-head"><span className="customer-profile-avatar">{customer.name[0]?.toUpperCase()}</span><div><h2>{customer.name}</h2><span>{customer.phone}{customer.email ? ` · ${customer.email}` : ""}</span></div><div className="customer-profile-stats"><span>Sales<strong>{customerSales.length}</strong></span><span>Service jobs<strong>{customerServices.length}</strong></span><span>Outstanding<strong>{money(outstanding)}</strong></span></div></div><div className="panel table-panel"><div className="panel-heading"><div><h2>Sales history</h2><p>Invoices connected to this customer.</p></div></div>{customerSales.length ? <SalesTable sales={customerSales} /> : <div className="quiet-empty">No sales recorded for this customer.</div>}</div><div className="panel table-panel customer-services"><div className="panel-heading"><div><h2>Service history</h2><p>Repair jobs connected to this customer.</p></div></div>{customerServices.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>SERVICE BILL</th><th>DEVICE</th><th>REPORTED FAULT</th><th>STATUS</th><th>DATE</th></tr></thead><tbody>{customerServices.map((service) => <tr key={service.id}><td>{service.serviceNumber}</td><td>{service.brand} {service.mobileModel}</td><td>{service.reportedFault}</td><td><StatusBadge status={service.status} /></td><td>{dateLabel(service.inDate)}</td></tr>)}</tbody></table></div> : <div className="quiet-empty">No service jobs recorded for this customer.</div>}</div><div className="panel table-panel customer-services"><div className="panel-heading"><div><h2>Payment history</h2><p>All recorded payments across this customer&apos;s invoices.</p></div></div>{paymentHistory.length ? <div className="payment-history">{paymentHistory.map((payment) => <div className="payment-row" key={payment.id}><span className="payment-method-icon"><CreditCard size={15} /></span><span><strong>{payment.reference}</strong><small>{dateLabel(payment.date)}{payment.notes ? ` · ${payment.notes}` : ""}</small></span><strong className="paid-amount">{money(payment.amount)}</strong></div>)}</div> : <div className="quiet-empty">No payments recorded for this customer.</div>}</div></>;
  }
  const filtered = customers.filter((customer) => !search || `${customer.name} ${customer.phone} ${customer.email}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    <PageHeader eyebrow="PEOPLE & RELATIONSHIPS" title="Customers" description="A single place for the people behind every sale and service."><Button onClick={onAdd}><Plus size={16} /> Add customer</Button></PageHeader>
    <div className="customer-metrics"><div className="panel mini-metric"><span className="metric-icon blue"><Users size={17} /></span><span>Total customers<strong>{customers.length}</strong></span></div><div className="panel mini-metric"><span className="metric-icon green"><CreditCard size={17} /></span><span>Sales recorded<strong>{sales.length}</strong></span></div><div className="panel mini-metric"><span className="metric-icon amber"><Wrench size={17} /></span><span>Service jobs<strong>{services.length}</strong></span></div></div>
    <div className="panel table-panel"><div className="table-toolbar"><label className="table-search"><Search size={16} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search name, phone or email…" /></label><span className="table-results">{filtered.length} customers</span></div>{filtered.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>CUSTOMER</th><th>CONTACT</th><th>SALES</th><th>SERVICE JOBS</th><th>SPEND</th><th>OUTSTANDING</th><th /></tr></thead><tbody>{filtered.map((customer) => {
      const ownSales = sales.filter((sale) => sale.customerId === customer.id);
      const ownServices = services.filter((service) => service.customerId === customer.id);
      const spend = ownSales.reduce((sum, sale) => sum + sale.finalAmount, 0) + ownServices.reduce((sum, service) => sum + service.serviceAmount - service.discount, 0);
      const due = ownSales.reduce((sum, sale) => sum + Math.max(0, sale.finalAmount - paymentTotal(sale.payments)), 0) + ownServices.reduce((sum, service) => sum + Math.max(0, service.serviceAmount - service.discount - paymentTotal(service.payments)), 0);
      return <tr key={customer.id}><td><span className="customer-cell"><span className="mini-avatar">{customer.name[0]?.toUpperCase()}</span><span><strong>{customer.name}</strong><small>Since {dateLabel(customer.createdAt)}</small></span></span></td><td>{customer.phone}<small className="table-subtext">{customer.email || ""}</small></td><td>{ownSales.length}</td><td>{ownServices.length}</td><td><strong>{money(spend)}</strong></td><td><strong className={due ? "due-text" : ""}>{money(due)}</strong></td><td><button className="row-action" aria-label={`Open ${customer.name}`} onClick={() => onView(customer.id)}><ArrowRight size={15} /></button><button className="row-action" aria-label={`Edit ${customer.name}`} onClick={() => onEdit(customer)}><Settings size={14} /></button></td></tr>;
    })}</tbody></table></div> : <EmptyState icon={Users} title={search ? "No customers found" : "Meet your first customer"} detail={search ? "Try a different search." : "Customers added during sales or service intake appear here too."} action={!search ? <Button onClick={onAdd}><Plus size={15} /> Add customer</Button> : undefined} />}</div>
  </>;
}

function CustomerModal({ title = "Add customer", initial, onClose, onSave }: {
  title?: string;
  initial?: Customer;
  onClose: () => void; onSave: (name: string, phone: string, email: string) => Promise<void>;
}) {
  const [values, setValues] = useState({ name: initial?.name ?? "", phone: initial?.phone ?? "", email: initial?.email ?? "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = customerSchema.safeParse(values);
    if (!result.success) { setError(result.error.issues[0]?.message ?? "Check the customer details."); return; }
    setSaving(true);
    try { await onSave(values.name, values.phone, values.email); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save this customer."); }
    finally { setSaving(false); }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="modal-box compact-modal" onSubmit={submit}><div className="modal-header"><div><span className="eyebrow">CUSTOMER DIRECTORY</span><h2>{title}</h2></div><button className="icon-btn" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button></div><div className="modal-fields"><FormField label="Full name"><input className="input" value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} placeholder="e.g. Priya Sharma" /></FormField><FormField label="Contact number"><input className="input" value={values.phone} onChange={(event) => setValues({ ...values, phone: event.target.value })} placeholder="+91 98765 43210" /></FormField><FormField label="Email (optional)"><input className="input" type="email" value={values.email} onChange={(event) => setValues({ ...values, email: event.target.value })} placeholder="priya@example.com" /></FormField>{error && <span className="field-error">{error}</span>}</div><div className="modal-footer"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving…" : <><Pencil size={14} /> {title}</>}</Button></div></form></div>;
}

function ReportsPage({ sales, services }: { sales: Sale[]; services: ServiceJob[] }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const included = (date: string) => (!from || date >= from) && (!to || date <= `${to}T23:59:59`);
  const filteredSales = sales.filter((sale) => included(sale.invoiceDate));
  const filteredServices = services.filter((service) => included(service.inDate));
  const salesTotal = filteredSales.reduce((sum, sale) => sum + sale.finalAmount, 0);
  const collected = filteredSales.reduce((sum, sale) => sum + paymentTotal(sale.payments), 0)
    + filteredServices.reduce((sum, service) => sum + paymentTotal(service.payments), 0);
  const due = filteredSales.reduce((sum, sale) => sum + Math.max(0, sale.finalAmount - paymentTotal(sale.payments)), 0)
    + filteredServices.reduce((sum, service) => sum + Math.max(0, service.serviceAmount - service.discount - paymentTotal(service.payments)), 0);
  const exportCsv = () => {
    const rows = [["Type", "Reference", "Date", "Customer", "Total", "Paid", "Balance", "Status"]];
    filteredSales.forEach((sale) => rows.push(["Sale", sale.invoiceNumber, sale.invoiceDate, sale.customerName, String(sale.finalAmount), String(paymentTotal(sale.payments)), String(Math.max(0, sale.finalAmount - paymentTotal(sale.payments))), statusOf(sale.finalAmount, paymentTotal(sale.payments))]));
    filteredServices.forEach((service) => rows.push(["Service", service.serviceNumber, service.inDate, service.customerName, String(service.serviceAmount - service.discount), String(paymentTotal(service.payments)), String(Math.max(0, service.serviceAmount - service.discount - paymentTotal(service.payments))), service.status]));
    const csv = rows.map((row) => row.map((field) => `"${field.replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); link.download = `ahmobiles-report-${dateInputValue()}.csv`; link.click(); URL.revokeObjectURL(link.href);
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
    const servicePaid = orderedServices.reduce((sum, service) => sum + paymentTotal(service.payments), 0);
    const serviceDue = orderedServices.reduce((sum, service) => sum + Math.max(0, service.serviceAmount - service.discount - paymentTotal(service.payments)), 0);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(16);
    pdf.text("Service Data Report", margin, 13);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.text(`Period: ${from || "All"} to ${to || "All"}  |  Generated: ${dateLabel(new Date().toISOString())}`, margin, 20);
    pdf.text(`Jobs: ${orderedServices.length}  |  Total: ${pdfMoney(serviceTotal)}  |  Paid: ${pdfMoney(servicePaid)}  |  Balance: ${pdfMoney(serviceDue)}`, margin, 26);

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
      const paid = paymentTotal(service.payments);
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
    pdf.save(`ahmobiles-service-report-${dateInputValue()}.pdf`);
  };
  return <>
    <PageHeader eyebrow="BUSINESS INSIGHTS" title="Reports" description="A clear picture of sales, services, and the money collected."><Button variant="secondary" onClick={exportServicesPdf}><Download size={15} /> Export services PDF</Button><Button variant="secondary" onClick={exportCsv}><Download size={15} /> Export CSV</Button></PageHeader>
    <section className="panel report-filter"><div><strong>Report period</strong><span>Choose a date range for your records.</span></div><div className="date-range"><label>From<input className="input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><ArrowRight size={15} /><label>To<input className="input" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><button className="text-link" onClick={() => { setFrom(""); setTo(""); }}>Clear</button></div></section>
    <div className="report-metrics">{[{ label: "Sales billed", value: money(salesTotal), note: `${filteredSales.length} invoices`, icon: CreditCard }, { label: "Service revenue", value: money(filteredServices.reduce((sum, item) => sum + item.serviceAmount - item.discount, 0)), note: `${filteredServices.length} jobs`, icon: Wrench }, { label: "Collected", value: money(collected), note: "Sales & service payments", icon: CheckCircle2 }, { label: "Outstanding", value: money(due), note: "Remaining balances", icon: Clock3 }].map(({ label, value, note, icon: Icon }) => <div className="panel report-metric" key={label}><span className="metric-icon blue"><Icon size={17} /></span><span>{label}<strong>{value}</strong><small>{note}</small></span></div>)}</div>
    <div className="reports-grid"><section className="panel report-chart-panel"><div className="panel-heading"><div><h2>Revenue over time</h2><p>Filtered invoice and service totals</p></div></div>{filteredSales.length + filteredServices.length ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartForPeriod({ ...EMPTY_DATA, sales: filteredSales, services: filteredServices }, "Month")}><CartesianGrid stroke="#eef1f6" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 14, fill: "#98a1b3" }} /><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 14, fill: "#98a1b3" }} /><Tooltip formatter={(value) => money(Number(value))} /><Area type="monotone" dataKey="sales" stroke="#4777f5" fill="#4777f5" fillOpacity={0.12} /><Area type="monotone" dataKey="services" stroke="#22ad94" fill="#22ad94" fillOpacity={0.12} /></AreaChart></ResponsiveContainer></div> : <EmptyState icon={BarChart3} title="Your reports will grow with you" detail="Add sales and service jobs to see your revenue trends." />}</section><section className="panel report-status-panel"><div className="panel-heading"><div><h2>Service status</h2><p>Jobs by current stage</p></div></div>{(["Received", "In progress", "Ready", "Returned"] as ServiceStatus[]).map((status) => { const count = filteredServices.filter((service) => service.status === status).length; const ratio = filteredServices.length ? count / filteredServices.length * 100 : 0; return <div className="report-status" key={status}><div><span>{status}</span><strong>{count}</strong></div><div className="progress-track"><i className={`progress-${statusClass(status)}`} style={{ width: `${ratio}%` }} /></div></div>; })}</section></div>
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
              {form.logoDataUrl && <div className="settings-logo-row"><div className="settings-logo-preview" role="img" aria-label="Current shop logo" style={{ backgroundImage: `url("${form.logoDataUrl}")` }} /><button type="button" className="text-link" onClick={() => update("logoDataUrl", undefined)}>Remove logo</button></div>}
            </FormField>
          </div>
        </section>
        <section className="panel form-panel">
          <div className="form-section-head"><span className="step-number"><FileText size={16} /></span><div><h2>Invoice preferences</h2><p>Choose the numbering, print size, and customer footer.</p></div></div>
          <div className="form-grid two-col">
            <FormField label="Sales prefix"><input className="input" maxLength={6} value={form.salesPrefix} onChange={(event) => update("salesPrefix", event.target.value.toUpperCase())} /></FormField>
            <FormField label="Service prefix"><input className="input" maxLength={6} value={form.servicePrefix} onChange={(event) => update("servicePrefix", event.target.value.toUpperCase())} /></FormField>
            <FormField label="Invoice print size"><select className="input" value={form.invoicePaperSize} onChange={(event) => update("invoicePaperSize", event.target.value as ShopSettings["invoicePaperSize"])}><option value="A4">A4</option><option value="Thermal">Thermal receipt (80 mm)</option></select><small className="field-hint">PDF downloads remain A4; this setting applies to printing.</small></FormField>
            <FormField label="Invoice footer"><textarea className="input textarea" value={form.invoiceFooter} onChange={(event) => update("invoiceFooter", event.target.value)} /></FormField>
            <div className="invoice-format-preview"><span>Next invoice numbers</span><strong>{form.salesPrefix || "SAL"}-{businessYear()}-0001</strong><strong>{form.servicePrefix || "SRV"}-{businessYear()}-0001</strong></div>
          </div>
        </section>
        </fieldset>
        {canEdit && <div className="form-footer"><Button type="submit" disabled={saving}>{saving ? "Saving…" : <><Check size={16} /> Save settings</>}</Button></div>}
      </div>
      <aside className="settings-aside">
        <div className="panel settings-note"><span className="settings-note-icon"><ShieldCheck size={17} /></span><h3>Your data, kept safe.</h3><p>Each workspace is scoped to its authenticated owner. Keep Firestore rules deployed and up to date.</p><a href="https://firebase.google.com/docs/firestore/security/get-started" target="_blank" rel="noreferrer">Read about Firestore security <ArrowRight size={13} /></a></div>
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

function Pagination({ page, pages, total, pageSize, onPage }: { page: number; pages: number; total: number; pageSize: number; onPage: (page: number) => void }) {
  return <div className="pagination"><span>Showing <strong>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)}</strong> of <strong>{total}</strong></span><div><button aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={16} /></button><span>Page {page} of {pages}</span><button aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight size={16} /></button></div></div>;
}

function StatusBadge({ status }: { status: PaymentStatus | ServiceStatus }) {
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
