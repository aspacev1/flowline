import pytest

from app.models import Organization, Project, ShareLink
from app.sharing import (
    NotPublished,
    SharingRefused,
    link_of,
    public_path,
    publish,
    resolve,
    revoke,
    set_comments_enabled,
)


@pytest.fixture
def org(db):
    org = Organization(name="Acme", slug="acme")
    db.add(org)
    db.flush()
    return org


@pytest.fixture
def project(db, org):
    project = Project(org_id=org.id, name="Redesign", slug="redesign-2026")
    db.add(project)
    db.flush()
    return project


def test_publishing_opens_the_address_built_from_slugs(db, org, project):
    link = publish(db, project, org)

    assert link.revoked_at is None
    assert public_path(org, project) == "/p/acme/redesign-2026"
    assert resolve(db, "acme", "redesign-2026")[0].id == project.id


def test_comments_start_from_the_organization_default(db, org, project):
    """Умолчание организации — это умолчание, а не рекомендация: проект,
    который его не переопределял, обязан ему следовать."""
    org.default_comments_enabled = False
    db.flush()

    assert publish(db, project, org).comments_enabled is False


def test_revoking_closes_the_address_immediately(db, org, project):
    publish(db, project, org)
    revoke(db, project)

    with pytest.raises(NotPublished):
        resolve(db, "acme", "redesign-2026")
    assert link_of(db, project) is None


def test_publishing_again_revives_the_same_address(db, org, project):
    """Следствие решения об адресе из слагов, а не оплошность: секрета в
    адресе нет, и «новой» ссылке взяться неоткуда."""
    publish(db, project, org)
    revoke(db, project)
    revived = publish(db, project, org)

    assert revived.revoked_at is None
    assert resolve(db, "acme", "redesign-2026")[0].id == project.id
    # Ряд тот же самый: журнал публикаций не должен плодить дубликаты.
    assert db.query(ShareLink).count() == 1


def test_organization_may_forbid_public_sharing_entirely(db, org, project):
    org.public_sharing_enabled = False
    db.flush()

    with pytest.raises(SharingRefused) as refusal:
        publish(db, project, org)
    assert refusal.value.code == "public_sharing_disabled"


def test_a_link_of_an_organization_that_revoked_sharing_stops_resolving(db, org, project):
    """Выключатель организации гасит уже выданные ссылки, а не только новые:
    иначе запрет ничего не запрещает до тех пор, пока кто-то не отзовёт
    каждую ссылку руками."""
    publish(db, project, org)
    org.public_sharing_enabled = False
    db.flush()

    with pytest.raises(NotPublished):
        resolve(db, "acme", "redesign-2026")


def test_unknown_slugs_are_refused_the_same_way_as_a_revoked_link(db, org, project):
    """Одинаковый отказ — не лень: разные ответы рассказали бы перебором,
    какие организации и проекты существуют."""
    publish(db, project, org)

    with pytest.raises(NotPublished):
        resolve(db, "acme", "no-such-project")
    with pytest.raises(NotPublished):
        resolve(db, "globex", "redesign-2026")


def test_comments_switch_is_remembered(db, org, project):
    publish(db, project, org)

    assert set_comments_enabled(db, project, False).comments_enabled is False
    assert resolve(db, "acme", "redesign-2026")[2].comments_enabled is False


def test_switching_comments_on_an_unpublished_project_is_refused(db, org, project):
    with pytest.raises(SharingRefused) as refusal:
        set_comments_enabled(db, project, True)
    assert refusal.value.code == "not_published"
