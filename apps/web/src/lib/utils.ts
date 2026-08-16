import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | string, currency: string = "INR") {
  const amount = typeof value === "number" ? value : Number(value);

  try {
    return new Intl.NumberFormat(`en-${currency === "INR" ? "IN" : "US"}`, {
      style: "currency",
      currency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `$ ${amount}`;
  }
}
