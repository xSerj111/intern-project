export interface ICreateMessageRequest {
  chatId: string;
  content: string;
}

export interface ICreateDirectChatRequest {
  userId: string;
}

export interface ICreateGroupChatRequest {
  title: string; // 1-100
  memberIds: string[]; // 2-99, unique, excludes caller
}

export interface IListChatsQuery {
  before?: string; // ISO lastActivityAt cursor
  limit?: number; // 1-50, default 20
}

export interface IRenameGroupRequest {
  title: string; // 1-100
}

export interface IAddMembersRequest {
  userIds: string[]; // 1-98, unique
}

export interface IListMessagesQuery {
  beforeSeq?: number;
  limit?: number; // 1-100, default 50
}

export interface IMessageChangesQuery {
  afterChangeSeq: number;
  limit?: number; // 1-500, default 200
}

export interface ISendMessageRequest {
  clientMessageId: string; // uuid
  content?: string; // 1-2000 after trim
  attachmentIds?: string[]; // 1-10, unique, order = display order
}

export interface IEditMessageRequest {
  content: string; // 0-2000
}

export interface IMarkReadRequest {
  seq: number;
}
