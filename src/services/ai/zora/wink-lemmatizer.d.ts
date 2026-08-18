declare module 'wink-lemmatizer' {
  interface WinkLemmatizer {
    noun(word: string): string;
    verb(word: string): string;
    adjective(word: string): string;
  }

  const lemmatize: WinkLemmatizer;
  export default lemmatize;
}
