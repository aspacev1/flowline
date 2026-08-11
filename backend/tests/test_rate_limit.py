from app.rate_limit import RateLimiter


def test_allows_up_to_the_limit_and_then_refuses():
    clock = [0.0]
    limiter = RateLimiter(limit=3, window_seconds=60, now=lambda: clock[0])

    assert [limiter.allow("ip") for _ in range(3)] == [True, True, True]
    assert limiter.allow("ip") is False


def test_the_window_slides_rather_than_resetting_on_a_schedule():
    """Окно скользит: три реплики в 12:00:59 не должны обнуляться в 12:01:00
    просто потому, что началась новая минута."""
    clock = [0.0]
    limiter = RateLimiter(limit=2, window_seconds=60, now=lambda: clock[0])

    limiter.allow("ip")
    clock[0] = 59.0
    limiter.allow("ip")
    assert limiter.allow("ip") is False

    clock[0] = 61.0  # первая вышла из окна, вторая ещё в нём
    assert limiter.allow("ip") is True
    assert limiter.allow("ip") is False


def test_keys_are_counted_apart():
    clock = [0.0]
    limiter = RateLimiter(limit=1, window_seconds=60, now=lambda: clock[0])

    assert limiter.allow("first") is True
    assert limiter.allow("second") is True
    assert limiter.allow("first") is False


def test_keys_that_fell_out_of_the_window_stop_taking_memory():
    """Иначе счётчик — это утечка: адресов много, окно короткое, а словарь
    растёт вечно."""
    clock = [0.0]
    limiter = RateLimiter(limit=1, window_seconds=60, now=lambda: clock[0])

    limiter.allow("ip")
    clock[0] = 120.0
    limiter.allow("other")

    assert limiter.tracked_keys() == {"other"}


def test_a_refused_attempt_does_not_extend_the_window():
    """Иначе гость, долбящий кнопку, продлевает себе запрет бесконечно —
    наказание вместо ограничения."""
    clock = [0.0]
    limiter = RateLimiter(limit=1, window_seconds=60, now=lambda: clock[0])

    limiter.allow("ip")
    clock[0] = 30.0
    assert limiter.allow("ip") is False

    clock[0] = 61.0
    assert limiter.allow("ip") is True
