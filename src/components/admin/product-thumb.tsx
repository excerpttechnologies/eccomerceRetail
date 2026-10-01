"use client";
import { ImageOff } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import type { ImageIssue } from "@/domain/types";
import { cn } from "@/lib/utils";

const ISSUE_TEXT: Record<ImageIssue, string> = {
  none: "No image in RetailERP",
  placeholder: "RetailERP has only a placeholder image",
  unavailable: "Image could not be loaded from RetailERP",
};

/**
 * ERP product image via next/image (resized thumbnails instead of the full JPEG).
 * Missing or failing images show the same neutral box the admin uses elsewhere.
 */
export function ProductThumb({ src, alt, issue, sizes, className }: { src?: string; alt: string; issue?: ImageIssue; sizes: string; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const broken = !src || failed === src;
  return (
    <div className={cn("relative shrink-0 overflow-hidden rounded-sm bg-line", className)} title={broken ? ISSUE_TEXT[failed === src ? "unavailable" : (issue ?? "none")] : undefined}>
      {broken ? (
        <ImageOff aria-hidden className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-muted" />
      ) : (
        <Image src={src} alt={alt} fill sizes={sizes} className="object-cover" onError={() => setFailed(src)} />
      )}
    </div>
  );
}
