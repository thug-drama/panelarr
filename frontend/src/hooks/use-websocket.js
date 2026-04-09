import { useCallback, useEffect, useRef, useState } from "react";

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000];

export function useWebSocket(url, { onMessage, enabled = true } = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    if (!url || !enabled) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}${url}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setIsConnected(true);
      reconnectAttempt.current = 0;
    };

    ws.onmessage = (event) => {
      onMessageRef.current?.(event.data);
    };

    ws.onclose = (event) => {
      setIsConnected(false);
      wsRef.current = null;
      // Don't reconnect if the server intentionally closed the stream
      // 4000 = container stopped, 4400 = bad request, 4401 = auth failed
      const noReconnect = event.code >= 4000;
      if (enabled && !noReconnect) {
        const delay =
          RECONNECT_DELAYS[
            Math.min(reconnectAttempt.current, RECONNECT_DELAYS.length - 1)
          ];
        reconnectAttempt.current += 1;
        reconnectTimer.current = setTimeout(connect, delay);
      }
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, [url, enabled]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      setIsConnected(false);
    };
  }, [connect]);

  const send = useCallback((data) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);
    }
  }, []);

  const close = useCallback(() => {
    clearTimeout(reconnectTimer.current);
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  return { isConnected, send, close };
}
