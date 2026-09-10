export interface Notice {
  readonly tone: "success" | "error";
  readonly text: string;
}

export const failure = (text: string): Notice => ({ tone: "error", text });
export const success = (text: string): Notice => ({ tone: "success", text });
