/**
 * Native WebSocket client for ExcaliDash Cloudflare
 *
 * Provides a thin wrapper around native WebSocket that matches the
 * Socket.IO-like patterns used in Editor.tsx, minimizing changes needed.
 *
 * Protocol: JSON messages with a `type` field discriminator.
 */

type MessageHandler = (data: any) => void;
type JoinCallback = (payload: any) => void;

export class ExcalidashSocket {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private _connected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private url: string;
  private pendingJoinCallback: JoinCallback | null = null;

  constructor(url: string) {
    this.url = url;
    this.connect();
  }

  get connected(): boolean {
    return this._connected;
  }

  private connect(): void {
    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this._connected = true;
        this.reconnectAttempts = 0;
        this.emit_internal("connect", undefined);
      };

      this.ws.onclose = (event) => {
        this._connected = false;
        this.emit_internal("disconnect", { code: event.code, reason: event.reason });
        this.scheduleReconnect();
      };

      this.ws.onerror = (_event) => {
        console.error("[ExcalidashSocket] WebSocket error");
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const type = data?.type;
          if (!type) return;

          // Handle join-ack specially (it's the callback for join-room)
          if (type === "join-ack" && this.pendingJoinCallback) {
            this.pendingJoinCallback({ user: data.user });
            this.pendingJoinCallback = null;
            return;
          }

          // Dispatch to registered handlers
          const handlers = this.handlers.get(type);
          if (handlers) {
            for (const handler of handlers) {
              handler(data);
            }
          }
        } catch (err) {
          console.error("[ExcalidashSocket] Failed to parse message:", err);
        }
      };
    } catch (err) {
      console.error("[ExcalidashSocket] Failed to connect:", err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    if (this.reconnectTimer) return;

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /**
   * Register a handler for a message type.
   * Matches Socket.IO's `socket.on(event, handler)` pattern.
   */
  on(event: string, handler: MessageHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  /**
   * Remove a handler for a message type.
   * Matches Socket.IO's `socket.off(event)` pattern.
   */
  off(event: string, handler?: MessageHandler): void {
    if (handler) {
      this.handlers.get(event)?.delete(handler);
    } else {
      this.handlers.delete(event);
    }
  }

  /**
   * Send a typed message over the WebSocket.
   *
   * For `join-room`, accepts an optional callback that will be invoked
   * when the server responds with `join-ack` (matching Socket.IO's
   * acknowledgment pattern).
   */
  emit(type: string, data: any, callback?: JoinCallback): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[ExcalidashSocket] Cannot emit — not connected");
      return;
    }

    if (type === "join-room" && callback) {
      this.pendingJoinCallback = callback;
    }

    const message = JSON.stringify({ type, ...data });
    this.ws.send(message);
  }

  /**
   * Internal event dispatch (for connect/disconnect pseudo-events)
   */
  private emit_internal(event: string, data: any): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(data);
      }
    }
  }

  /**
   * Close the WebSocket connection.
   * Matches Socket.IO's `socket.disconnect()` pattern.
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = this.maxReconnectAttempts; // prevent reconnect
    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }
    this._connected = false;
  }
}

/**
 * Create a WebSocket connection to the drawing room.
 * Drop-in replacement for Socket.IO's `io(url, opts)`.
 */
export function connectToDrawingRoom(drawingId: string): ExcalidashSocket {
  const envUrl = import.meta.env.VITE_API_URL;
  const baseUrl = (!envUrl || envUrl.startsWith('/'))
    ? window.location.origin
    : envUrl;

  // Convert http(s) to ws(s)
  const wsUrl = baseUrl.replace(/^http/, 'ws') + `/ws/drawing/${drawingId}`;

  return new ExcalidashSocket(wsUrl);
}
