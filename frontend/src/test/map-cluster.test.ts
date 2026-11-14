import { describe, expect, it } from "vitest";

describe("map marker clustering", () => {
  it("registers the marker-cluster extension with Leaflet", async () => {
    const module = await import("leaflet");
    await import("leaflet.markercluster");
    const leaflet = (module as unknown as { default?: typeof import("leaflet") }).default ?? module;

    expect(typeof leaflet.markerClusterGroup).toBe("function");
    expect(
      leaflet.markerClusterGroup({
        chunkedLoading: true,
        maxClusterRadius: 55,
      }),
    ).toBeDefined();
  });
});
