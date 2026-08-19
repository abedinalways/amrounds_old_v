
'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useDispatch, useSelector } from 'react-redux';
import {
  getSocket,
  joinRoom,
  disconnectSocket,
} from '@/lib/socket';
import { store, type AppDispatch, type RootState } from '../../store';
import {
  chatApi,
  type Message,
  useGetConversationsQuery,
} from './chatApi';
import { notificationApi } from '../notificationApi';
import { addNotification } from '@/store/NotificationSlice';
import { toast } from 'sonner';
import {
  SOCKET_EVENTS,
  type SocketMessagePayload,
  type SocketConversationPayload,
  type NormalizedSocketMessage,
} from '@/types/socket';

// ============================================
// Event Groups
// ============================================

const MESSAGE_EVENTS = [
  SOCKET_EVENTS.MESSAGE,
  SOCKET_EVENTS.NEW_MESSAGE,
  SOCKET_EVENTS.NEW_MESSAGE_ALT,
  SOCKET_EVENTS.RECEIVE_MESSAGE,
  SOCKET_EVENTS.RECEIVE_MESSAGE_ALT,
  SOCKET_EVENTS.CHAT_MESSAGE,
  SOCKET_EVENTS.CHAT_MESSAGE_ALT,
  SOCKET_EVENTS.NOTIFICATION,
  SOCKET_EVENTS.NEW_NOTIFICATION,
  SOCKET_EVENTS.NEW_NOTIFICATION_ALT,
];

const CONVERSATION_EVENTS = [
  SOCKET_EVENTS.CONVERSATION,
  SOCKET_EVENTS.NEW_CONVERSATION,
  SOCKET_EVENTS.NEW_CONVERSATION_ALT,
  SOCKET_EVENTS.CREATE_CONVERSATION,
];

const isDevelopment = process.env.NODE_ENV === 'development';

// ============================================
// Main Hook
// ============================================

/**
 * useChatSocket - Manages real-time chat via Socket.IO
 * 
 * What it does:
 * 1. Connects to socket server with auth token
 * 2. Joins conversation rooms automatically
 * 3. Listens for incoming messages
 * 4. Updates Redux store with new messages
 * 5. Shows notifications for new messages
 */
export function useChatSocket() {
  const dispatch = useDispatch<AppDispatch>();
  const pathname = usePathname();

  // Get auth token from Redux store
  const token = useSelector((state: RootState) => state.auth.auth.token);
  const activeConversationId = useSelector(
    (state: RootState) => state.chat.activeConversationId
  );
  const shouldUseSocket =
    Boolean(activeConversationId) ||
    pathname.includes('/messages') ||
    pathname.includes('/support-message');

  // Get user's conversations list
  useGetConversationsQuery(undefined, {
    skip: !token,
  });

  // Track which conversations we've already joined
  const joinedConvsRef = useRef<string[]>([]);

  // ============================================
  // Effect 1: Socket Connection & Event Listeners
  // ============================================

  useEffect(() => {
    // No token? Disconnect and cleanup
    if (!token || !shouldUseSocket) {
      disconnectSocket();
      joinedConvsRef.current = [];
      return;
    }

    // Get or create socket connection
    const socket = getSocket(token);
    if (!socket) return;

    // ----------------------------------------
    // Handle incoming messages
    // ----------------------------------------
    const handleMessage = (payload: unknown) => {
      if (isDevelopment) {
        console.log('[Chat] Socket message received:', payload);
      }
      const data = extractMessageData(payload);

      if (data.conversationId) {
        // Create message object for Redux
        const newMessage = createMessageObject(data);

        // Update messages in Redux cache
        updateMessagesCache(dispatch, data.conversationId, newMessage);

        // Update conversation list
        updateConversationList(dispatch, data.conversationId, newMessage);

        // Show notification if message is from someone else
        if (data.senderId !== getCurrentUserId()) {
          showMessageNotification(dispatch, newMessage, data);
        }
      }

      // Always invalidate RTK Query tags to ensure fresh data in UI
      dispatch(chatApi.util.invalidateTags(['Chat']));
      dispatch(
        notificationApi.util.invalidateTags(['notification', 'adminNotification'])
      );
    };

    // ----------------------------------------
    // Handle new conversation events
    // ----------------------------------------
    const handleNewConversation = (payload: unknown) => {
      if (isDevelopment) {
        console.log('[Chat] New conversation event:', payload);
      }
      const data = payload as SocketConversationPayload;
      const nestedData = data?.data;
      const convId = (nestedData?.id || data?.id) as string | undefined;

      if (convId) {
        joinRoom(convId);

        // Refresh conversations list
        dispatch(chatApi.util.invalidateTags(['Chat']));
      }
    };

    // ----------------------------------------
    // Sync conversations when socket connects
    // ----------------------------------------
    const syncConversations = () => {
      if (isDevelopment) {
        console.log('[Chat] Socket connected - syncing conversations');
      }

      // Always re-fetch conversations to get latest rooms
      dispatch(chatApi.util.invalidateTags(['Chat']));

      const selectedConversationId =
        store.getState().chat.activeConversationId || activeConversationId;

      if (selectedConversationId) {
        joinRoom(selectedConversationId);
      }

      // Refresh data from server
      dispatch(
        notificationApi.util.invalidateTags(['notification', 'adminNotification'])
      );
    };

    const logAllEvents = isDevelopment
      ? (eventName: string, ...args: unknown[]) => {
          console.log(`[Socket Event] "${eventName}"`, args);
        }
      : undefined;

    if (logAllEvents) {
      socket.onAny(logAllEvents);
    }

    // Register event listeners
    MESSAGE_EVENTS.forEach(evt => socket.on(evt, handleMessage));
    CONVERSATION_EVENTS.forEach(evt => socket.on(evt, handleNewConversation));
    socket.on(SOCKET_EVENTS.CONNECT, syncConversations);

    // Cleanup on unmount
    return () => {
      if (logAllEvents) {
        socket.offAny(logAllEvents);
      }
      MESSAGE_EVENTS.forEach(evt => socket.off(evt, handleMessage));
      CONVERSATION_EVENTS.forEach(evt => socket.off(evt, handleNewConversation));
      socket.off(SOCKET_EVENTS.CONNECT, syncConversations);
    };
  }, [token, dispatch, activeConversationId, shouldUseSocket]);

  // ============================================
  // Effect 2: Join New Conversations
  // ============================================

  useEffect(() => {
    if (!token || !shouldUseSocket || !activeConversationId) return;

    joinRoom(activeConversationId);

    if (!joinedConvsRef.current.includes(activeConversationId)) {
      joinedConvsRef.current = [...joinedConvsRef.current, activeConversationId];
    }
  }, [activeConversationId, shouldUseSocket, token]);
}

