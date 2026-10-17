/**
 * DrawingRoom Durable Object
 *
 * Manages real-time collaboration for a single drawing.
 * Uses WebSocket Hibernation API for efficient resource usage.
 *
 * Each drawing gets its own Durable Object instance, providing:
 * - Presence tracking (who's in the room)
 * - Cursor position broadcasting
 * - Element update relay between peers
 * - Activity status tracking
 */
import { DurableObject } from "cloudflare:workers";
import type { Env, WSClientMessage, WSServerMessage } from "../types";
import { createSentryForDO } from "../utils/sentry";

interface RoomUser {
  id: string;
  name: string;
  color: string;
  isActive: boolean;
  socketId: string;
}

interface SocketAttachment {
  userId: string;
  username: string;
  color: string;
  drawingId: string;
  isActive: boolean;
}

export class DrawingRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  /**
   * Handle incoming HTTP requests (WebSocket upgrades)
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      return this.handleWebSocketUpgrade(request);
    }

    return new Response("Not found", { status: 404 });
  }

  /**
   * Accept a WebSocket connection with the Hibernation API
   */
  private async handleWebSocketUpgrade(_request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept with Hibernation API — allows the DO to sleep when idle
    this.ctx.acceptWebSocket(server);

    // Initialize attachment with empty state (populated on join-room)
    server.serializeAttachment({
      userId: "",
      username: "",
      color: "",
      drawingId: "",
      isActive: true,
    } satisfies SocketAttachment);

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Handle incoming WebSocket messages (Hibernation API handler)
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const data = JSON.parse(
        typeof message === "string" ? message : new TextDecoder().decode(message)
      ) as WSClientMessage;

      switch (data.type) {
        case "join-room":
          await this.handleJoinRoom(ws, data);
          break;
        case "cursor-move":
          this.handleCursorMove(ws, data);
          break;
        case "element-update":
          this.handleElementUpdate(ws, data);
          break;
        case "user-activity":
          this.handleUserActivity(ws, data);
          break;
        default:
          console.warn("Unknown message type:", (data as any).type);
      }
    } catch (err) {
      console.error("Error processing WebSocket message:", err);
      try {
        const sentry = createSentryForDO(this.ctx);
        sentry.captureException(err);
      } catch { /* best-effort */ }
      const errorMsg: WSServerMessage = {
        type: "error",
        message: "Failed to process message",
      };
      ws.send(JSON.stringify(errorMsg));
    }
  }

  /**
   * Handle WebSocket close (Hibernation API handler)
   */
  async webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean): Promise<void> {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (attachment?.userId) {
      // Broadcast updated presence to remaining connections
      this.broadcastPresence(ws);
    }
    ws.close(code, "Closed");
  }

  /**
   * Handle WebSocket errors
   */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error("WebSocket error:", error);
    try {
      const sentry = createSentryForDO(this.ctx);
      sentry.captureException(error);
    } catch { /* best-effort */ }
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (attachment?.userId) {
      this.broadcastPresence(ws);
    }
  }

  // ─── Message Handlers ───────────────────────────────────────────────────

  private async handleJoinRoom(
    ws: WebSocket,
    data: Extract<WSClientMessage, { type: "join-room" }>
  ): Promise<void> {
    const attachment: SocketAttachment = {
      userId: data.user.id,
      username: data.user.name,
      color: data.user.color,
      drawingId: data.drawingId,
      isActive: true,
    };
    ws.serializeAttachment(attachment);

    // Send join acknowledgment
    const ack: WSServerMessage = {
      type: "join-ack",
      user: { id: data.user.id, name: data.user.name, color: data.user.color },
    };
    ws.send(JSON.stringify(ack));

    // Broadcast updated presence to all connections
    this.broadcastPresence();
  }

  private handleCursorMove(
    ws: WebSocket,
    data: Extract<WSClientMessage, { type: "cursor-move" }>
  ): void {
    // Broadcast cursor position to all other connections
    const msg: WSServerMessage = {
      type: "cursor-move",
      userId: data.userId,
      pointer: data.pointer,
      button: data.button,
      username: data.username,
      color: data.color,
    };
    this.broadcast(JSON.stringify(msg), ws);
  }

  private handleElementUpdate(
    ws: WebSocket,
    data: Extract<WSClientMessage, { type: "element-update" }>
  ): void {
    // Relay element updates to all other connections
    const msg: WSServerMessage = {
      type: "element-update",
      elements: data.elements,
      files: data.files,
      elementOrder: data.elementOrder,
    };
    this.broadcast(JSON.stringify(msg), ws);
  }

  private handleUserActivity(
    ws: WebSocket,
    data: Extract<WSClientMessage, { type: "user-activity" }>
  ): void {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (attachment) {
      attachment.isActive = data.isActive;
      ws.serializeAttachment(attachment);
      this.broadcastPresence();
    }
  }

  // ─── Broadcast Helpers ──────────────────────────────────────────────────

  /**
   * Send a message to all connected WebSockets except the sender
   */
  private broadcast(message: string, exclude?: WebSocket): void {
    const sockets = this.ctx.getWebSockets();
    for (const socket of sockets) {
      if (socket !== exclude) {
        try {
          socket.send(message);
        } catch {
          // Socket may have disconnected — will be cleaned up by webSocketClose
        }
      }
    }
  }

  /**
   * Broadcast current presence list to all connections
   */
  private broadcastPresence(exclude?: WebSocket): void {
    const sockets = this.ctx.getWebSockets();
    const users: Array<{ id: string; name: string; color: string; isActive: boolean }> = [];

    for (const socket of sockets) {
      if (socket === exclude) continue;
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (attachment?.userId) {
        users.push({
          id: attachment.userId,
          name: attachment.username,
          color: attachment.color,
          isActive: attachment.isActive,
        });
      }
    }

    const msg: WSServerMessage = { type: "presence-update", users };
    const payload = JSON.stringify(msg);

    for (const socket of sockets) {
      if (socket === exclude) continue;
      try {
        socket.send(payload);
      } catch {
        // Will be cleaned up by webSocketClose
      }
    }
  }
}
