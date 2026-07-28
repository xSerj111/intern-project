export interface IMessageResponse {
  id: string;
  chatId: string;
  authorId: string;
  content: string;
  createdAt: string; // In JSON we sent date in ISO
}