"use client";

import { useMutation } from "@tanstack/react-query";
import type { ModeId, TargetModelId } from "@/lib/constants";
import type { DiffSegment } from "@/lib/enhance/diff";

export interface EnhanceResponse {
  output: string;
  rationale: string;
  diff: DiffSegment[];
  tokenIn: number;
  tokenOut: number;
  modelUsed: string;
  costUsd: number;
  usage: { todayCost: number; capUsd: number };
}

export interface EnhanceRequest {
  input: string;
  mode: ModeId;
  target: TargetModelId;
}

class EnhanceError extends Error {
  constructor(
    message: string,
    public status: number,
    public notConfigured = false,
    public capReached = false,
  ) {
    super(message);
  }
}

async function postEnhance(req: EnhanceRequest): Promise<EnhanceResponse> {
  const res = await fetch("/api/enhance", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new EnhanceError(
      data.error ?? "Enhancement failed.",
      res.status,
      Boolean(data.notConfigured),
      Boolean(data.capReached),
    );
  }
  return data as EnhanceResponse;
}

/** Mutation for the enhance flow. Server state lives here (FINAL_PLAN D3). */
export function useEnhance() {
  return useMutation<EnhanceResponse, EnhanceError, EnhanceRequest>({
    mutationFn: postEnhance,
  });
}

export { EnhanceError };
