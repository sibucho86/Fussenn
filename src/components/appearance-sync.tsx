"use client";
import { useEffect } from "react";
import { applyAppearance, DEFAULT_APPEARANCE } from "@/lib/appearance";
import { useAppearance } from "@/lib/appearance-store";

/** Keeps <html> in step with the saved look, including changes made in another tab or window. */
export function AppearanceSync() {
  const appearance = useAppearance();
  // During hydration the store briefly reports the server default; the head script already applied the saved look.
  useEffect(() => { if (appearance !== DEFAULT_APPEARANCE) applyAppearance(appearance); }, [appearance]);
  return null;
}
