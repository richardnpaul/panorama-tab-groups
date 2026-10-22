export interface I18n {
  /** The translated message, in the language the browser is set to */
  getMessage(messageName: string): string;
}
