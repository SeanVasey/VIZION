import type { Provider } from "@/lib/providers/config";

/** Raised when a provider's API key is absent — surfaced as a 503 to the client
 *  so the UI can tell the user to add the key (keys are server-side only). */
export class ProviderNotConfiguredError extends Error {
  constructor(public provider: Provider) {
    super(`The ${provider} provider is not configured on the server.`);
    this.name = "ProviderNotConfiguredError";
  }
}

/** Raised when a provider call fails (network, auth, model error). */
export class ProviderError extends Error {
  constructor(
    public provider: Provider,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface ProviderResult {
  output: string;
  rationale: string;
  tokenIn: number;
  tokenOut: number;
}