// ============================================
// Helper Functions
// ============================================

/**
 * Extract and normalize message data from socket payload
 */
function extractMessageData(payload: unknown): NormalizedSocketMessage {
  const data = (payload as SocketMessagePayload) || {};
  const msg = (data?.data as SocketMessagePayload) || data;
  const sender = (msg?.sender as SocketMessagePayload) || data?.sender || {};
  const conv = (msg?.conversation as SocketMessagePayload) || data?.conversation || {};

  return {
    conversationId: (msg?.conversation_id ||
      msg?.conversationId ||
      conv?.id ||
      data?.conversation_id ||
      data?.conversationId ||
      '') as string,
    senderId: (msg?.from ||
      msg?.sender_id ||
      msg?.senderId ||
      sender?.id ||
      data?.sender_id ||
      '') as string,
    messageId: (msg?.message_id || msg?.id || '') as string,
    body: (msg?.body_text ||
      msg?.message ||
      msg?.text ||
      msg?.content ||
      'New message') as string,
    timestamp: (msg?.created_at || msg?.createdAt || new Date().toISOString()) as string,
    senderName: (sender?.name || msg?.sender_name || 'User') as string,
    senderAvatar: (sender?.avatar_url || sender?.avatar || '') as string,
  };
}

/**
 * Create Message object for Redux store
 */
function createMessageObject(data: NormalizedSocketMessage): Message {
  const currentUser = store.getState().auth.user;

  return {
    id: data.messageId,
    message: data.body,
    created_at: data.timestamp,
    sender: {
      id: data.senderId,
      name: data.senderName,
      avatar_url: data.senderAvatar,
    },
    receiver: {
      id: data.senderId === currentUser?.id ? '' : (currentUser?.id ?? ''),
      name: '',
      avatar_url: '',
    },
    status: 'SENT',
    attachments: [],
  };
}

/**
 * Update messages cache in Redux
 */
function updateMessagesCache(
  dispatch: AppDispatch,
  conversationId: string,
  newMessage: Message
): void {
  const queryArgs = { conversationId, limit: 20 };
  const currentUser = store.getState().auth.user;

  dispatch(
    chatApi.util.updateQueryData('getMessages', queryArgs, draft => {
      if (!draft?.data) draft.data = [];

      // Remove temp messages from current user
      if (newMessage.sender.id === currentUser?.id) {
        draft.data = draft.data.filter(m => !m.id?.startsWith('temp_'));
      }

      // Update or add message
      const idx = draft.data.findIndex(m => m.id === newMessage.id);
      if (idx > -1) {
        draft.data[idx] = { ...draft.data[idx], ...newMessage };
      } else {
        draft.data.push(newMessage);
      }
    })
  );
}

/**
 * Update conversation list in Redux
 */
function updateConversationList(
  dispatch: AppDispatch,
  conversationId: string,
  newMessage: Message
): void {
  dispatch(
    chatApi.util.updateQueryData('getConversations', undefined, draft => {
      if (!draft?.data) return;

      const convIdx = draft.data.findIndex(c => c.id === conversationId);
      if (convIdx > -1) {
        const conv = draft.data[convIdx];
        conv.messages = [
          {
            id: newMessage.id,
            message: newMessage.message || '',
            created_at: newMessage.created_at,
          },
        ];
        conv.updated_at = newMessage.created_at;

        // Move to top of list
        draft.data.splice(convIdx, 1);
        draft.data.unshift(conv);
      }
    })
  );
}

/**
 * Show notification for new message
 */
function showMessageNotification(
  dispatch: AppDispatch,
  message: Message,
  data: NormalizedSocketMessage
): void {
  dispatch(
    addNotification({
      id: message.id,
      type: 'conversation',
      message: message.message || 'New message',
      timestamp: data.timestamp,
      isRead: false,
      isNew: true,
      user: {
        name: data.senderName,
        avatar: data.senderAvatar,
        initials: data.senderName.slice(0, 2).toUpperCase(),
      },
      senderId: data.senderId,
      conversationId: data.conversationId,
      messageId: message.id,
    })
  );

  toast.info('New message received');
}

/**
 * Get current user ID
 */
function getCurrentUserId(): string {
  return store.getState().auth.user?.id || '';
}

// ============================================
// Public Export
// ============================================

/**
 * Join a specific conversation room
 */
export const joinConversation = (conversationId: string) => {
  joinRoom(conversationId);
};
