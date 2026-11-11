export type PaymentStatus = "Paid" | "Partially paid" | "Unpaid";
export type ServiceStatus = "Received" | "In progress" | "Ready" | "Returned";

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
  deliveryRemarks?: string;
  deliveryHistory?: Array<{ date: string; person: string; remarks: string }>;
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
  servicePrefix: "SRV",
};

export const EMPTY_WORKSPACE: WorkspaceData = {
  sales: [],
  services: [],
  customers: [],
  settings: DEFAULT_SETTINGS,
};
