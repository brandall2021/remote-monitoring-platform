import { io, Socket } from "socket.io-client";

let adminSocket: Socket | null = null;
const MAX_RECONNECT_ATTEMPTS = 10;

export function getAdminSocket(token: string): Socket {
  if (!adminSocket) {
    adminSocket = io("/admin", {
      auth: { token },
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
    });

    adminSocket.on("reconnect_attempt", (_attempt: number) => {
    });

    adminSocket.on("reconnect", () => {
    });
  } else if (adminSocket.disconnected) {
    adminSocket.auth = { token };
    adminSocket.connect();
  }

  return adminSocket;
}

export function disconnectAdminSocket(): void {
  if (adminSocket) {
    adminSocket.disconnect();
    adminSocket = null;
  }
}

export function getSocketConnectionState(): boolean {
  return adminSocket?.connected ?? false;
}
