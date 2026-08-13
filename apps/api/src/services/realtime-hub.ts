import pg from "pg";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import { Server as SocketIoServer, type Socket } from "socket.io";
import { verifyAccessToken } from "../auth.js";
import { config } from "../config.js";
import { getSyncEventByCursor, getUserById } from "../repository.js";
import type { UserRole } from "../contracts.js";

type RealtimePrincipal = {
  userId: string;
  role: UserRole;
  expiresAt: number;
};

type HandshakeWindow = { count: number; expiresAt: number };

const MAX_HANDSHAKES_PER_MINUTE = 30;
const MAX_HANDSHAKE_TRACKERS = 10_000;
const MAX_PENDING_CURSORS = 10_000;
const MAX_TIMEOUT = 2_147_483_647;

function configuredOrigins(): string[] {
  return config.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean);
}

function socketToken(socket: Socket): string | null {
  const authToken = socket.handshake.auth["token"];
  if (typeof authToken === "string" && authToken) return authToken;
  const authorization = socket.handshake.headers.authorization;
  const match = typeof authorization === "string" ? /^Bearer\s+(.+)$/i.exec(authorization) : null;
  return match?.[1] ?? null;
}

/**
 * PostgreSQL LISTEN reaches every API instance. Each instance emits only to its
 * local Socket.IO rooms; the durable REST cursor remains the recovery path.
 */
export class RealtimeHub {
  readonly io: SocketIoServer;
  private listener: pg.Client | null = null;
  private started = false;
  private closed = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private fanoutInFlight = false;
  private readonly pendingCursors = new Set<string>();
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();
  private readonly handshakeWindows = new Map<string, HandshakeWindow>();

  constructor(server: HttpServer, private readonly enabled = config.REALTIME_ENABLED === "true") {
    this.io = new SocketIoServer(server, {
      path: `${config.API_PREFIX}/realtime`,
      cors: { origin: configuredOrigins(), credentials: false },
      transports: ["websocket"],
      allowRequest: (request, callback) => callback(null, this.allowRequest(request)),
    });
    this.io.use((socket, next) => {
      void this.authenticate(socket).then(
        (principal) => {
          socket.data.principal = principal;
          next();
        },
        () => next(new Error("UNAUTHORIZED")),
      );
    });
    this.io.on("connection", (socket) => {
      const principal = socket.data.principal as RealtimePrincipal;
      socket.join(`user:${principal.userId}`);
      this.disconnectAtTokenExpiry(socket, principal.expiresAt);
      socket.on("disconnect", () => this.clearSocketExpiry(socket.id));
      socket.emit("sync:ready", { server_time: new Date().toISOString() });
    });
  }

  async start(): Promise<void> {
    if (!this.enabled || this.started) return;
    this.closed = false;
    await this.connectListener(true);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.started = false;
    this.pendingCursors.clear();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    for (const timer of this.expiryTimers.values()) clearTimeout(timer);
    this.expiryTimers.clear();

    const listener = this.listener;
    this.listener = null;
    if (listener) {
      await listener.query("UNLISTEN networkpeer_sync").catch(() => undefined);
      await listener.query("UNLISTEN networkpeer_auth_revoked").catch(() => undefined);
      await listener.end().catch(() => undefined);
    }
    await this.io.close();
  }

  private allowRequest(request: IncomingMessage): boolean {
    if (!this.enabled) return false;
    const origin = request.headers.origin;
    if (typeof origin === "string" && !configuredOrigins().includes(origin)) return false;
    if (!origin && config.NODE_ENV === "production") return false;

    const address = request.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    if (this.handshakeWindows.size > MAX_HANDSHAKE_TRACKERS) {
      for (const [key, window] of this.handshakeWindows) {
        if (window.expiresAt <= now) this.handshakeWindows.delete(key);
      }
      if (this.handshakeWindows.size > MAX_HANDSHAKE_TRACKERS) return false;
    }
    const current = this.handshakeWindows.get(address);
    if (!current || current.expiresAt <= now) {
      this.handshakeWindows.set(address, { count: 1, expiresAt: now + 60_000 });
      return true;
    }
    current.count += 1;
    return current.count <= MAX_HANDSHAKES_PER_MINUTE;
  }

