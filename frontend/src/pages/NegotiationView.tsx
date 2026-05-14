import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { negotiations as api, whatsapp, type Negotiation, type Message } from "../api/client";
import { useSSE } from "../hooks/useSSE";

const STATUS_COLORS: Record<string, string> = {
  active: "text-green-400",
  completed: "text-blue-400",
  rejected: "text-red-400",
  stopped: "text-neutral-400",
};

function phonesMatch(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const strip = (s: string) => s.replace("@c.us", "").replace(/\D/g, "");
  return strip(a) === strip(b);
}

export default function NegotiationView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [negotiation, setNegotiation] = useState<Negotiation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchData = async () => {
    if (!id) return;
    try {
      const res = await api.get(id);
      setNegotiation(res.negotiation);
      setMessages(res.messages);
    } catch {
      navigate("/");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useSSE({
    "message:received": (data: any) => {
      if (negotiation && (data.negotiationId === negotiation.id || phonesMatch(data.phone, negotiation.phone_formatted))) {
        fetchData();
      }
    },
    "message:sent": (data: any) => {
      if (negotiation && (data.negotiationId === negotiation.id || phonesMatch(data.phone, negotiation.phone_formatted))) {
        fetchData();
      }
    },
    "negotiation:completed": (data: any) => {
      if (data.negotiationId === id) {
        fetchData();
      }
    },
  });

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !negotiation) return;

    setSending(true);
    try {
      await whatsapp.send(negotiation.phone, newMessage.trim());
      setNewMessage("");
      await fetchData();
    } catch (err) {
      console.error("Send failed:", err);
    } finally {
      setSending(false);
    }
  };

  const handleStop = async () => {
    if (!id) return;
    try {
      await api.stop(id);
      await fetchData();
    } catch (err) {
      console.error("Stop failed:", err);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-neutral-400">Loading...</div>;
  }

  if (!negotiation) return null;

  return (
    <div className="min-h-screen flex flex-col max-w-3xl mx-auto">
      {/* Header */}
      <div className="p-4 border-b border-neutral-800">
        <div className="flex items-center justify-between">
          <div>
            <button
              onClick={() => navigate("/")}
              className="text-sm text-neutral-400 hover:text-white transition"
            >
              &larr; Back
            </button>
            <h1 className="text-lg font-bold text-white mt-1">
              {negotiation.business_name || negotiation.phone}
            </h1>
            <p className="text-sm text-neutral-500">{negotiation.phone}</p>
          </div>
          <div className="text-right">
            <span className={`text-sm font-medium ${STATUS_COLORS[negotiation.status] || ""}`}>
              {negotiation.status}
            </span>
            <p className="text-xs text-neutral-500 mt-1">
              Round {negotiation.rounds}/{negotiation.max_rounds}
            </p>
            {negotiation.status === "active" && (
              <button
                onClick={handleStop}
                className="mt-2 px-3 py-1 bg-red-900 hover:bg-red-800 text-red-300 rounded text-xs transition"
              >
                Stop
              </button>
            )}
          </div>
        </div>

        {/* Context bar */}
        <div className="mt-3 p-2 bg-neutral-900 rounded text-xs text-neutral-400">
          <p><strong className="text-neutral-300">Context:</strong> {negotiation.context}</p>
          <p className="mt-1"><strong className="text-neutral-300">Objective:</strong> {negotiation.objective}</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-center text-neutral-500 py-8">No messages yet</p>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[75%] px-3 py-2 rounded-lg text-sm ${
                msg.direction === "outbound"
                  ? "bg-blue-900 text-blue-100"
                  : "bg-neutral-800 text-neutral-200"
              }`}
            >
              <p className="whitespace-pre-wrap break-words">{msg.body}</p>
              <p className="text-xs mt-1 opacity-50">
                {new Date(msg.timestamp).toLocaleTimeString()}
                {msg.simulated ? " (simulated)" : ""}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Send bar */}
      <form onSubmit={handleSend} className="p-4 border-t border-neutral-800 flex gap-2">
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          className="flex-1 px-3 py-2 bg-neutral-900 border border-neutral-700 rounded text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500 text-sm"
          placeholder="Type a manual message..."
          disabled={negotiation.status !== "active" && !newMessage}
        />
        <button
          type="submit"
          disabled={sending || !newMessage.trim()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded text-sm font-medium transition"
        >
          {sending ? "..." : "Send"}
        </button>
      </form>
    </div>
  );
}
