import { io, Socket } from 'socket.io-client';
import { SOCKET_EVENTS } from '@/types/socket';

// ============================================
// Configuration
// ============================================

const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_API_ENDPOINT ||
  '';

const MAX_RECONNECT_ATTEMPTS = 5;
const STABLE_CONNECTION_TIMEOUT = 60_000; // ms
const RECONNECT_BASE_DELAY = 10_000; // ms
const RECONNECT_MAX_DELAY = 60_000; // ms
const isDevelopment = process.env.NODE_ENV === 'development';

// ============================================
// Singleton State
// ============================================

let socket: Socket | null = null;
let currentToken: string | null = null;
let reconnectAttempts = 0;
let reconnectResetTimer: ReturnType<typeof setTimeout> | null = null;
let serverReconnectTimer: ReturnType<typeof setTimeout> | null = null;

// Track joined rooms to prevent duplicate joins
const activeRooms = new Set<string>();

// Track rooms that need to be joined when the socket connects
const pendingRooms = new Set<string>();

// ============================================
// Public API
// ============================================

/**
 * Get or create socket connection
 * @param token - JWT authentication token
 * @returns Socket instance or null (SSR)
 */
export function getSocket(token: string): Socket | null {
  // SSR safety check
  if (typeof window === 'undefined') return null;

  // Return existing socket if created with same token
  if (socket && currentToken === token) return socket;

  // Cleanup old socket if switching token
  cleanupSocket();

  currentToken = token;
  const baseUrl = SOCKET_URL.replace(/\/+$/, '');

  if (isDevelopment) {
    console.log('[Socket] Connecting to:', baseUrl);
  }

  socket = io(baseUrl, {
    transports: ['websocket'],
    upgrade: false,
    timeout: 15_000, // Connection timeout
    // Browser WebSocket cannot reliably send custom headers, but Socket.IO
    // sends this auth object in the connect packet.
    auth: {
      token: `Bearer ${token}`,
      rawToken: token,
      access_token: token,
      authorization: `Bearer ${token}`,
      Authorization: `Bearer ${token}`,
    },
    reconnection: true,
    reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
    reconnectionDelay: 5_000,
    reconnectionDelayMax: 15_000,
  });

  setupEventHandlers();

  return socket;
}

/**
 * Join a chat room
 */
export function joinRoom(conversationId: string): void {
  if (!conversationId) return;

  // Prevent duplicate joins
  if (activeRooms.has(conversationId)) return;

  // Queue room if socket is not connected yet
  if (!isSocketConnected()) {
    pendingRooms.add(conversationId);
    return;
  }

  emitJoinRoom(conversationId);
  activeRooms.add(conversationId);
}

/**
 * Join multiple rooms at once
 */
export function joinRooms(conversationIds: string[]): void {
  conversationIds.forEach(id => joinRoom(id));
}

/**
 * Leave a chat room
 */
export function leaveRoom(conversationId: string): void {
  if (!conversationId) return;

  // Remove from pending queue if present
  pendingRooms.delete(conversationId);

  if (!isSocketConnected()) return;

  socket?.emit(SOCKET_EVENTS.LEAVE_ROOM, {
    room_id: conversationId,
    conversation_id: conversationId,
  });

  activeRooms.delete(conversationId);
}

/**
 * Disconnect socket and cleanup all resources
 */
export function disconnectSocket(): void {
  if (!socket) return;
  cleanupSocket();
}

/**
 * Check if socket is currently connected
 */
export function isSocketConnected(): boolean {
  return socket?.connected ?? false;
}

/**
 * Check if a room is currently joined
 */
export function isRoomJoined(conversationId: string): boolean {
  return activeRooms.has(conversationId);
}

/**
 * Clear all joined rooms (for testing/debugging)
 */
export function clearJoinedRooms(): void {
  activeRooms.clear();
  pendingRooms.clear();
}

// ============================================
// Private Helpers
// ============================================

/**
 * Setup socket event handlers
 */
function setupEventHandlers(): void {
  if (!socket) return;

  socket.on(SOCKET_EVENTS.CONNECT, handleConnect);
  socket.on(SOCKET_EVENTS.DISCONNECT, handleDisconnect);
  socket.on(SOCKET_EVENTS.CONNECT_ERROR, handleConnectError);
}

