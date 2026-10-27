export interface I18n {
  /**
   * The translated message, in the language the browser is set to, with the
   * substitutions put in the places the message marks for them
   */
  getMessage(messageName: string, substitutions?: readonly string[]): string;
}
