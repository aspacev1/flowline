/**
 * Кружок с инициалами — аватар без фотографий.
 *
 * Загрузки картинок в продукте нет, и выдумывать её ради колонки «Исполнитель»
 * не за что: инициалы на ровной подложке решают ту же задачу — отличать людей
 * друг от друга с одного взгляда. Оттенок выводится из имени детерминированно,
 * а не случайно: один и тот же человек обязан быть одного цвета в списке,
 * карточке и комментариях, иначе цвет перестаёт помогать узнаванию.
 */

const HUES = [216, 262, 158, 24, 336, 96, 190, 282] as const;

function hueOf(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return HUES[hash % HUES.length];
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  // Одно слово — одна буква: «АЛ» из «Алексей» читалось бы как чьи-то чужие
  // инициалы.
  return words
    .slice(0, 2)
    .map((word) => [...word][0]!.toUpperCase())
    .join("");
}

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const hue = hueOf(name);
  return (
    <span
      className="avatar"
      // Имя — доступное имя картинки: колонка владельцев без него читалась бы
      // с экрана как ряд пустых кружков.
      role="img"
      aria-label={name}
      title={name}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        background: `hsl(${hue} 70% 90%)`,
        color: `hsl(${hue} 45% 32%)`,
      }}
    >
      {initialsOf(name)}
    </span>
  );
}
