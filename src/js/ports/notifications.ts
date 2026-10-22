export interface Notification {
  title: string;
  message: string;
  // The address of the picture shown beside the message
  iconUrl: string;
}

/** The browser's desktop notifications */
export interface Notifications {
  show(id: string, notification: Notification): Promise<void>;
  clear(id: string): Promise<void>;
}
