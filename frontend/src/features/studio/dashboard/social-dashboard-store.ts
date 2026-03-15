import { create } from 'zustand';

interface SocialDashboardState {
  isEditMode: boolean;
  configDialogOpen: boolean;
  /** ID of the widget being configured (null = adding new) */
  editingWidgetId: string | null;

  setEditMode: (editing: boolean) => void;
  openConfigDialog: (widgetId?: string) => void;
  closeConfigDialog: () => void;
}

export const useSocialDashboardStore = create<SocialDashboardState>((set) => ({
  isEditMode: false,
  configDialogOpen: false,
  editingWidgetId: null,

  setEditMode: (editing) => set({ isEditMode: editing }),
  openConfigDialog: (widgetId) =>
    set({ configDialogOpen: true, editingWidgetId: widgetId ?? null }),
  closeConfigDialog: () =>
    set({ configDialogOpen: false, editingWidgetId: null }),
}));
