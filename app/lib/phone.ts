export function normalizePhoneNumber(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0091")) digits = digits.slice(4);
  else if (digits.startsWith("91") && digits.length > 10) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}
