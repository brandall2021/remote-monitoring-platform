import { io, Socket } from "socket.io-client";

let adminSocket: Socket | null = null;

export function getAdminSocket(token: string): Socket {
  if (!adminSocket || !adminSocket.connected) {
    adminSocket = io("/admin", {
      auth: { token },
      transports: ["websocket"],
    });

    adminSocket.on("connect", () => {
      console.log("[WS] Admin connected");
    });

    adminSocket.on("disconnect", () => {
      console.log("[WS] Admin disconnected");
    });

    adminSocket.on("connect_error", (error) => {
      console.error("[WS] Connection error:", error.message);
    });
  }
  return adminSocket;
}

export function disconnectAdminSocket(): void {
  if (adminSocket) {
    adminSocket.disconnect();
    adminSocket = null;
  }
}
