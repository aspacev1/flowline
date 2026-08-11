import { request } from "./client";

export const ORG_QUERY_KEY = ["org"] as const;

export type Organization = {
  id: string;
  name: string;
  slug: string;
  role: string;
};

/** Организация, в которой человек находится сейчас. */
export function organization(): Promise<Organization> {
  return request<Organization>("/api/org");
}
