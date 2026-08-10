import pytest

from app.auth import authenticate, register
from app.models import Membership, Organization, Role
from app.security import hash_password, verify_password


def test_password_hash_is_not_the_password():
    hashed = hash_password("correct horse battery staple")
    assert hashed != "correct horse battery staple"
    assert verify_password("correct horse battery staple", hashed) is True
    assert verify_password("wrong", hashed) is False


def test_registration_creates_user_org_and_owner_membership(db):
    user = register(db, name="Alex", email="Alex@Example.com", password="s3cret-pass")
    db.flush()

    assert user.email == "alex@example.com"

    membership = db.query(Membership).filter_by(user_id=user.id).one()
    assert membership.role == Role.OWNER

    org = db.get(Organization, membership.org_id)
    assert org.name == "Alex"
    assert org.slug == "alex"


def test_registration_rejects_a_duplicate_email_regardless_of_case(db):
    register(db, name="Alex", email="alex@example.com", password="s3cret-pass")
    db.flush()

    with pytest.raises(ValueError, match="занят"):
        register(db, name="Other", email="ALEX@example.com", password="other-pass")


def test_org_slug_gets_a_suffix_when_taken(db):
    register(db, name="Acme", email="one@example.com", password="s3cret-pass")
    db.flush()
    second = register(db, name="Acme", email="two@example.com", password="s3cret-pass")
    db.flush()

    membership = db.query(Membership).filter_by(user_id=second.id).one()
    org = db.get(Organization, membership.org_id)
    assert org.slug.startswith("acme-")


def test_authenticate_accepts_the_right_password_and_rejects_the_wrong_one(db):
    register(db, name="Alex", email="alex@example.com", password="s3cret-pass")
    db.flush()

    assert authenticate(db, email="ALEX@example.com", password="s3cret-pass") is not None
    assert authenticate(db, email="alex@example.com", password="nope") is None
    assert authenticate(db, email="ghost@example.com", password="s3cret-pass") is None
