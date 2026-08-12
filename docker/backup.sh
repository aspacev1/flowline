#!/bin/sh
# Ежесуточный дамп базы из sidecar-контейнера backup (docker-compose.yml).
#
# Дамп в формате -Fc (custom): он сжат и восстанавливается pg_restore как
# целиком, так и по частям — plain-SQL этого не умеет. Пишется сначала во
# временный файл и лишь потом переименовывается: восстановление никогда не
# должно подхватить дамп, оборванный на середине записи.
#
# Хранение ограничено BACKUP_KEEP_DAYS: без предела каталог тихо растёт до
# заполнения диска, и первым об этом узнаёт не бэкап, а Postgres по соседству.
set -eu

: "${BACKUP_INTERVAL_SECONDS:=86400}"
: "${BACKUP_KEEP_DAYS:=14}"

while true; do
  stamp=$(date -u +%Y%m%d-%H%M%S)
  target="/backups/${POSTGRES_DB}-${stamp}.dump"
  if pg_dump -h db -U "$POSTGRES_USER" -Fc -f "${target}.part" "$POSTGRES_DB"; then
    mv "${target}.part" "$target"
    echo "backup: снят $target"
  else
    # Неудачный дамп — не повод молча ждать сутки: сообщение уходит в журнал
    # контейнера, обрывок удаляется, следующая попытка по расписанию.
    echo "backup: pg_dump не удался, дампа за $stamp нет" >&2
    rm -f "${target}.part"
  fi
  find /backups -name "${POSTGRES_DB}-*.dump" -mtime "+${BACKUP_KEEP_DAYS}" -delete
  sleep "$BACKUP_INTERVAL_SECONDS"
done
