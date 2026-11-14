export type PaymentStatus = "Paid" | "Partially paid" | "Unpaid";
export type ServiceStatus = "Received" | "In progress" | "Ready" | "Returned";

export const EMPLOYEE_MODULES = [
  { key: "overview", label: "Overview" },
  { key: "sales", label: "Sales" },
  { key: "services", label: "Services" },
  { key: "vendors", label: "Service vendors" },
  { key: "ready", label: "Ready for delivery" },
  { key: "customers", label: "Customers" },
  { key: "reports", label: "Reports" },
  { key: "settings", label: "Shop settings" },
] as const;

export type EmployeeModule = typeof EMPLOYEE_MODULES[number]["key"];
export type ModuleAccess = "none" | "view" | "edit";
export type EmployeePermissions = Record<EmployeeModule, ModuleAccess>;
export type WorkspaceRole = "admin" | "employee";

export type EmployeeAccount = {
  id: string;
  username: string;
  permissions: EmployeePermissions;
  active: boolean;
};

export type WorkspaceIdentity = {
  uid: string;
  shopId: string;
  email: string | null;
  username: string;
  role: WorkspaceRole;
  permissions: EmployeePermissions;
};

export const NO_EMPLOYEE_PERMISSIONS: EmployeePermissions = {
  overview: "none",
  sales: "none",
  services: "none",
  vendors: "none",
  ready: "none",
  customers: "none",
  reports: "none",
  settings: "none",
};

export const ADMIN_PERMISSIONS: EmployeePermissions = {
  overview: "edit",
  sales: "edit",
  services: "edit",
  vendors: "edit",
  ready: "edit",
  customers: "edit",
  reports: "edit",
  settings: "edit",
};

export type Payment = {
  id: string;
  amount: number;
  date: string;
  notes?: string;
};

export type Customer = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  createdAt: string;
};

export type ServiceVendor = {
  id: string;
  name: string;
  phone: string;
  createdAt: string;
};

export type VendorService = {
  id: string;
  vendorId: string;
  serviceNumber: string;
  inDate: string;
  customerName: string;
  brand: string;
  mobileModel: string;
  customerNumber: string;
  status: ServiceStatus;
  deliveryDate?: string;
  deliveryCustomer?: string;
  serviceCharge: number;
  createdAt: string;
};

export type ProductLine = {
  id: string;
  brand: string;
  model: string;
  imei: string;
  quantity: number;
  rate: number;
  discount: number;
};

export type Sale = {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  contactNumber: string;
  invoiceDate: string;
  products: ProductLine[];
  subtotal: number;
  discount: number;
  tax: number;
  finalAmount: number;
  payments: Payment[];
  createdAt: string;
};

export type ServiceJob = {
  id: string;
  serviceNumber: string;
  vendorId?: string;
  customerId: string;
  customerName: string;
  contactNumber: string;
  inDate: string;
  brand: string;
  mobileModel: string;
  imei: string;
  reportedFault: string;
  technicianNotes: string;
  receivedConditions: string[];
  remarks: string;
  status: ServiceStatus;
  serviceAmount: number;
  discount: number;
  finalAmount: number;
  payments: Payment[];
  readyAt?: string;
  deliveryOutDate?: string;
  deliveryOutPerson?: string;
  deliveryOutStaff?: string;
  deliveryOutStaffId?: string;
  deliveryRemarks?: string;
  deliveryHistory?: Array<{ date: string; person: string; staff?: string; staffId?: string; remarks: string }>;
  createdAt: string;
};

export type ShopSettings = {
  shopName: string;
  ownerName: string;
  phone: string;
  email: string;
  address: string;
  gstin: string;
  logoDataUrl?: string;
  invoicePaperSize: "A4" | "Thermal";
  invoiceFooter: string;
  salesPrefix: string;
  servicePrefix: string;
};

export type WorkspaceData = {
  sales: Sale[];
  services: ServiceJob[];
  customers: Customer[];
  vendors: ServiceVendor[];
  vendorServices: VendorService[];
  settings: ShopSettings;
};

export const DEFAULT_SETTINGS: ShopSettings = {
  shopName: "A&H Mobiles",
  ownerName: "Shop owner",
  phone: "",
  email: "",
  address: "",
  gstin: "",
  invoicePaperSize: "A4",
  invoiceFooter: "Thank you for choosing A&H Mobiles.",
  salesPrefix: "SAL",
  servicePrefix: "SERV",
};

export const EMPTY_WORKSPACE: WorkspaceData = {
  sales: [],
  services: [],
  customers: [],
  vendors: [],
  vendorServices: [],
  settings: DEFAULT_SETTINGS,
};
