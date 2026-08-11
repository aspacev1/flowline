type FieldProps = {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  required?: boolean;
};

/**
 * Поле с настоящей подписью, а не с плейсхолдером вместо неё: плейсхолдер
 * исчезает при первом же символе, не читается с экрана и не связан с полем.
 */
export function Field({
  id,
  label,
  type = "text",
  value,
  onChange,
  autoComplete,
  required,
}: FieldProps) {
  return (
    <p className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        required={required}
        onChange={(event) => onChange(event.target.value)}
      />
    </p>
  );
}
