import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { negotiations as api, type Negotiation } from "../api/client";
import { whatsapp } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import { useSSE } from "../hooks/useSSE";
import WhatsAppConnect from "../components/WhatsAppConnect";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-900 text-green-300",
  completed: "bg-blue-900 text-blue-300",
  rejected: "bg-red-900 text-red-300",
  stopped: "bg-neutral-800 text-neutral-400",
};

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<Negotiation[]>([]);
  const [waStatus, setWaStatus] = useState<{ connected: boolean; state: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.list(), whatsapp.status()])
      .then(([negRes, statusRes]) => {
        setItems(negRes.negotiations);
        setWaStatus(statusRes);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useSSE({
    "negotiation:started": () => api.list().then((r) => setItems(r.negotiations)),
    "negotiation:completed": () => api.list().then((r) => setItems(r.negotiations)),
    "negotiation:stopped": () => api.list().then((r) => setItems(r.negotiations)),
    "whatsapp:ready": () => setWaStatus({ connected: true, state: "ready" }),
    "whatsapp:disconnected": () => setWaStatus({ connected: false, state: "disconnected" }),
  });

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-neutral-400">Loading...</div>;
  }

  const showWhatsAppSetup = waStatus && !waStatus.connected;

  return (
    <div className="min-h-screen p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-neutral-400">{user?.email}</p>
        </div>
        <div className="flex gap-3">
          <Link
            to="/new"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium transition"
          >
            New Task
          </Link>
          <button
            onClick={() => logout().then(() => navigate("/login"))}
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded text-sm transition"
          >
            Logout
          </button>
        </div>
      </div>

      {/* WhatsApp Connect */}
      {showWhatsAppSetup && <WhatsAppConnect onConnected={() => setWaStatus({ connected: true, state: "ready" })} />}

      {/* Negotiations */}
      <div className="space-y-3">
        {items.length === 0 ? (
          <div className="text-center py-16 text-neutral-500">
            <p className="text-lg mb-2">No negotiations yet</p>
            <p className="text-sm">Click "New Task" to get started</p>
          </div>
        ) : (
          items.map((n) => (
            <Link
              key={n.id}
              to={`/negotiation/${n.id}`}
              className="block p-4 bg-neutral-900 border border-neutral-800 rounded-lg hover:border-neutral-600 transition"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-white font-medium">{n.business_name || n.phone}</span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[n.status] || ""}`}>
                  {n.status}
                </span>
              </div>
              <p className="text-sm text-neutral-400 truncate">{n.context}</p>
              <div className="flex items-center gap-4 mt-2 text-xs text-neutral-500">
                <span>Round {n.rounds}/{n.max_rounds}</span>
                <span>{n.phone}</span>
                <span>{new Date(n.started_at).toLocaleDateString()}</span>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
