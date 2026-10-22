import { getStorageAdapter } from "./getStorageAdapter";
import type { Project } from "../../types/project";

export const projectRepository = {
  async saveIfUnchanged(projects: Project[], expected: Project[]) {
    return getStorageAdapter().projects.saveIfUnchanged(projects, expected);
  },
  async delete(projectId: string) {
    await getStorageAdapter().projects.delete(projectId);
  },

  async get(projectId: string) {
    return getStorageAdapter().projects.get(projectId);
  },

  async list() {
    return getStorageAdapter().projects.list();
  },

  async save(project: Project) {
    return getStorageAdapter().projects.save(project);
  },
};
