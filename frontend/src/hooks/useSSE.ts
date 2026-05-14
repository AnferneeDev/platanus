import { useEffect, useRef } from "react";

type EventHandler = (data: unknown) => void;

export function useSSE(handlers: Record<string, EventHandler>) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const es = new EventSource("/api/events", { withCredentials: true });

    const knownEvents = Object.keys(handlersRef.current);
    for (const event of knownEvents) {
      es.addEventListener(event, (e) => {
        try {
          const data = JSON.parse((e as MessageEvent).data);
          handlersRef.current[event]?.(data);
        } catch {
          // ignore parse errors
        }
      });
    }

    es.onerror = () => {
      // EventSource auto-reconnects
    };

    return () => es.close();
  }, []);
}
