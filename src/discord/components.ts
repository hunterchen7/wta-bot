// Builders for the component JSON shapes we use (2026 modal components:
// Labels wrapping TextInput / StringSelect).

import { ComponentType, EPHEMERAL, ResponseType } from './types';

export const TextStyle = { SHORT: 1, PARAGRAPH: 2 } as const;

export type SelectOption = { label: string; value: string; description?: string; default?: boolean };

export function textInput(opts: {
  id: string;
  label: string;
  description?: string;
  style?: number;
  required?: boolean;
  value?: string;
  placeholder?: string;
  maxLength?: number;
}) {
  return {
    type: ComponentType.LABEL,
    label: opts.label,
    description: opts.description,
    component: {
      type: ComponentType.TEXT_INPUT,
      custom_id: opts.id,
      style: opts.style ?? TextStyle.SHORT,
      required: opts.required ?? true,
      value: opts.value,
      placeholder: opts.placeholder,
      max_length: opts.maxLength,
    },
  };
}

export function stringSelect(opts: {
  id: string;
  label: string;
  description?: string;
  options: SelectOption[];
  minValues?: number;
  maxValues?: number;
  required?: boolean;
}) {
  return {
    type: ComponentType.LABEL,
    label: opts.label,
    description: opts.description,
    component: {
      type: ComponentType.STRING_SELECT,
      custom_id: opts.id,
      options: opts.options,
      min_values: opts.minValues ?? 1,
      max_values: opts.maxValues ?? 1,
      required: opts.required ?? true,
    },
  };
}

export function modal(id: string, title: string, components: unknown[]) {
  return {
    type: ResponseType.MODAL,
    data: { custom_id: id, title, components },
  };
}

export function ephemeral(content: string, components?: unknown[]) {
  return {
    type: ResponseType.CHANNEL_MESSAGE,
    data: { content, flags: EPHEMERAL, components },
  };
}

export function buttonRow(
  buttons: Array<{ id: string; label: string; style?: number; emoji?: string }>,
) {
  return {
    type: ComponentType.ACTION_ROW,
    components: buttons.map((b) => ({
      type: ComponentType.BUTTON,
      custom_id: b.id,
      label: b.label,
      style: b.style ?? 1, // primary
      emoji: b.emoji ? { name: b.emoji } : undefined,
    })),
  };
}