/**
 * Handle successful connection
 */
function handleConnect(): void {
  if (isDevelopment) {
    console.log('[Socket] Connected successfully (WebSocket)');
  }

  reconnectAttempts = 0;
  clearServerReconnectTimer();
  resetReconnectAttempts();
  processPendingRooms();
}

/**
 * Handle disconnection
 */
function handleDisconnect(reason: string): void {
  if (isDevelopment) {
    console.warn('[Socket] Disconnected:', reason);
  }

  // Server-initiated disconnect - clear rooms and manually reconnect
  // with exponential backoff
  if (reason === 'io server disconnect') {
    activeRooms.forEach(room => pendingRooms.add(room));
    activeRooms.clear();

    // Cancel the stable-connection timer since the server disconnected
    clearReconnectResetTimer();

    reconnectAttempts++;

    if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      if (isDevelopment) {
        console.error(
          `[Socket] Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. ` +
            'Server keeps disconnecting. Stopping reconnection attempts.'
        );
      }
      return;
    }

    // Exponential backoff: 10s, 20s, 40s, 60s, 60s, ...
    const delay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1),
      RECONNECT_MAX_DELAY
    );

    if (isDevelopment) {
      console.log(
        `[Socket] Server disconnect - reconnecting in ${delay / 1000}s ` +
          `(attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`
      );
    }

    clearServerReconnectTimer();
    serverReconnectTimer = setTimeout(() => {
      serverReconnectTimer = null;
      if (socket && currentToken && !socket.connected) {
        // Create a fresh socket instance instead of reusing the old one
        const token = currentToken;
        cleanupSocket({ preserveQueuedRooms: true, preserveReconnectAttempts: true });
        getSocket(token);
      }
    }, delay);
  }
}

/**
 * Handle connection errors
 */
function handleConnectError(error: Error): void {
  if (isDevelopment) {
    console.error('[Socket] Connection error:', error.message);
    console.error('[Socket] Error type:', error.name);
  }
}

/**
 * Reset reconnection attempts after a stable connection
 */
function resetReconnectAttempts(): void {
  clearReconnectResetTimer();
  reconnectResetTimer = setTimeout(() => {
    reconnectAttempts = 0;
    reconnectResetTimer = null;
  }, STABLE_CONNECTION_TIMEOUT);
}

/**
 * Clear the reconnect reset timer
 */
function clearReconnectResetTimer(): void {
  if (reconnectResetTimer) {
    clearTimeout(reconnectResetTimer);
    reconnectResetTimer = null;
  }
}

function clearServerReconnectTimer(): void {
  if (serverReconnectTimer) {
    clearTimeout(serverReconnectTimer);
    serverReconnectTimer = null;
  }
}

/**
 * Emit join room event
 */
function emitJoinRoom(conversationId: string): void {
  socket?.emit(SOCKET_EVENTS.JOIN_ROOM, {
    room_id: conversationId,
    conversation_id: conversationId,
  });
}

/**
 * Process pending room joins (called on connect)
 */
function processPendingRooms(): void {
  if (pendingRooms.size === 0) return;

  const rooms = Array.from(pendingRooms);
  pendingRooms.clear();

  rooms.forEach(roomId => {
    // Skip already-joined rooms
    if (activeRooms.has(roomId)) return;

    if (socket?.connected) {
      emitJoinRoom(roomId);
      activeRooms.add(roomId);
    } else {
      // Socket disconnected while processing - re-queue
      pendingRooms.add(roomId);
    }
  });
}

/**
 * Cleanup socket and reset all state
 */
function cleanupSocket(options?: {
  preserveQueuedRooms?: boolean;
  preserveReconnectAttempts?: boolean;
}): void {
  const roomsToRestore = options?.preserveQueuedRooms
    ? new Set([...activeRooms, ...pendingRooms])
    : null;

  clearServerReconnectTimer();

  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  clearReconnectResetTimer();

  currentToken = null;
  activeRooms.clear();
  pendingRooms.clear();

  roomsToRestore?.forEach(room => pendingRooms.add(room));

  if (!options?.preserveReconnectAttempts) {
    reconnectAttempts = 0;
  }
}
