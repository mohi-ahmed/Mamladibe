import { ClientOnly } from "@tanstack/react-router";
import type { ComponentProps } from "react";
import { IncidentMap } from "./IncidentMap";

/** Map that renders only in the browser, with an asphalt placeholder during SSR. */
export function MapFrame(props: ComponentProps<typeof IncidentMap>) {
  return (
    <ClientOnly fallback={<div className="led-board h-full w-full animate-pulse" />}>
      <IncidentMap {...props} />
    </ClientOnly>
  );
}