  private async connectListener(throwOnFailure: boolean): Promise<void> {
    if (this.closed || !this.enabled || this.listener) return;
    const listener = new pg.Client({ connectionString: config.DATABASE_URL });
    listener.on("notification", (message) => this.handleNotification(message.channel, message.payload));
    listener.on("error", () => this.handleListenerLoss(listener));
    listener.on("end", () => this.handleListenerLoss(listener));

    try {
      await listener.connect();
      await listener.query("LISTEN networkpeer_sync");
      await listener.query("LISTEN networkpeer_auth_revoked");
      if (this.closed) {
        await listener.end().catch(() => undefined);
        return;
      }
      this.listener = listener;
      this.started = true;
      this.reconnectAttempt = 0;
    } catch (err) {
      await listener.end().catch(() => undefined);
      if (throwOnFailure) throw err;
      this.scheduleReconnect();
    }
  }

  private handleListenerLoss(listener: pg.Client): void {
    if (this.listener !== listener || this.closed) return;
    this.listener = null;
    this.started = false;
    void listener.end().catch(() => undefined);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.closed || !this.enabled || this.reconnectTimer) return;
    const delay = Math.min(30_000, 250 * 2 ** Math.min(this.reconnectAttempt, 7));
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectListener(false);
    }, delay);
    this.reconnectTimer.unref();
  }

  private handleNotification(channel: string, payload: string | undefined): void {
    if (!payload) return;
    if (channel === "networkpeer_auth_revoked") {
      this.io.in(`user:${payload}`).disconnectSockets(true);
      return;
    }
    if (channel !== "networkpeer_sync" || !/^\d+$/.test(payload)) return;
    if (this.pendingCursors.size >= MAX_PENDING_CURSORS) {
      // Socket delivery is expendable; reconnecting clients reconcile durably.
      this.pendingCursors.clear();
      this.io.disconnectSockets(true);
      return;
    }
    this.pendingCursors.add(payload);
    void this.flushFanout();
  }

  private async flushFanout(): Promise<void> {
    if (this.fanoutInFlight) return;
    this.fanoutInFlight = true;
    try {
      while (this.pendingCursors.size > 0) {
        const cursors = [...this.pendingCursors].slice(0, 64);
        for (const cursor of cursors) this.pendingCursors.delete(cursor);
        await Promise.all(cursors.map((cursor) => this.broadcast(cursor)));
      }
    } finally {
      this.fanoutInFlight = false;
      if (this.pendingCursors.size > 0) void this.flushFanout();
    }
  }

  private disconnectAtTokenExpiry(socket: Socket, expiresAt: number): void {
    const delay = expiresAt - Date.now();
    if (delay <= 0) {
      socket.disconnect(true);
      return;
    }
    const timer = setTimeout(() => socket.disconnect(true), Math.min(delay, MAX_TIMEOUT));
    this.expiryTimers.set(socket.id, timer);
  }

  private clearSocketExpiry(socketId: string): void {
    const timer = this.expiryTimers.get(socketId);
    if (timer) clearTimeout(timer);
    this.expiryTimers.delete(socketId);
  }

  private async authenticate(socket: Socket): Promise<RealtimePrincipal> {
    if (!this.enabled) throw new Error("UNAVAILABLE");
    const token = socketToken(socket);
    if (!token) throw new Error("UNAUTHORIZED");
    const claims = verifyAccessToken(token);
    const user = await getUserById(claims.sub);
    if (!user || !user.is_active || !user.is_verified) throw new Error("UNAUTHORIZED");
    return { userId: user.id, role: user.role, expiresAt: claims.exp * 1000 };
  }

  private async broadcast(cursor: string): Promise<void> {
    try {
      const event = await getSyncEventByCursor(cursor);
      if (!event) return;
      // LISTEN/NOTIFY is ephemeral. If a suspension notification was missed
      // during listener recovery, re-check before a later event can reach the
      // stale room.
      const recipient = await getUserById(event.recipient_user_id);
      if (!recipient || !recipient.is_active || !recipient.is_verified) {
        this.io.in(`user:${event.recipient_user_id}`).disconnectSockets(true);
        return;
      }
      this.io.to(`user:${event.recipient_user_id}`).emit("sync:event", event);
    } catch {
      // Cursor sync is the durable recovery path if transient fanout fails.
    }
  }
}
