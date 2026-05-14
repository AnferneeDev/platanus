import { useState, useEffect } from "react";
import { whatsapp } from "../api/client";

interface Props {
  onConnected: () => void;
}

export default function WhatsAppConnect({ onConnected }: Props) {
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchQR = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await whatsapp.qr();
      setQrUrl(res.qr);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get QR code");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQR();

    // Poll connection status
    const interval = setInterval(async () => {
      try {
        const status = await whatsapp.status();
        if (status.connected) {
          clearInterval(interval);
          onConnected();
        } else if (status.hasQR) {
          const qr = await whatsapp.qr();
          setQrUrl(qr.qr);
        }
      } catch {
        // ignore polling errors
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [onConnected]);

  return (
    <div className="mb-8 p-6 bg-neutral-900 border border-yellow-900 rounded-lg">
      <h2 className="text-lg font-bold text-yellow-400 mb-2">Connect WhatsApp</h2>
      <p className="text-sm text-neutral-400 mb-4">
        Scan the QR code below with your phone: WhatsApp &gt; Settings &gt; Linked Devices &gt; Link a Device
      </p>

      {loading && <p className="text-neutral-400 text-sm">Loading QR code...</p>}
      {error && <p className="text-red-400 text-sm">{error}</p>}

      {qrUrl && (
        <div className="flex justify-center">
          <img src={qrUrl} alt="WhatsApp QR Code" className="w-64 h-64 rounded-lg" />
        </div>
      )}

      <p className="text-xs text-neutral-500 mt-4 text-center">
        QR code refreshes automatically. This page polls for connection status.
      </p>
    </div>
  );
}
