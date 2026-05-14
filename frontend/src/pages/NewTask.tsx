import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { businesses, negotiations } from "../api/client";

interface Business {
  name: string;
  address: string;
  phone: string;
  phoneFormatted: string;
  rating: number | null;
  website: string | null;
  placeId: string;
}

export default function NewTask() {
  const navigate = useNavigate();
  const [hasGps, setHasGps] = useState<boolean | null>(null);

  useEffect(() => {
    businesses.hasGps().then((r) => setHasGps(r.available)).catch(() => setHasGps(false));
  }, []);

  // Step 1: Search
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Business[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  // Step 2: Configure (used in both modes)
  const [mode, setMode] = useState<"search" | "manual">("search");
  const [manualPhone, setManualPhone] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [context, setContext] = useState("");
  const [objective, setObjective] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");

  const step = mode === "search" && results.length === 0 ? "search" : "configure";

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setSearching(true);
    setSearchError("");
    try {
      const res = await businesses.search(query);
      if (res.mode === "manual") {
        setMode("manual");
        setResults([]);
      } else {
        setMode("search");
        setResults(res.businesses || []);
        if (!res.businesses || res.businesses.length === 0) {
          setSearchError("No businesses found. Try a different search.");
        }
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const toggleSelect = (idx: number) => {
    const next = new Set(selected);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    setSelected(next);
  };

  const handleStart = async () => {
    if (!context.trim() || !objective.trim()) return;

    // In manual mode, require phone number
    if (mode === "manual" && !manualPhone.trim()) {
      setStartError("Please enter a phone number");
      return;
    }

    // In search mode, require at least one selected
    if (mode === "search" && selected.size === 0) {
      setStartError("Please select at least one business");
      return;
    }

    setStarting(true);
    setStartError("");

    try {
      if (mode === "manual") {
        await negotiations.start({
          phoneNumber: manualPhone.trim(),
          context: context.trim(),
          objective: objective.trim(),
        });
      } else {
        for (const idx of selected) {
          const biz = results[idx];
          await negotiations.start({
            phoneNumber: biz.phone,
            businessName: biz.name,
            context: context.trim(),
            objective: objective.trim(),
          });
        }
      }
      navigate("/");
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Failed to start negotiations");
    } finally {
      setStarting(false);
    }
  };

  if (hasGps === null) {
    return <div className="min-h-screen flex items-center justify-center text-neutral-400">Loading...</div>;
  }

  return (
    <div className="min-h-screen p-6 max-w-3xl mx-auto">
      <button
        onClick={() => navigate("/")}
        className="text-sm text-neutral-400 hover:text-white mb-6 transition"
      >
        &larr; Back to Dashboard
      </button>

      <h1 className="text-xl font-bold text-white mb-6">New Task</h1>

      {/* Step 1: Search / Manual mode */}
      {step === "search" && (
        <form onSubmit={handleSearch} className="space-y-4">
          <div>
            <label className="block text-sm text-neutral-300 mb-1">What do you need and where?</label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500"
              placeholder={hasGps ? "e.g. bakeries in Buenos Aires" : "Describe what you need (GPS key not set — you'll enter the phone number next)"}
              required
            />
          </div>

          {searchError && <p className="text-red-400 text-sm">{searchError}</p>}

          <button
            type="submit"
            disabled={searching}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded font-medium transition"
          >
            {searching ? "Searching..." : hasGps ? "Find Businesses" : "Continue"}
          </button>
        </form>
      )}

      {/* Step 2: Manual mode — phone number input */}
      {mode === "manual" && step === "configure" && (
        <div className="space-y-6">
          <div className="p-4 bg-neutral-900 border border-yellow-900 rounded">
            <p className="text-sm text-yellow-400 mb-3">Google Places API key not configured. Enter the phone number directly.</p>
            <div>
              <label className="block text-sm text-neutral-300 mb-1">Business phone number (international format)</label>
              <input
                type="text"
                value={manualPhone}
                onChange={(e) => setManualPhone(e.target.value)}
                className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500"
                placeholder="+54 11 1234-5678"
              />
            </div>
          </div>

          <div className="space-y-4 pt-4 border-t border-neutral-800">
            <div>
              <label className="block text-sm text-neutral-300 mb-1">What do you need? (context for the AI)</label>
              <textarea
                value={context}
                onChange={(e) => setContext(e.target.value)}
                className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500 h-20"
                placeholder="e.g. 200 medialunas for a corporate event on Friday May 30th, delivery to Palermo"
              />
            </div>

            <div>
              <label className="block text-sm text-neutral-300 mb-1">Your objective (budget, requirements)</label>
              <textarea
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500 h-20"
                placeholder="e.g. Best price under $50,000 ARS, must include delivery and setup by 9am"
              />
            </div>

            {startError && <p className="text-red-400 text-sm">{startError}</p>}

            <button
              onClick={handleStart}
              disabled={starting || !context.trim() || !objective.trim() || !manualPhone.trim()}
              className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded font-medium transition"
            >
              {starting ? "Starting..." : "Start Negotiation"}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Search mode — business results */}
      {mode === "search" && step === "configure" && (
        <div className="space-y-6">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg text-white font-medium">Found {results.length} businesses</h2>
              <button
                onClick={() => { setResults([]); setSelected(new Set()); }}
                className="text-sm text-neutral-400 hover:text-white transition"
              >
                Search again
              </button>
            </div>

            <div className="space-y-2">
              {results.map((biz, idx) => (
                <button
                  key={idx}
                  onClick={() => toggleSelect(idx)}
                  className={`w-full text-left p-3 rounded border transition ${
                    selected.has(idx)
                      ? "bg-blue-950 border-blue-700"
                      : "bg-neutral-900 border-neutral-800 hover:border-neutral-600"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-white font-medium">{biz.name}</span>
                    {biz.rating && <span className="text-yellow-400 text-sm">{biz.rating} stars</span>}
                  </div>
                  <p className="text-sm text-neutral-400">{biz.address}</p>
                  <p className="text-sm text-neutral-500">{biz.phone}</p>
                </button>
              ))}
            </div>
          </div>

          {selected.size > 0 && (
            <div className="space-y-4 pt-4 border-t border-neutral-800">
              <div>
                <label className="block text-sm text-neutral-300 mb-1">What do you need? (context for the AI)</label>
                <textarea
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500 h-20"
                  placeholder="e.g. 200 medialunas for a corporate event on Friday May 30th, delivery to Palermo"
                />
              </div>

              <div>
                <label className="block text-sm text-neutral-300 mb-1">Your objective (budget, requirements)</label>
                <textarea
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                  className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500 h-20"
                  placeholder="e.g. Best price under $50,000 ARS, must include delivery and setup by 9am"
                />
              </div>

              {startError && <p className="text-red-400 text-sm">{startError}</p>}

              <button
                onClick={handleStart}
                disabled={starting || !context.trim() || !objective.trim()}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded font-medium transition"
              >
                {starting
                  ? "Starting..."
                  : `Start ${selected.size} Negotiation${selected.size > 1 ? "s" : ""}`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
