export type ChatSender = 'user' | 'ai' | 'system';

export interface ChatMessage {
  id: number;
  sender: ChatSender;
  message: string;
  reply_to_id: number | null;
  reply_to: ChatMessage | null;
  metadata: Record<string, any> | null;
  created_at: string;
}

export interface ChatSendRequest {
  message: string;
  reply_to_id?: number;
}

export interface ChatSendResponse {
  id: number;
  created_at: string;
}

export interface AIProcessRequest {
  user_message_id: number;
}
