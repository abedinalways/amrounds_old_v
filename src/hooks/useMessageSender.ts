/**
 * useMessageSender - Manages message sending with optimistic updates
 * 
 * Responsibilities:
 * - Send messages (user & admin)
 * - Optimistic update (temp message → real message)
 * - Handle send failures (rollback)
 * - Route to correct API (admin vs user)
 */

'use client';

import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { type AppDispatch, type RootState } from '@/app/redux/store';
import {
  useSendMessageMutation,
  useSendAdminMessageMutation,
  chatApi,
  type Message,
  type Conversation,
} from '@/app/redux/api/chat/chatApi';

function isAdminUser(user: unknown): boolean {
  const candidate = user as { role?: string; type?: string } | undefined;
  return candidate?.role === 'admin' || candidate?.type === 'admin';
}

export function useMessageSender() {
  const dispatch = useDispatch<AppDispatch>();

  const { user: currentUser, auth } = useSelector(
    (state: RootState) => state.auth,
  );
  const { adminConversationIds } = useSelector(
    (state: RootState) => state.chat,
  );

  const isAdmin = auth?.role === 'admin' || currentUser?.role === 'admin';

  // API Hooks
  const [sendMessageApi] = useSendMessageMutation();
  const [sendAdminMessageApi] = useSendAdminMessageMutation();

  /**
   * Send a message with optimistic update
   */
  const sendMessage = useCallback(
    async (
      conversationId: string,
      text: string,
      attachments: File[] = [],
      conversations: Conversation[]
    ) => {
      if (!conversationId) return;

      const conv = conversations.find(c => c.id === conversationId);
      if (!conv) return;

      const meId = currentUser?.id;
      const receiverId =
        conv.creator_id === meId ? conv.participant_id : conv.creator_id;

      const payload = {
        conversationId,
        receiverId,
        message: text,
        attachments,
      };

      // Optimistic update — add temp message to cache immediately
      const tempId = `temp_${crypto.randomUUID()}`;
      const now = new Date().toISOString();

      const optimisticMessage: Message = {
        id: tempId,
        message: text || null,
        created_at: now,
        status: 'SENDING',
        attachments: [],
        sender: {
          id: meId ?? '',
          name: currentUser?.name ?? 'Me',
          avatar_url: currentUser?.avatar ?? '',
        },
        receiver: {
          id: receiverId,
          name: '',
          avatar_url: '',
        },
      };

      // Add to messages cache immediately
      dispatch(
        chatApi.util.updateQueryData(
          'getMessages',
          { conversationId, limit: 20 },
          draft => {
            if (!draft?.data) draft.data = [];
            draft.data.push(optimisticMessage);
          },
        ),
      );

      // Also update conversation list preview immediately
      dispatch(
        chatApi.util.updateQueryData('getConversations', undefined, draft => {
          if (!draft?.data) return;
          const c = draft.data.find(c => c.id === conversationId);
          if (!c) return;
          if (!c.messages) c.messages = [];
          c.messages = [{ id: tempId, message: text, created_at: now }];
          c.updated_at = now;
        }),
      );

      // Route by conversation type, NOT sender role
      const isAdminConversation =
        isAdmin ||
        adminConversationIds.includes(conversationId) ||
        isAdminUser(conv.creator) ||
        isAdminUser(conv.participant);

      try {
        let result;
        if (isAdminConversation) {
          result = await sendAdminMessageApi(payload).unwrap();
        } else {
          result = await sendMessageApi(payload).unwrap();
        }

        // Replace temp message with real one from server response
        if (result?.data) {
          dispatch(
            chatApi.util.updateQueryData(
              'getMessages',
              { conversationId, limit: 20 },
              draft => {
                if (!draft?.data) return;
                const idx = draft.data.findIndex(m => m.id === tempId);
                if (idx !== -1) {
                  draft.data[idx] = { ...result.data, status: 'SENT' };
                }
              },
            ),
          );
        }
      } catch (error) {
        // On failure, remove the temp message from cache
        dispatch(
          chatApi.util.updateQueryData(
            'getMessages',
            { conversationId, limit: 20 },
            draft => {
              if (!draft?.data) return;
              draft.data = draft.data.filter(m => m.id !== tempId);
            },
          ),
        );
        console.error('Send message failed:', error);
        throw error;
      }
    },
    [dispatch, currentUser, isAdmin, adminConversationIds, sendMessageApi, sendAdminMessageApi],
  );

  return { sendMessage };
}