class JiraError(Exception):
    """Jira не ответила, ответила отказом или не тем, чего ждали.

    Машинный `code` — то же самое разделение, что у LlmError: человеку
    отдаётся код, переведённый по словарю на клиенте, а `message` остаётся
    журналу разработчика.
    """

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
