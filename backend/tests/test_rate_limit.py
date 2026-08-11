from app.rate_limit import SlidingWindow


def test_allows_up_to_the_limit_inside_the_window():
    window = SlidingWindow(limit=2, window=60.0)

    assert window.allow("a", now=0.0) is True
    assert window.allow("a", now=1.0) is True
    assert window.allow("a", now=2.0) is False


def test_the_window_slides_instead_of_resetting_on_the_hour():
    window = SlidingWindow(limit=2, window=60.0)
    window.allow("a", now=0.0)
    window.allow("a", now=30.0)

    assert window.allow("a", now=59.0) is False
    # Ушло только первое обращение: окно скользящее, а не «обнулиться в
    # начале часа», иначе на границе часа проходит двойной потолок.
    assert window.allow("a", now=61.0) is True
    assert window.allow("a", now=62.0) is False


def test_a_refusal_does_not_extend_the_ban():
    window = SlidingWindow(limit=1, window=60.0)
    window.allow("a", now=0.0)

    for moment in (10.0, 20.0, 30.0):
        assert window.allow("a", now=moment) is False

    # Отказ ничего не записывает: иначе тот, кто жмёт кнопку дальше,
    # продлевал бы себе запрет каждым нажатием.
    assert window.allow("a", now=61.0) is True


def test_keys_are_counted_apart():
    window = SlidingWindow(limit=1, window=60.0)

    assert window.allow("a", now=0.0) is True
    assert window.allow("b", now=0.0) is True


def test_a_zero_limit_refuses_everything():
    assert SlidingWindow(limit=0, window=60.0).allow("a", now=0.0) is False


def test_stale_keys_do_not_pile_up_forever():
    window = SlidingWindow(limit=1, window=60.0)

    for index in range(SlidingWindow.SWEEP_EVERY * 2):
        window.allow(f"guest-{index}", now=float(index))

    # Уборка идёт раз в SWEEP_EVERY обращений, поэтому точное число ключей
    # не фиксируется: важно, что словарь не растёт линейно по числу адресов.
    assert len(window) < SlidingWindow.SWEEP_EVERY
