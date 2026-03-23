import { create } from 'zustand';
import type { Task, TaskStatus } from '../api/endpoints/tasks.ts';
import {
  listTasks,
  getTask as fetchTask,
  updateTask as patchTask,
  deleteTask as removeTask,
} from '../api/endpoints/tasks.ts';

interface TaskStore {
  tasks: Task[];
  activeTaskId: string | null;
  activeTask: Task | null;
  isLoading: boolean;

  fetchTasks: () => Promise<void>;
  setActiveTask: (id: string | null) => void;
  loadTask: (id: string) => Promise<Task | null>;
  updateTask: (id: string, updates: Partial<Task>) => void;
  updateTaskStatus: (id: string, status: TaskStatus) => void;
  removeTask: (id: string) => Promise<void>;
  reset: () => void;
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  activeTaskId: null,
  activeTask: null,
  isLoading: false,

  fetchTasks: async () => {
    set({ isLoading: true });
    try {
      const tasks = await listTasks();
      const { activeTaskId } = get();
      const activeTask = activeTaskId
        ? tasks.find((t) => t.task_id === activeTaskId) ?? null
        : null;
      set({ tasks, activeTask, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  setActiveTask: (id: string | null) => {
    const task = id ? get().tasks.find((t) => t.task_id === id) ?? null : null;
    set({ activeTaskId: id, activeTask: task });
  },

  loadTask: async (id: string) => {
    try {
      const task = await fetchTask(id);
      // Update in local list if present, otherwise add
      set((s) => {
        const exists = s.tasks.some((t) => t.task_id === id);
        const tasks = exists
          ? s.tasks.map((t) => (t.task_id === id ? task : t))
          : [...s.tasks, task];
        return {
          tasks,
          activeTask: s.activeTaskId === id ? task : s.activeTask,
        };
      });
      return task;
    } catch {
      return null;
    }
  },

  updateTask: (id: string, updates: Partial<Task>) => {
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.task_id === id ? { ...t, ...updates } : t,
      ),
      activeTask:
        s.activeTaskId === id && s.activeTask
          ? { ...s.activeTask, ...updates }
          : s.activeTask,
    }));
  },

  updateTaskStatus: (id: string, status: TaskStatus) => {
    get().updateTask(id, { status });
    patchTask(id, { status }).catch(() => {
      // Revert on failure could go here
    });
  },

  removeTask: async (id: string) => {
    try {
      await removeTask(id);
      set((s) => ({
        tasks: s.tasks.filter((t) => t.task_id !== id),
        activeTaskId: s.activeTaskId === id ? null : s.activeTaskId,
        activeTask: s.activeTaskId === id ? null : s.activeTask,
      }));
    } catch {
      // Deletion failed — leave list unchanged
    }
  },

  reset: () => {
    set({
      tasks: [],
      activeTaskId: null,
      activeTask: null,
      isLoading: false,
    });
  },
}));
