import type { Metadata } from "next";
import { LabClient } from "@/dashboard/LabClient";

export const metadata: Metadata = { title: "ExitZero Lab · Adversarial Building Resilience" };

export default async function LabPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const b = typeof sp.b === "string" ? sp.b : "clinic";
  const autoplay = sp.autoplay === "1";
  return <LabClient presetId={b} autoplay={autoplay} />;
}
