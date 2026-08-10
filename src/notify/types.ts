export type Notification = {
  /** The drafted post, exactly as it should appear on X. */
  post: string;
  /** One-tap link that opens the X composer pre-filled. */
  intentUrl: string;
  /** The story the post is about. */
  sourceUrl: string;
  sourceTitle: string;
  /** Where it came from and how it ranked, for your own judgement. */
  origin: string;
};

export interface Notifier {
  readonly name: string;
  send(notification: Notification): Promise<void>;
}
