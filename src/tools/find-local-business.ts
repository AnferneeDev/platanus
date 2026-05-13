import { config } from "dotenv";
import { addLeads, type Lead } from "../store/json-store.js";
import { formatToWhatsApp } from "../utils/phone-formatter.js";

config();

const API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

export const findLocalBusinessDefinition = {
  name: "find_local_business",
  description:
    "Search for local businesses using Google Places. Returns business names, addresses, phone numbers, and ratings. Results are saved to the local leads database for later use with WhatsApp messaging tools. Use queries like 'bakeries in Buenos Aires' or 'catering services near downtown Caracas'.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description:
          "Search query including business type and location, e.g. 'bakeries in Buenos Aires' or 'florists near Palermo, Buenos Aires'",
      },
      maxResults: {
        type: "number",
        description: "Maximum number of results to return (1-10, default 5)",
      },
    },
    required: ["query"],
  },
};

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
  const url = new URL(
    "https://maps.googleapis.com/maps/api/place/textsearch/json"
  );
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
  const url = new URL(
    "https://maps.googleapis.com/maps/api/place/details/json"
  );
  url.searchParams.set("place_id", placeId);
  url.searchParams.set(
    "fields",
    "formatted_phone_number,international_phone_number,name,formatted_address,rating,website"
  );
  url.searchParams.set("key", API_KEY);

  const res = await fetch(url.toString());
  const data = (await res.json()) as { result?: PlaceDetailsResult; status: string };

  if (data.status !== "OK") {
    return null;
  }

  return data.result ?? null;
}

export async function findLocalBusiness(
  query: string,
  maxResults = 5
): Promise<string> {
  if (!API_KEY) {
    return JSON.stringify({
      error:
        "GOOGLE_PLACES_API_KEY is not configured. Set it in your .env file.",
    });
  }

  const clampedMax = Math.min(Math.max(maxResults, 1), 10);

  try {
    // Step 1: Text search
    const searchResults = await textSearch(query);
    const topResults = searchResults.slice(0, clampedMax);

    if (topResults.length === 0) {
      return JSON.stringify({
        message: "No businesses found for that query. Try a different search term or location.",
        query,
        results: [],
      });
    }

    // Step 2: Get details (phone numbers) for each result
    const leads: Lead[] = [];
    const skipped: string[] = [];

    for (const place of topResults) {
      const details = await getPlaceDetails(place.place_id);

      if (!details) {
        skipped.push(place.name);
        continue;
      }

      const phone =
        details.international_phone_number ||
        details.formatted_phone_number ||
        "";

      if (!phone) {
        skipped.push(`${place.name} (no phone number available)`);
        continue;
      }

      leads.push({
        id: place.place_id,
        name: details.name || place.name,
        address: details.formatted_address || place.formatted_address,
        phone,
        phoneFormatted: formatToWhatsApp(phone),
        rating: details.rating || place.rating,
        website: details.website,
        placeId: place.place_id,
        messages: [],
        createdAt: new Date().toISOString(),
      });
    }

    // Step 3: Save to local store
    if (leads.length > 0) {
      addLeads(leads);
    }

    return JSON.stringify({
      message: `Found ${leads.length} businesses with phone numbers.${skipped.length > 0 ? ` ${skipped.length} skipped (no phone).` : ""}`,
      query,
      businesses: leads.map((l) => ({
        name: l.name,
        address: l.address,
        phone: l.phone,
        rating: l.rating,
        website: l.website,
      })),
      skipped: skipped.length > 0 ? skipped : undefined,
    });
  } catch (err) {
    return JSON.stringify({
      error: `Failed to search businesses: ${String(err)}`,
    });
  }
}
