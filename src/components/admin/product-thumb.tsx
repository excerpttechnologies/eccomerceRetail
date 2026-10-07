"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
import type { ImageIssue } from "@/domain/types";
import { cn } from "@/lib/utils";

export function ProductThumb({ src, alt, sizes, className }: { src?: string; alt: string; issue?: ImageIssue; sizes: string; className?: string }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return <div aria-hidden="true" className={cn("rounded-sm", className)} />;
  }

  return (
    <div className={cn("relative overflow-hidden rounded-sm bg-line", className)}>
      <Image src={src} alt={alt} fill sizes={sizes} unoptimized className="object-cover" onError={() => setFailed(true)} />
    </div>
  );
}
