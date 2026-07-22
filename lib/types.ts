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
  quoted_message_id?: string | null;
};

export type Reaction = {
  id: number;
  instance: string;
  remote_jid: string;
  target_message_id: string;
  reactor_jid: string;
  from_me: boolean;
  emoji: string | null;
  msg_timestamp: string;
};

export type Account = {
  instance: string;
  label: string;
  color: string;
  phone: string | null;
  kind: "live" | "archive";
  sort_order: number;
  hasCustomEvolution?: boolean;
};

export type Chat = {
  instance: string;
  jid: string;
  name: string;
  last: ZapMessage;
  unread: number;
};

export type QuickReply = {
  id: number;
  shortcut: string;
  message: string;
  sort_order: number;
};
