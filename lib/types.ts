export type ZapMessage = {
  id: number;
  instance: string;
  remote_jid: string;
  message_id: string;
  from_me: boolean;
  push_name: string | null;
  type: string;
  content: string | null;
  status: string;
  msg_timestamp: string;
};

export type Chat = {
  jid: string;
  name: string;
  last: ZapMessage;
  unread: number;
};
