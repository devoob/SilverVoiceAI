export {};

declare global {
  interface Window {
    /** Utterances waiting to be "heard" by the stubbed recogniser. */
    __SV_QUEUE__: string[];
    /** Every line the app handed to speech synthesis, in order. */
    __SV_SPOKEN__: string[];
    __SV_SAY__: (text: string) => string;
    __SV_STATS__: { started: number };
  }
}
