import { create } from "zustand";
import { queueLocalSnapshotSync } from "../../lib/localPersistence/localSnapshotApi";
import { projectRepository } from "../../lib/storage/projectRepository";
import {
  createWriteQueue,
  StorageConflictError,
} from "../../lib/storage/writeQueue";
import {
  createProject,
  sortProjects,
  type Project,
  type ProjectCreateInput,
} from "../../types/project";

type ProjectState = {
  createProject: (input: ProjectCreateInput) => Promise<Project>;
  isLoaded: boolean;
  loadProjects: () => Promise<Project[]>;
  projects: Project[];
  reorderProject: (projectId: string, toIndex: number) => Promise<void>;
  updateProject: (
    projectId: string,
    update: Partial<Omit<Project, "createdAt" | "id">>,
  ) => Promise<Project | null>;
};

export const useProjectStore = create<ProjectState>((set, get) => {
  const write = createWriteQueue();
  return {
    createProject: (input) =>
      write(async () => {
        const project = createProject(input);
        await projectRepository.save(project);
        set({ projects: [project, ...get().projects] });
        queueLocalSnapshotSync();
        return project;
      }),
    isLoaded: false,
    async loadProjects() {
      const projects = await projectRepository.list();
      set({ isLoaded: true, projects });
      return projects;
    },
    projects: [],
    reorderProject: (projectId, toIndex) =>
      write(async () => {
        const expected = await projectRepository.list();
        const projects = sortProjects(expected);
        const fromIndex = projects.findIndex(
          (project) => project.id === projectId,
        );
        if (fromIndex === -1 || fromIndex === toIndex) {
          return;
        }

        const boundedIndex = Math.max(
          0,
          Math.min(toIndex, projects.length - 1),
        );
        const [movedProject] = projects.splice(fromIndex, 1);
        projects.splice(boundedIndex, 0, movedProject);
        const now = new Date().toISOString();
        const nextProjects = projects.map((project, index) => ({
          ...project,
          sortOrder: index,
          updatedAt: project.id === projectId ? now : project.updatedAt,
        }));

        if (!(await projectRepository.saveIfUnchanged(nextProjects, expected)))
          throw new StorageConflictError();
        set({ projects: await projectRepository.list() });
        queueLocalSnapshotSync();
      }),
    updateProject: (projectId, update) =>
      write(async () => {
        const current = await projectRepository.get(projectId);

        if (!current) {
          return null;
        }

        const nextProject: Project = {
          ...current,
          ...update,
          updatedAt: new Date().toISOString(),
        };
        if (
          !(await projectRepository.saveIfUnchanged([nextProject], [current]))
        )
          throw new StorageConflictError();
        set({
          projects: get().projects.map((project) =>
            project.id === projectId ? nextProject : project,
          ),
        });
        queueLocalSnapshotSync();
        return nextProject;
      }),
  };
});
