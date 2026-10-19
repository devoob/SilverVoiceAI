"use client";

/**
 * Accessible primitives.
 *
 * Every interactive element clears the PRD's 64x64px minimum tap target, and
 * every colour pairing is drawn from the audited >=7:1 palette in globals.css.
 */

import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  cn(
    "inline-flex items-center justify-center gap-3 rounded-2xl font-bold",
    // min-height comes from the `size` variants below, not from the unlayered
    // .sv-tap helper: unlayered CSS wins over Tailwind's @layer utilities in
    // the cascade, which would silently override a caller's larger target.
    "min-w-[var(--tap)] px-7 text-lg transition-colors duration-150",
    "select-none touch-manipulation",
    "disabled:cursor-not-allowed disabled:opacity-50",
  ),
  {
    variants: {
      variant: {
        primary: "bg-brand text-white hover:bg-brand-strong active:bg-brand-strong",
        secondary:
          "bg-white text-ink border-4 border-ink hover:bg-surface active:bg-surface",
        success: "bg-success text-white hover:brightness-110 active:brightness-95",
        danger: "bg-danger text-white hover:brightness-110 active:brightness-95",
        info: "bg-info text-white hover:brightness-110 active:brightness-95",
        quiet: "bg-surface text-ink border-4 border-line-soft hover:border-line active:bg-background",
      },
      size: {
        default: "min-h-[var(--tap)] text-lg",
        large: "min-h-[84px] text-xl px-9",
        block: "min-h-[var(--tap)] w-full text-lg",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
});

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-3xl border-4 border-line bg-white p-7 shadow-[0_2px_0_0_var(--border)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2 className={cn("text-xl font-extrabold leading-tight text-ink", className)}>{children}</h2>
  );
}

/** Big, high-contrast numeric readout used for balances and amounts. */
export function Amount({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-3xl font-extrabold tabular-nums tracking-tight text-ink",
        className,
      )}
    >
      {value}
    </p>
  );
}

export function Label({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn("text-base font-bold uppercase tracking-wide text-muted", className)}
      {...props}
    />
  );
}

/**
 * Status pill. Uses a shape + icon as well as colour, so the meaning survives
 * greyscale rendering and colour-vision deficiency (WCAG 1.4.1).
 */
export function Pill({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warn" | "danger" | "brand";
  className?: string;
}) {
  const tones = {
    neutral: "bg-surface text-ink border-line",
    success: "bg-surface-success text-ink border-success",
    warn: "bg-surface-warn text-ink border-warn",
    danger: "bg-surface-danger text-ink border-danger",
    brand: "bg-surface-brand text-ink border-brand",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border-2 px-4 py-1 text-base font-bold",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
