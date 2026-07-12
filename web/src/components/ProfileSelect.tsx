import { SelectControl } from "./SelectControl";

export function ProfileSelect({
  name,
  label,
  value,
  options,
  placeholder,
  invalid,
  className,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  options: string[];
  placeholder: string;
  invalid?: boolean;
  className?: string;
  onChange: (value: string) => void;
}) {
  return (
    <SelectControl
      name={name}
      required
      label={label}
      value={value}
      options={options.map((option) => ({ value: option, label: option }))}
      placeholder={placeholder}
      invalid={invalid}
      onChange={onChange}
      className={`${className ?? ""} h-12`}
    />
  );
}
