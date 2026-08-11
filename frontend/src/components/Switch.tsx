/**
 * Переключатель «включено/выключено».
 *
 * `role="switch"`, а не флажок: флажок отвечает на вопрос «отметить ли этот
 * пункт», а здесь состояние меняется сразу и без кнопки «сохранить» — это
 * рубильник, и объявлять его надо тем, что он есть.
 *
 * Подпись связана с ручкой через `aria-labelledby`, а не повторена в
 * `aria-label`: копия подписи однажды разойдётся с видимым текстом, и с
 * экрана прочитается не то, что написано на экране.
 */
export function Switch({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <p className="switch">
      <span className="switch__label" id={`${id}-label`}>
        {label}
      </span>
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        disabled={disabled}
        className="switch__handle"
        onClick={() => onChange(!checked)}
      >
        <span className="switch__dot" />
      </button>
    </p>
  );
}
