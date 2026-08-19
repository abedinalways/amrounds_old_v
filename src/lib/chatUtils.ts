/**
 * Chat utility functions
 * 
 * Centralized helpers for chat-related operations
 * to avoid code duplication across components.
 */

import { type Conversation } from '@/app/redux/api/chat/chatApi';
import { type AppNotification } from '@/store/NotificationSlice';

/**
 * Find a conversation by matching the other participant
 * against a notification's sender.
 */
export function findConversationByNotification(
  conversations: Conversation[],
  notification: AppNotification,
  currentUserId?: string,
): Conversation | undefined {
  return conversations.find((c: Conversation) => {
    const otherUser =
      c.creator_id === currentUserId ? c.participant : c.creator;

    if (notification.senderId && otherUser?.id) {
      return otherUser.id === notification.senderId;
    }

    return otherUser?.name === notification.user?.name;
  });
}

/**
 * Normalize conversations data from various API response shapes.
 */
export function normalizeConversations(
  data: unknown,
): Conversation[] {
  if (Array.isArray(data)) return data as Conversation[];

  if (data && typeof data === 'object') {
    const obj = data as { data?: unknown };
    if (Array.isArray(obj.data)) return obj.data as Conversation[];
  }

  return [];
}