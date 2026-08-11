import { request } from "./client";

export const PROJECTS_QUERY_KEY = ["projects"] as const;

export type Project = {
  id: string;
  name: string;
  slug: string;
};

export function projects(): Promise<Project[]> {
  return request<Project[]>("/api/projects");
}
