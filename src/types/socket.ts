/**
 * Socket.IO Event Types
 * 
 * Centralized type definitions for all socket events.
 * This ensures type safety and makes the socket layer maintainable.
 */

// ============================================
// Socket Event Names
// ============================================

export const SOCKET_EVENTS = {
  // Connection events
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  CONNECT_ERROR: 'connect_error',

  // Room events
  JOIN_ROOM: 'joinRoom',
  LEAVE_ROOM: 'leaveRoom',

  // Message events (all aliases supported by backend)
  MESSAGE: 'message',
  NEW_MESSAGE: 'newMessage',
  NEW_MESSAGE_ALT: 'new_message',
  RECEIVE_MESSAGE: 'receiveMessage',
  RECEIVE_MESSAGE_ALT: 'receive_message',
  CHAT_MESSAGE: 'chatMessage',
  CHAT_MESSAGE_ALT: 'chat_message',

  // Notification events
  NOTIFICATION: 'notification',
  NEW_NOTIFICATION: 'newNotification',
  NEW_NOTIFICATION_ALT: 'new_notification',

  // Conversation events
  CONVERSATION: 'conversation',
  NEW_CONVERSATION: 'newConversation',
  NEW_CONVERSATION_ALT: 'new_conversation',
  CREATE_CONVERSATION: 'createConversation',
} as const;

export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

// ============================================
// Payload Types
// ============================================

export interface SocketUser {
  id: string;
  name?: string;
  avatar?: string;
  avatar_url?: string;
}

export interface SocketConversation {
  id: string;
  [key: string]: unknown;
}

export interface SocketMessagePayload {
  id?: string;
  message_id?: string;
  conversation_id?: string;
  conversationId?: string;
  sender_id?: string;
  senderId?: string;
  from?: string;
  body_text?: string;
  message?: string;
  text?: string;
  content?: string;
  created_at?: string;
  createdAt?: string;
  sender?: SocketUser;
  conversation?: SocketConversation;
  [key: string]: unknown;
}

export interface SocketConversationPayload {
  id?: string;
  data?: {
    id?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// ============================================
// Normalized Message (used across the app)
// ============================================

export interface NormalizedSocketMessage {
  conversationId: string;
  senderId: string;
  messageId: string;
  body: string;
  timestamp: string;
  senderName: string;
  senderAvatar: string;
}

// ============================================
// Socket Manager State
// ============================================

export interface SocketManagerState {
  isConnected: boolean;
  activeRooms: Set<string>;
  pendingRooms: Set<string>;
}