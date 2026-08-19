/**
 * useConversationManager - Manages conversation state and operations
 * 
 * Responsibilities:
 * - Fetch conversations list
 * - Fetch messages for active conversation
 * - Start new conversations
 * - Select active conversation
 * - Track admin conversations
 */

'use client';

import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useParams } from 'next/navigation';
import { type AppDispatch, type RootState } from '@/app/redux/store';
import {
  useGetConversationsQuery,
  useGetMessagesQuery,
  useCreateConversationMutation,
  useCreateAdminConversationMutation,
  type Conversation,
} from '@/app/redux/api/chat/chatApi';
import {
  setActiveConversation,
  addAdminConversationId,
} from '@/app/redux/api/chat/chatSlice';

export function useConversationManager() {
  const dispatch = useDispatch<AppDispatch>();
  const params = useParams();
  const conversationIdFromUrl = params?.id as string | undefined;

  const { user: currentUser, auth } = useSelector(
    (state: RootState) => state.auth,
  );
  const { activeConversationId, adminConversationIds } = useSelector(
    (state: RootState) => state.chat,
  );

  // Sender is admin (for startConversation routing)
  const isAdmin = auth?.role === 'admin' || currentUser?.role === 'admin';

  // API Hooks
  const { data: conversationsData } = useGetConversationsQuery();
  const [createAdminChat] = useCreateAdminConversationMutation();
  const [createUserChat] = useCreateConversationMutation();

  const conversationId = activeConversationId ?? conversationIdFromUrl;

  // Fetch messages for the active conversation on demand
  const { data: messagesData } = useGetMessagesQuery(
    { conversationId: conversationId ?? '', limit: 20 },
    {
      skip: !conversationId,
    },
  );

  /**
   * Select a conversation
   */
  const selectConversation = useCallback(
    (id: string) => {
      dispatch(setActiveConversation(id));
    },
    [dispatch],
  );

  /**
   * Start a new conversation with a user
   * Returns the conversation ID
   */
  const startConversation = useCallback(
    async (targetUserId: string): Promise<string> => {
      const existingConv = conversationsData?.data?.find(
        c => c.creator_id === targetUserId || c.participant_id === targetUserId,
      );

      if (existingConv) {
        dispatch(setActiveConversation(existingConv.id));
        return existingConv.id;
      }

      try {
        let response;
        if (isAdmin) {
          response = await createAdminChat({
            participant_id: targetUserId,
          }).unwrap();
          const newConversationId = response.data.id;
          dispatch(addAdminConversationId(newConversationId));
          dispatch(setActiveConversation(newConversationId));
          return newConversationId;
        } else {
          response = await createUserChat({
            participant_id: targetUserId,
          }).unwrap();
        }

        const newConversationId = response.data.id;
        dispatch(setActiveConversation(newConversationId));
        return newConversationId;
      } catch (error) {
        console.error('Start Conversation Error:', error);
        throw error;
      }
    },
    [conversationsData, dispatch, isAdmin, createAdminChat, createUserChat],
  );

  return {
    conversations: conversationsData?.data ?? [],
    messages: messagesData?.data ?? [],
    activeConversationId: conversationId ?? null,
    selectConversation,
    startConversation,
    isAdmin,
  };
}