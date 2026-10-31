/** Haversine distance in km, rounded to 2 dp. Mirrors app.distance_km(). */
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371.0088;
  const rad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return Math.round(R * 2 * Math.asin(Math.min(1, Math.sqrt(a))) * 100) / 100;
}

export const SEARCH_RADII_KM = [10, 25, 50, 60] as const;
export const DEFAULT_RADIUS_KM = 50;

export type Coverage = "available" | "needs_confirmation" | "outside" | "pickup_only";

export const COVERAGE_LABEL: Record<Coverage, string> = {
  available: "Delivers to your area",
  needs_confirmation: "Delivery needs confirmation",
  outside: "Outside delivery area",
  pickup_only: "Pickup only",
};

export function isValidPincode(pin: string): boolean {
  return /^[1-9][0-9]{5}$/.test(pin.trim());
}

export function isValidCoordinate(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}
