import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Apply the user's text-scale choice by setting the CSS multiplier. */
export function applyTextScale(scale: number): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--text-scale", String(scale));
}

export function formatTime(iso: string, lang: string): string {
  return new Date(iso).toLocaleTimeString(lang === "en" ? "en-HK" : "zh-HK", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(iso: string, lang: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(lang === "en" ? "en-HK" : "zh-HK", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
