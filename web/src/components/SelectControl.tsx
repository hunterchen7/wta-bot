import { cn } from "../lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

export type SelectControlOption = {
  value: string;
  label: string;
};

export function SelectControl({
  label,
  value,
  options,
  onChange,
  placeholder,
  name,
  required,
  invalid,
  className,
}: {
  label: string;
  value: string;
  options: SelectControlOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  name?: string;
  required?: boolean;
  invalid?: boolean;
  className?: string;
}) {
  return (
    <Select
      name={name}
      required={required}
      value={value || undefined}
      onValueChange={onChange}
    >
      <SelectTrigger
        aria-label={label}
        aria-invalid={invalid}
        className={cn(
          "h-10 w-full cursor-pointer rounded-xl bg-background px-3.5",
          className,
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent
        position="popper"
        align="start"
        className="min-w-[var(--radix-select-trigger-width)]"
      >
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className="cursor-pointer py-2.5"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
