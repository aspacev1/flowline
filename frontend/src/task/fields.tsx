import type { ComponentProps } from "react";

import {
  SelectField as BaseSelectField,
  TextField as BaseTextField,
  ValueField as BaseValueField,
} from "../components/autosave";

/**
 * Поля карточки задачи.
 *
 * Сами поля общие — они же стоят в настройках (см. `components/autosave`), и
 * второй их набор разъехался бы с первым на первой правке. Своё у карточки
 * одно: раскладка строки. В настройках подпись стоит над полем, в карточке —
 * слева от него, потому что свойств у задачи восемь и подписи сверху дают
 * восемь лишних строк, после которых карточка перестаёт помещаться на экран.
 */

const ROW = "panel__field";

/** Те же свойства, что у общего поля, кроме раскладки: её задаёт карточка. */
type Panel<Props> = Omit<Props, "className">;

export function TextField(props: Panel<ComponentProps<typeof BaseTextField>>) {
  return <BaseTextField className={ROW} {...props} />;
}

export function ValueField(props: Panel<ComponentProps<typeof BaseValueField>>) {
  return <BaseValueField className={ROW} {...props} />;
}

export function SelectField(props: Panel<ComponentProps<typeof BaseSelectField>>) {
  return <BaseSelectField className={ROW} {...props} />;
}
