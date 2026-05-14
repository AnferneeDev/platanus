import { Router, type Request, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../auth/middleware.js";
import { addLeads as dbAddLeads, getLeadsByUser } from "../db/leads.js";
import { formatToWhatsApp } from "../utils/phone-formatter.js";

const router = Router();

const API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

interface PlaceSearchResult {
  place_id: string;
  name: string;
  formatted_address: string;
  rating?: number;
}

interface PlaceDetailsResult {
  formatted_phone_number?: string;
  international_phone_number?: string;
  website?: string;
  name: string;
  formatted_address: string;
  rating?: number;
}

async function textSearch(query: string): Promise<PlaceSearchResult[]> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query", query);
  url.searchParams.set("key", API_KEY);

  const res = await fetch(url.toString());
  const data = (await res.json()) as { results: PlaceSearchResult[]; status: string };

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(`Google Places Text Search failed: ${data.status}`);
  }

  return data.results || [];
}

async function getPlaceDetails(placeId: string): Promise<PlaceDetailsResult | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("fields", "formatted_phone_number,international_phone_number,name,formatted_address,rating,website");
  url.searchParams.set("key", API_KEY);

  const res = await fetch(url.toString());
  const data = (await res.json()) as { result?: PlaceDetailsResult; status: string };

  if (data.status !== "OK") return null;
  return data.result ?? null;
}

router.get("/has-gps", (_req: Request, res: Response) => {
  res.json({ available: !!API_KEY });
});

router.post("/search", requireAuth, async (req: Request, res: Response) => {
  try {
    const { query, maxResults = 5 } = req.body as { query?: string; maxResults?: number };
    const userId = (req as AuthenticatedRequest).userId;

    if (!query) {
      res.status(400).json({ error: "Query is required" });
      return;
    }

    if (!API_KEY) {
      res.json({ mode: "manual", message: "No Google Places key configured. Enter a phone number directly." });
      return;
    }

    const clampedMax = Math.min(Math.max(maxResults, 1), 10);
    const searchResults = await textSearch(query);
    const topResults = searchResults.slice(0, clampedMax);

    if (topResults.length === 0) {
      res.json({ mode: "search", message: "No businesses found", query, businesses: [] });
      return;
    }

    const businesses: Array<{
      name: string;
      address: string;
      phone: string;
      phoneFormatted: string;
      rating: number | null;
      website: string | null;
      placeId: string;
    }> = [];
    const skipped: string[] = [];

    for (const place of topResults) {
      const details = await getPlaceDetails(place.place_id);
      if (!details) { skipped.push(place.name); continue; }

      const phone = details.international_phone_number || details.formatted_phone_number || "";
      if (!phone) { skipped.push(`${place.name} (no phone)`); continue; }

      businesses.push({
        name: details.name || place.name,
        address: details.formatted_address || place.formatted_address,
        phone,
        phoneFormatted: formatToWhatsApp(phone),
        rating: details.rating || place.rating || null,
        website: details.website || null,
        placeId: place.place_id,
      });
    }

    if (businesses.length > 0) {
      dbAddLeads(
        userId,
        businesses.map((b) => ({
          name: b.name,
          address: b.address,
          phone: b.phone,
          phone_formatted: b.phoneFormatted,
          rating: b.rating,
          website: b.website,
          place_id: b.placeId,
        }))
      );
    }

    res.json({
      mode: "search",
      message: `Found ${businesses.length} businesses with phone numbers.`,
      query,
      businesses,
      skipped: skipped.length > 0 ? skipped : undefined,
    });
  } catch (err) {
    console.error("[Businesses] Search error:", err);
    res.status(500).json({ error: "Business search failed" });
  }
});

router.get("/", requireAuth, (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const leads = getLeadsByUser(userId);
  res.json({ leads });
});

export default router;
