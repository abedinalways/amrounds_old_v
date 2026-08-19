/**
 * ChatContext - Provides chat state and operations to the dashboard
 * 
 * Uses:
 * - useConversationManager: conversations, messages, start/select conversation
 * - useMessageSender: send messages with optimistic updates
 * - useChatSocket: real-time socket connection
 */

'use client';

import React, { createContext, useContext, useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { type AppDispatch } from '@/app/redux/store';
import { useChatSocket } from '@/app/redux/api/chat/useChatSocket';
import { setTyping } from '@/app/redux/api/chat/chatSlice';
import { useConversationManager } from '@/hooks/useConversationManager';
import { useMessageSender } from '@/hooks/useMessageSender';
import { type Conversation, type Message } from '@/app/redux/api/chat/chatApi';

interface ChatContextType {
  conversations: Conversation[];
  messages: Message[];
  activeConversationId: string | null;
  selectConversation: (id: string) => void;
  sendMessage: (text: string, attachments?: File[]) => Promise<void>;
  startConversation: (targetUserId: string) => Promise<string>;
  isTyping: boolean;
  setTyping: (v: boolean) => void;
}

const ChatContext = createContext<ChatContextType | null>(null);

export const useChat = () => {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside ChatProvider');
  return ctx;
};

export function ChatProvider({ children }: { children: React.ReactNode }) {
  // Initialize socket connection - stays alive on dashboard pages
  useChatSocket();

  const dispatch = useDispatch<AppDispatch>();

  // Conversation management
  const {
    conversations,
    messages,
    activeConversationId,
    selectConversation,
    startConversation,
  } = useConversationManager();

  // Message sending with optimistic updates
  const { sendMessage: sendMessageWithOptimistic } = useMessageSender();

  // Typing state
  const [isTyping, setIsTyping] = React.useState(false);

  // Restore active chat from URL
  useEffect(() => {
    if (activeConversationId) {
      // URL sync handled by useConversationManager
    }
  }, [activeConversationId]);

  /**
   * Send a message
   */
  const sendMessage = async (text: string, attachments: File[] = []) => {
    if (!activeConversationId) return;
    await sendMessageWithOptimistic(
      activeConversationId,
      text,
      attachments,
      conversations
    );
  };

  return (
    <ChatContext.Provider
      value={{
        conversations,
        messages,
        activeConversationId,
        selectConversation,
        sendMessage,
        startConversation,
        isTyping,
        setTyping: (v: boolean) => {
          setIsTyping(v);
          dispatch(setTyping(v));
        },
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}