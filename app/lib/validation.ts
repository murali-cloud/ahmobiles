import { z } from "zod";

const money = z.coerce.number().finite().min(0, "Enter a valid amount.");
const phone = z.string().trim().min(7, "Enter a valid contact number.").max(20);

export const credentialsSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters."),
});

export const customerSchema = z.object({
  name: z.string().trim().min(2, "Enter the customer's name."),
  phone,
  email: z.union([z.literal(""), z.string().trim().email("Enter a valid email address.")]),
});

export const productSchema = z.object({
  id: z.string(),
  brand: z.string().trim().min(1, "Enter a brand."),
  model: z.string().trim().min(1, "Enter a model."),
  imei: z.string().trim().max(20, "IMEI must be 20 characters or fewer."),
  quantity: z.coerce.number().int().min(1, "Quantity must be at least one."),
  rate: money,
  discount: money,
}).refine((product) => product.discount <= product.quantity * product.rate, {
  message: "Discount cannot exceed the line amount.",
  path: ["discount"],
});

export const saleSchema = z.object({
  customerName: z.string().trim().min(2, "Enter the customer's name."),
  contactNumber: phone,
  invoiceDate: z.string().min(1, "Choose an invoice date."),
  products: z.array(productSchema).min(1, "Add at least one product."),
  discount: money,
  tax: money,
  amountPaid: money,
});

const serviceFieldsSchema = z.object({
  customerName: z.string().trim().min(2, "Enter the customer's name."),
  contactNumber: phone,
  inDate: z.string().min(1, "Choose an intake date."),
  brand: z.string().trim().min(1, "Enter a device brand."),
  mobileModel: z.string().trim().min(1, "Enter a device model."),
  imei: z.string().trim().max(20, "IMEI must be 20 characters or fewer."),
  reportedFault: z.string().trim().min(3, "Describe the reported fault."),
  technicianNotes: z.string(),
  receivedConditions: z.array(z.string()).min(1, "Select at least one condition."),
  remarks: z.string(),
  serviceAmount: money,
  discount: money,
});

export const serviceFormSchema = serviceFieldsSchema.omit({ receivedConditions: true });

export const serviceSchema = serviceFieldsSchema.refine((value) => value.discount <= value.serviceAmount, {
  message: "Discount cannot exceed the service amount.",
  path: ["discount"],
});
