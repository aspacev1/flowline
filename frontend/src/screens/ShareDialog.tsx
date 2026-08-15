import { Modal } from "../components/Modal";
import { useLocale } from "../i18n/LocaleProvider";
import { ShareControls } from "../project/ShareControls";

/**
 * Публичная ссылка проекта — окном с экрана проекта. Всё поведение живёт в
 * `ShareControls`: то же самое тело показывают настройки проекта, и разойтись
 * этим двум местам больше негде.
 */
export function ShareDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { t } = useLocale();

  return (
    <Modal title={t("share.title")} onClose={onClose}>
      <ShareControls projectId={projectId} onCancel={onClose} />
    </Modal>
  );
}
